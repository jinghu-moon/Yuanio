use crate::config::RelayConfig;
use relay_protocol::{normalize_namespace, DEFAULT_NAMESPACE};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{sync::Arc, time::Duration};
use wyhash_final4::{generics::WyHashVariant, wyhash64::WyHash64};

#[derive(Clone)]
pub struct RelayDb {
    conn: Arc<std::sync::Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct PairingRequestRow {
    pub session_id: String,
    pub agent_public_key: String,
    pub expires_at: String,
    pub joined: bool,
    pub app_public_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DeviceRow {
    pub id: String,
}

#[derive(Debug, Clone)]
pub struct DeviceTokenRow {
    pub id: String,
    pub role: String,
    pub session_token: String,
}

#[derive(Debug, Clone)]
pub struct SessionMembershipRow {
    pub session_id: String,
    pub role: String,
    pub first_seen_ts: i64,
    pub last_seen_ts: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionMessageRow {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EncryptedMessageCursorRow {
    pub cursor: i64,
    pub id: String,
    pub session_id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub seq: i64,
    pub ts: i64,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionLogRow {
    pub id: i64,
    pub device_id: String,
    pub session_id: String,
    pub role: String,
    pub ip: Option<String>,
    pub event: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EncryptedMessageRow {
    pub id: String,
    pub session_id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub seq: i64,
    pub ts: i64,
    pub payload: String,
}

#[derive(Debug, Clone)]
pub struct DeliveryRow {
    pub message_id: String,
    pub session_id: String,
    pub source_device_id: String,
    pub target_device_id: String,
}

impl RelayDb {
    pub fn new(config: &RelayConfig) -> Result<Self, String> {
        let conn = Connection::open(&config.db_path).map_err(|err| err.to_string())?;
        if config.db_fast_write_mode {
            let _ = conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA temp_store = MEMORY;",
            );
        }
        if config.db_busy_timeout_ms > 0 {
            let _ = conn.busy_timeout(Duration::from_millis(config.db_busy_timeout_ms));
        }
        let db = Self {
            conn: Arc::new(std::sync::Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    namespace TEXT NOT NULL DEFAULT 'default',
                    version INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                );
                CREATE TABLE IF NOT EXISTS devices (
                    id TEXT PRIMARY KEY,
                    public_key TEXT NOT NULL,
                    role TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    session_token TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                );
                CREATE TABLE IF NOT EXISTS session_memberships (
                    device_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    first_seen TEXT DEFAULT (datetime('now')),
                    last_seen TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (device_id, session_id),
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                );
                CREATE TABLE IF NOT EXISTS pairing_requests (
                    code TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    agent_public_key TEXT NOT NULL,
                    agent_device_id TEXT NOT NULL,
                    session_token TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    joined INTEGER DEFAULT 0,
                    app_public_key TEXT,
                    app_device_id TEXT,
                    app_session_token TEXT,
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                );
                CREATE TABLE IF NOT EXISTS revoked_tokens (
                    token_hash TEXT PRIMARY KEY,
                    revoked_at TEXT DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS encrypted_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    target TEXT NOT NULL,
                    type TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    ts INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                );
                CREATE TABLE IF NOT EXISTS message_deliveries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    source_device_id TEXT NOT NULL,
                    target_device_id TEXT NOT NULL,
                    acked_at TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    UNIQUE (message_id, target_device_id)
                );
                CREATE TABLE IF NOT EXISTS connection_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    ip TEXT,
                    event TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions(namespace);
                CREATE INDEX IF NOT EXISTS idx_sm_device ON session_memberships(device_id);
                CREATE INDEX IF NOT EXISTS idx_sm_session ON session_memberships(session_id);
                CREATE INDEX IF NOT EXISTS idx_em_session_ts ON encrypted_messages(session_id, ts);
                CREATE INDEX IF NOT EXISTS idx_md_target_pending ON message_deliveries(target_device_id, acked_at);
                CREATE INDEX IF NOT EXISTS idx_md_session ON message_deliveries(session_id);
                CREATE INDEX IF NOT EXISTS idx_md_target_pending_id ON message_deliveries(target_device_id, acked_at, id);",
            )?;
            let _ = conn.execute(
                "ALTER TABLE sessions ADD COLUMN version INTEGER DEFAULT 1",
                [],
            );
            let _ = conn.execute(
                "ALTER TABLE sessions ADD COLUMN namespace TEXT NOT NULL DEFAULT ?",
                [DEFAULT_NAMESPACE],
            );
            let _ = conn.execute("ALTER TABLE devices ADD COLUMN fcm_token TEXT", []);
            Ok(())
        })
    }

    pub fn create_session(&self, id: &str, namespace: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (id, namespace) VALUES (?, ?)",
                params![id, normalize_namespace(Some(namespace))],
            )?;
            Ok(())
        })
    }

    pub fn get_messages(&self, session_id: &str) -> Result<Vec<SessionMessageRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, session_id, role, content, created_at
                 FROM messages
                 WHERE session_id = ?
                 ORDER BY id",
            )?;
            let rows = stmt.query_map(params![session_id], |row| {
                Ok(SessionMessageRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn get_session_namespace(&self, session_id: &str) -> Result<Option<String>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT namespace FROM sessions WHERE id = ?")?;
            let mut rows = stmt.query([session_id])?;
            if let Some(row) = rows.next()? {
                let value: Option<String> = row.get(0)?;
                Ok(value)
            } else {
                Ok(None)
            }
        })
    }

    pub fn add_device(
        &self,
        id: &str,
        public_key: &str,
        role: &str,
        session_id: &str,
        session_token: &str,
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO devices (id, public_key, role, session_id, session_token) VALUES (?, ?, ?, ?, ?)",
                params![id, public_key, role, session_id, session_token],
            )?;
            conn.execute(
                "INSERT INTO session_memberships (device_id, session_id, role)
                 VALUES (?, ?, ?)
                 ON CONFLICT(device_id, session_id) DO UPDATE SET
                    role = excluded.role,
                    last_seen = datetime('now')",
                params![id, session_id, role],
            )?;
            Ok(())
        })
    }

    pub fn get_devices_by_session(&self, session_id: &str) -> Result<Vec<DeviceRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT id FROM devices WHERE session_id = ?")?;
            let rows = stmt.query_map([session_id], |row| Ok(DeviceRow { id: row.get(0)? }))?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn get_devices_by_session_with_tokens(
        &self,
        session_id: &str,
    ) -> Result<Vec<DeviceTokenRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, role, session_token FROM devices WHERE session_id = ?",
            )?;
            let rows = stmt.query_map([session_id], |row| {
                Ok(DeviceTokenRow {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    session_token: row.get(2)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn create_pairing_request(
        &self,
        code: &str,
        session_id: &str,
        agent_public_key: &str,
        agent_device_id: &str,
        session_token: &str,
        expires_at: &str,
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO pairing_requests (code, session_id, agent_public_key, agent_device_id, session_token, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    code,
                    session_id,
                    agent_public_key,
                    agent_device_id,
                    session_token,
                    expires_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_pairing_request(&self, code: &str) -> Result<Option<PairingRequestRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT session_id, agent_public_key, expires_at, joined, app_public_key
                 FROM pairing_requests WHERE code = ?",
            )?;
            let mut rows = stmt.query([code])?;
            if let Some(row) = rows.next()? {
                Ok(Some(PairingRequestRow {
                    session_id: row.get(0)?,
                    agent_public_key: row.get(1)?,
                    expires_at: row.get(2)?,
                    joined: row.get::<_, i64>(3)? != 0,
                    app_public_key: row.get(4)?,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn join_pairing_request(
        &self,
        code: &str,
        app_public_key: &str,
        app_device_id: &str,
        app_session_token: &str,
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE pairing_requests
                 SET joined = 1, app_public_key = ?, app_device_id = ?, app_session_token = ?
                 WHERE code = ?",
                params![app_public_key, app_device_id, app_session_token, code],
            )?;
            Ok(())
        })
    }

    pub fn revoke_token(&self, token: &str) -> Result<(), String> {
        let hash = hash_token(token);
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO revoked_tokens (token_hash) VALUES (?)",
                params![hash],
            )?;
            Ok(())
        })
    }

    pub fn is_token_revoked(&self, token: &str) -> Result<bool, String> {
        let hash = hash_token(token);
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM revoked_tokens WHERE token_hash = ?")?;
            let mut rows = stmt.query([hash])?;
            Ok(rows.next()?.is_some())
        })
    }

    pub fn get_device_by_token(&self, token: &str) -> Result<Option<DeviceRow>, String> {
        self.with_conn(|conn| {
            let mut stmt =
                conn.prepare("SELECT id FROM devices WHERE session_token = ?")?;
            let mut rows = stmt.query([token])?;
            if let Some(row) = rows.next()? {
                Ok(Some(DeviceRow {
                    id: row.get(0)?,
                }))
            } else {
                Ok(None)
            }
        })
    }

    pub fn update_device_token(&self, device_id: &str, new_token: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE devices SET session_token = ? WHERE id = ?",
                params![new_token, device_id],
            )?;
            Ok(())
        })
    }

    pub fn update_device_session(
        &self,
        device_id: &str,
        session_id: &str,
        session_token: &str,
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE devices SET session_id = ?, session_token = ? WHERE id = ?",
                params![session_id, session_token, device_id],
            )?;
            Ok(())
        })
    }

    pub fn upsert_session_membership(
        &self,
        device_id: &str,
        session_id: &str,
        role: &str,
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO session_memberships (device_id, session_id, role)
                 VALUES (?, ?, ?)
                 ON CONFLICT(device_id, session_id) DO UPDATE SET
                   role = excluded.role,
                   last_seen = datetime('now')",
                params![device_id, session_id, role],
            )?;
            Ok(())
        })
    }

    pub fn get_session_memberships_by_namespace(
        &self,
        device_id: &str,
        namespace: &str,
    ) -> Result<Vec<SessionMembershipRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT sm.session_id, sm.role,
                        CAST(strftime('%s', sm.first_seen) AS INTEGER) * 1000 AS first_seen_ts,
                        CAST(strftime('%s', sm.last_seen) AS INTEGER) * 1000 AS last_seen_ts
                 FROM session_memberships sm
                 JOIN sessions s ON s.id = sm.session_id
                 WHERE sm.device_id = ? AND s.namespace = ?
                 ORDER BY sm.last_seen DESC",
            )?;
            let rows = stmt.query_map(params![device_id, namespace], |row| {
                Ok(SessionMembershipRow {
                    session_id: row.get(0)?,
                    role: row.get(1)?,
                    first_seen_ts: row.get(2)?,
                    last_seen_ts: row.get(3)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn session_belongs_to_namespace(
        &self,
        session_id: &str,
        namespace: &str,
    ) -> Result<bool, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM sessions WHERE id = ? AND namespace = ?")?;
            let mut rows = stmt.query(params![session_id, namespace])?;
            Ok(rows.next()?.is_some())
        })
    }

    pub fn session_exists(&self, session_id: &str, namespace: &str) -> Result<bool, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM sessions WHERE id = ? AND namespace = ?")?;
            let mut rows = stmt.query(params![session_id, namespace])?;
            Ok(rows.next()?.is_some())
        })
    }

    pub fn get_session_version(
        &self,
        session_id: &str,
        namespace: &str,
    ) -> Result<Option<i64>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT version FROM sessions WHERE id = ? AND namespace = ?")?;
            let mut rows = stmt.query(params![session_id, namespace])?;
            if let Some(row) = rows.next()? {
                Ok(Some(row.get(0)?))
            } else {
                Ok(None)
            }
        })
    }

    pub fn increment_session_version(
        &self,
        session_id: &str,
        expected_version: i64,
        namespace: &str,
    ) -> Result<bool, String> {
        self.with_conn(|conn| {
            let result = conn.execute(
                "UPDATE sessions SET version = version + 1 WHERE id = ? AND namespace = ? AND version = ?",
                params![session_id, namespace, expected_version],
            )?;
            Ok(result > 0)
        })
    }

    pub fn save_encrypted_message(&self, message: &EncryptedMessageRow) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO encrypted_messages (id, session_id, source, target, type, seq, ts, payload)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    message.id,
                    message.session_id,
                    message.source,
                    message.target,
                    message.message_type,
                    message.seq,
                    message.ts,
                    message.payload
                ],
            )?;
            Ok(())
        })
    }

    pub fn get_encrypted_messages(
        &self,
        session_id: &str,
        after_ts: i64,
        limit: usize,
        after_cursor: i64,
    ) -> Result<Vec<EncryptedMessageCursorRow>, String> {
        self.with_conn(|conn| {
            let mut result = Vec::new();
            if after_cursor > 0 {
                let mut stmt = conn.prepare(
                    "SELECT rowid AS cursor, id, session_id, source, target, type, seq, ts, payload
                     FROM encrypted_messages
                     WHERE session_id = ? AND rowid > ?
                     ORDER BY rowid ASC
                     LIMIT ?",
                )?;
                let rows = stmt.query_map(
                    params![session_id, after_cursor, limit as i64],
                    |row| {
                        Ok(EncryptedMessageCursorRow {
                            cursor: row.get(0)?,
                            id: row.get(1)?,
                            session_id: row.get(2)?,
                            source: row.get(3)?,
                            target: row.get(4)?,
                            message_type: row.get(5)?,
                            seq: row.get(6)?,
                            ts: row.get(7)?,
                            payload: row.get(8)?,
                        })
                    },
                )?;
                for row in rows {
                    result.push(row?);
                }
                return Ok(result);
            }
            let mut stmt = conn.prepare(
                "SELECT rowid AS cursor, id, session_id, source, target, type, seq, ts, payload
                 FROM encrypted_messages
                 WHERE session_id = ? AND ts > ?
                 ORDER BY rowid ASC
                 LIMIT ?",
            )?;
            let rows = stmt.query_map(params![session_id, after_ts, limit as i64], |row| {
                Ok(EncryptedMessageCursorRow {
                    cursor: row.get(0)?,
                    id: row.get(1)?,
                    session_id: row.get(2)?,
                    source: row.get(3)?,
                    target: row.get(4)?,
                    message_type: row.get(5)?,
                    seq: row.get(6)?,
                    ts: row.get(7)?,
                    payload: row.get(8)?,
                })
            })?;
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn queue_deliveries_batch(&self, rows: &[DeliveryRow]) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        self.with_conn(|conn| {
            for row in rows {
                conn.execute(
                    "INSERT OR IGNORE INTO message_deliveries (message_id, session_id, source_device_id, target_device_id)
                     VALUES (?, ?, ?, ?)",
                    params![row.message_id, row.session_id, row.source_device_id, row.target_device_id],
                )?;
            }
            Ok(())
        })
    }

    pub fn mark_delivery_acked(&self, message_id: &str, target_device_id: &str) -> Result<bool, String> {
        self.with_conn(|conn| {
            let result = conn.execute(
                "UPDATE message_deliveries
                 SET acked_at = datetime('now')
                 WHERE message_id = ? AND target_device_id = ? AND acked_at IS NULL",
                params![message_id, target_device_id],
            )?;
            Ok(result > 0)
        })
    }

    pub fn get_pending_deliveries(
        &self,
        target_device_id: &str,
        limit: usize,
    ) -> Result<Vec<EncryptedMessageRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT em.id, em.session_id, em.source, em.target, em.type, em.seq, em.ts, em.payload
                 FROM message_deliveries md
                 JOIN encrypted_messages em ON md.message_id = em.id
                 WHERE md.target_device_id = ? AND md.acked_at IS NULL
                 ORDER BY md.id ASC
                 LIMIT ?",
            )?;
            let rows = stmt.query_map(params![target_device_id, limit as i64], |row| {
                Ok(EncryptedMessageRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    source: row.get(2)?,
                    target: row.get(3)?,
                    message_type: row.get(4)?,
                    seq: row.get(5)?,
                    ts: row.get(6)?,
                    payload: row.get(7)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn log_connection(
        &self,
        device_id: &str,
        session_id: &str,
        role: &str,
        ip: Option<&str>,
        event: &str,
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO connection_logs (device_id, session_id, role, ip, event) VALUES (?, ?, ?, ?, ?)",
                params![device_id, session_id, role, ip, event],
            )?;
            Ok(())
        })
    }

    pub fn get_connection_logs(&self, session_id: &str, limit: usize) -> Result<Vec<ConnectionLogRow>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, device_id, session_id, role, ip, event, created_at
                 FROM connection_logs
                 WHERE session_id = ?
                 ORDER BY id DESC
                 LIMIT ?",
            )?;
            let rows = stmt.query_map(params![session_id, limit as i64], |row| {
                Ok(ConnectionLogRow {
                    id: row.get(0)?,
                    device_id: row.get(1)?,
                    session_id: row.get(2)?,
                    role: row.get(3)?,
                    ip: row.get(4)?,
                    event: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    pub fn update_fcm_token(&self, device_id: &str, fcm_token: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE devices SET fcm_token = ? WHERE id = ?",
                params![fcm_token, device_id],
            )?;
            Ok(())
        })
    }

    pub fn clear_fcm_token_by_value(&self, fcm_token: &str) -> Result<usize, String> {
        self.with_conn(|conn| {
            let result = conn.execute(
                "UPDATE devices SET fcm_token = NULL WHERE fcm_token = ?",
                params![fcm_token],
            )?;
            Ok(result)
        })
    }

    pub fn get_fcm_tokens_by_session(&self, session_id: &str, role: &str) -> Result<Vec<String>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT fcm_token FROM devices WHERE session_id = ? AND role = ? AND fcm_token IS NOT NULL",
            )?;
            let rows = stmt.query_map(params![session_id, role], |row| row.get(0))?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>) -> Result<T, String> {
        let conn = self.conn.lock().map_err(|_| "db locked".to_string())?;
        f(&conn).map_err(|err| err.to_string())
    }
}

fn hash_token(token: &str) -> String {
    let hash = WyHash64::hash_with_seed(token.as_bytes(), 0);
    format!("{:x}", hash)
}

#[cfg(test)]
mod tests {
    use super::{hash_token, DeliveryRow, EncryptedMessageRow, RelayDb};
    use crate::config::RelayConfig;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn bun_hash_compat() {
        assert_eq!(hash_token("abc"), "2a4f1d7cb516c72");
    }

    fn test_db_path(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("yuanio-{label}-{suffix}.db"))
    }

    fn test_config(path: PathBuf) -> RelayConfig {
        RelayConfig {
            host: "127.0.0.1".to_string(),
            port: 0,
            jwt_secret: "x".repeat(32),
            require_protocol_version: false,
            db_path: path,
            db_busy_timeout_ms: 0,
            db_fast_write_mode: false,
            fcm_token_max_length: 4096,
            fcm_enabled: false,
            push_register_rate_limit_max: 1,
            push_register_rate_limit_window_ms: 1_000,
        }
    }

    #[test]
    fn queue_deliveries_roundtrip() {
        let path = test_db_path("relay-queue");
        let db = RelayDb::new(&test_config(path.clone())).expect("db init");
        let session_id = "session-1";
        let agent_id = "agent-1";
        let app_id = "app-1";

        db.create_session(session_id, "default").expect("create session");
        db.add_device(agent_id, "agent-pk", "agent", session_id, "agent-token")
            .expect("add agent");
        db.add_device(app_id, "app-pk", "app", session_id, "app-token")
            .expect("add app");

        let message_id = "msg-1";
        db.save_encrypted_message(&EncryptedMessageRow {
            id: message_id.to_string(),
            session_id: session_id.to_string(),
            source: agent_id.to_string(),
            target: "broadcast".to_string(),
            message_type: "prompt".to_string(),
            seq: 1,
            ts: 123,
            payload: "payload".to_string(),
        })
        .expect("save message");

        let row = DeliveryRow {
            message_id: message_id.to_string(),
            session_id: session_id.to_string(),
            source_device_id: agent_id.to_string(),
            target_device_id: app_id.to_string(),
        };
        db.queue_deliveries_batch(&[row.clone()]).expect("queue");
        db.queue_deliveries_batch(&[row]).expect("dedupe");

        let pending = db.get_pending_deliveries(app_id, 10).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, message_id);

        assert!(!db
            .mark_delivery_acked("missing", app_id)
            .expect("ack missing"));
        assert!(db
            .mark_delivery_acked(message_id, app_id)
            .expect("ack present"));

        let pending = db.get_pending_deliveries(app_id, 10).expect("pending empty");
        assert!(pending.is_empty());

        let _ = std::fs::remove_file(path);
    }
}
