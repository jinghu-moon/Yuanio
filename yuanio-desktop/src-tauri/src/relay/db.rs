use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use super::config::RelayConfig;
use super::protocol::normalize_namespace;

#[derive(Debug, Clone)]
pub struct EncryptedMessageRow {
    pub id: String,
    pub session_id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub seq: i64,
    pub ts: i64,
    pub payload: String,
}

#[derive(Debug, Clone)]
pub struct EncryptedMessageCursorRow {
    pub cursor: i64,
    pub id: String,
    pub session_id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
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

#[derive(Debug, Clone)]
pub struct DeviceRow {
    pub id: String,
    pub role: String,
}

#[derive(Debug, Clone)]
pub struct DeviceRowWithToken {
    pub id: String,
    pub role: String,
    pub session_token: String,
}

#[derive(Debug, Clone)]
pub struct PairingRequestRow {
    pub code: String,
    pub session_id: String,
    pub agent_public_key: String,
    pub agent_device_id: String,
    pub session_token: String,
    pub expires_at: String,
    pub joined: bool,
    pub app_public_key: Option<String>,
    pub app_device_id: Option<String>,
    pub app_session_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionMembershipRow {
    pub session_id: String,
    pub role: String,
    pub first_seen_ts: i64,
    pub last_seen_ts: i64,
}

#[derive(Debug, Clone)]
pub struct MessageRow {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct ConnectionLogRow {
    pub id: i64,
    pub device_id: String,
    pub session_id: String,
    pub role: String,
    pub ip: Option<String>,
    pub event: String,
    pub created_at: String,
}

pub struct RelayDb {
    conn: Mutex<Connection>,
}

impl RelayDb {
    pub fn new(config: &RelayConfig) -> Result<Self, String> {
        let conn = Connection::open(&config.db_path).map_err(|e| e.to_string())?;
        if config.db_fast_write_mode {
            let _ = conn.execute_batch("PRAGMA journal_mode = WAL;");
            let _ = conn.execute_batch("PRAGMA synchronous = NORMAL;");
            let _ = conn.execute_batch("PRAGMA temp_store = MEMORY;");
        }
        if config.db_busy_timeout_ms > 0 {
            let _ = conn.busy_timeout(Duration::from_millis(config.db_busy_timeout_ms));
        }
        init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn create_session(&self, id: &str, namespace: &str) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO sessions (id, namespace) VALUES (?, ?)",
            params![id, normalize_namespace(Some(namespace))],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_session_namespace(&self, session_id: &str) -> Result<Option<String>, String> {
        let conn = self.lock()?;
        let row: Option<String> = conn
            .query_row(
                "SELECT namespace FROM sessions WHERE id = ?",
                params![session_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row.map(|v| normalize_namespace(Some(&v))))
    }

    pub fn session_belongs_to_namespace(
        &self,
        session_id: &str,
        namespace: &str,
    ) -> Result<bool, String> {
        let conn = self.lock()?;
        let row: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM sessions WHERE id = ? AND namespace = ?",
                params![session_id, normalize_namespace(Some(namespace))],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row.is_some())
    }

    pub fn upsert_session_membership(
        &self,
        device_id: &str,
        session_id: &str,
        role: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO session_memberships (device_id, session_id, role)
             VALUES (?, ?, ?)
             ON CONFLICT(device_id, session_id) DO UPDATE SET
               role = excluded.role,
               last_seen = datetime('now')",
            params![device_id, session_id, role],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_devices_by_session(&self, session_id: &str) -> Result<Vec<DeviceRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare("SELECT id, role FROM devices WHERE session_id = ?")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(DeviceRow {
                    id: row.get(0)?,
                    role: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn add_device(
        &self,
        id: &str,
        public_key: &str,
        role: &str,
        session_id: &str,
        session_token: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO devices (id, public_key, role, session_id, session_token)
             VALUES (?, ?, ?, ?, ?)",
            params![id, public_key, role, session_id, session_token],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO session_memberships (device_id, session_id, role)
             VALUES (?, ?, ?)
             ON CONFLICT(device_id, session_id) DO UPDATE SET
               role = excluded.role,
               last_seen = datetime('now')",
            params![id, session_id, role],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_device_by_token(&self, token: &str) -> Result<Option<DeviceRowWithToken>, String> {
        let conn = self.lock()?;
        let row = conn
            .query_row(
                "SELECT id, role, session_token FROM devices WHERE session_token = ?",
                params![token],
                |r| {
                    Ok(DeviceRowWithToken {
                        id: r.get(0)?,
                        role: r.get(1)?,
                        session_token: r.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row)
    }

    pub fn get_devices_by_session_with_tokens(
        &self,
        session_id: &str,
    ) -> Result<Vec<DeviceRowWithToken>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare("SELECT id, role, session_token FROM devices WHERE session_id = ?")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(DeviceRowWithToken {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    session_token: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn update_device_session(
        &self,
        device_id: &str,
        session_id: &str,
        session_token: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE devices SET session_id = ?, session_token = ? WHERE id = ?",
            params![session_id, session_token, device_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_device_token(&self, device_id: &str, new_token: &str) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE devices SET session_token = ? WHERE id = ?",
            params![new_token, device_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_fcm_token(&self, device_id: &str, fcm_token: &str) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE devices SET fcm_token = ? WHERE id = ?",
            params![fcm_token, device_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_fcm_tokens_by_session(
        &self,
        session_id: &str,
        role: &str,
    ) -> Result<Vec<String>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT fcm_token FROM devices WHERE session_id = ? AND role = ? AND fcm_token IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id, role], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            let token: String = row.map_err(|e| e.to_string())?;
            result.push(token);
        }
        Ok(result)
    }

    pub fn clear_fcm_token_by_value(&self, fcm_token: &str) -> Result<usize, String> {
        let conn = self.lock()?;
        let changes = conn
            .execute(
                "UPDATE devices SET fcm_token = NULL WHERE fcm_token = ?",
                params![fcm_token],
            )
            .map_err(|e| e.to_string())?;
        Ok(changes)
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
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO pairing_requests
             (code, session_id, agent_public_key, agent_device_id, session_token, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![
                code,
                session_id,
                agent_public_key,
                agent_device_id,
                session_token,
                expires_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_pairing_request(&self, code: &str) -> Result<Option<PairingRequestRow>, String> {
        let conn = self.lock()?;
        let row = conn
            .query_row(
                "SELECT code, session_id, agent_public_key, agent_device_id, session_token, expires_at,
                        joined, app_public_key, app_device_id, app_session_token
                 FROM pairing_requests WHERE code = ?",
                params![code],
                |r| {
                    let joined: i64 = r.get(6)?;
                    Ok(PairingRequestRow {
                        code: r.get(0)?,
                        session_id: r.get(1)?,
                        agent_public_key: r.get(2)?,
                        agent_device_id: r.get(3)?,
                        session_token: r.get(4)?,
                        expires_at: r.get(5)?,
                        joined: joined != 0,
                        app_public_key: r.get(7)?,
                        app_device_id: r.get(8)?,
                        app_session_token: r.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row)
    }

    pub fn join_pairing_request(
        &self,
        code: &str,
        app_public_key: &str,
        app_device_id: &str,
        app_session_token: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE pairing_requests
             SET joined = 1, app_public_key = ?, app_device_id = ?, app_session_token = ?
             WHERE code = ?",
            params![app_public_key, app_device_id, app_session_token, code],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
            params![session_id, role, content],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_messages(&self, session_id: &str) -> Result<Vec<MessageRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, created_at
                 FROM messages WHERE session_id = ? ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(MessageRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn touch_session_membership(
        &self,
        device_id: &str,
        session_id: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE session_memberships SET last_seen = datetime('now') WHERE device_id = ? AND session_id = ?",
            params![device_id, session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_session_memberships(
        &self,
        device_id: &str,
    ) -> Result<Vec<SessionMembershipRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT sm.session_id, sm.role,
                        CAST(strftime('%s', sm.first_seen) AS INTEGER) * 1000 AS first_seen_ts,
                        CAST(strftime('%s', sm.last_seen) AS INTEGER) * 1000 AS last_seen_ts
                 FROM session_memberships sm
                 WHERE sm.device_id = ?
                 ORDER BY sm.last_seen DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![device_id], |row| {
                Ok(SessionMembershipRow {
                    session_id: row.get(0)?,
                    role: row.get(1)?,
                    first_seen_ts: row.get(2)?,
                    last_seen_ts: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn get_session_memberships_by_namespace(
        &self,
        device_id: &str,
        namespace: &str,
    ) -> Result<Vec<SessionMembershipRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT sm.session_id, sm.role,
                        CAST(strftime('%s', sm.first_seen) AS INTEGER) * 1000 AS first_seen_ts,
                        CAST(strftime('%s', sm.last_seen) AS INTEGER) * 1000 AS last_seen_ts
                 FROM session_memberships sm
                 JOIN sessions s ON s.id = sm.session_id
                 WHERE sm.device_id = ? AND s.namespace = ?
                 ORDER BY sm.last_seen DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![device_id, normalize_namespace(Some(namespace))], |row| {
                Ok(SessionMembershipRow {
                    session_id: row.get(0)?,
                    role: row.get(1)?,
                    first_seen_ts: row.get(2)?,
                    last_seen_ts: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn save_encrypted_message(&self, row: EncryptedMessageRow) -> Result<(), String> {
        let rows = [row];
        self.save_encrypted_messages_batch(&rows)
    }

    pub fn save_encrypted_messages_batch(&self, rows: &[EncryptedMessageRow]) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR IGNORE INTO encrypted_messages
                     (id, session_id, source, target, type, seq, ts, payload)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .map_err(|e| e.to_string())?;
            for row in rows {
                stmt.execute(params![
                    row.id,
                    row.session_id,
                    row.source,
                    row.target,
                    row.kind,
                    row.seq,
                    row.ts,
                    row.payload
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_encrypted_messages(
        &self,
        session_id: &str,
        after_ts: i64,
        limit: usize,
        after_cursor: i64,
    ) -> Result<Vec<EncryptedMessageCursorRow>, String> {
        let conn = self.lock()?;
        let (sql, params) = if after_cursor > 0 {
            (
                "SELECT rowid AS cursor, id, session_id, source, target, type, seq, ts, payload
                 FROM encrypted_messages
                 WHERE session_id = ? AND rowid > ?
                 ORDER BY rowid ASC
                 LIMIT ?",
                params![session_id, after_cursor, limit as i64],
            )
        } else {
            (
                "SELECT rowid AS cursor, id, session_id, source, target, type, seq, ts, payload
                 FROM encrypted_messages
                 WHERE session_id = ? AND ts > ?
                 ORDER BY rowid ASC
                 LIMIT ?",
                params![session_id, after_ts, limit as i64],
            )
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params, |row| {
                Ok(EncryptedMessageCursorRow {
                    cursor: row.get(0)?,
                    id: row.get(1)?,
                    session_id: row.get(2)?,
                    source: row.get(3)?,
                    target: row.get(4)?,
                    kind: row.get(5)?,
                    seq: row.get(6)?,
                    ts: row.get(7)?,
                    payload: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn queue_delivery(
        &self,
        message_id: &str,
        session_id: &str,
        source_device_id: &str,
        target_device_id: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT OR IGNORE INTO message_deliveries
             (message_id, session_id, source_device_id, target_device_id)
             VALUES (?, ?, ?, ?)",
            params![message_id, session_id, source_device_id, target_device_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn queue_deliveries_batch(&self, rows: &[DeliveryRow]) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR IGNORE INTO message_deliveries
                     (message_id, session_id, source_device_id, target_device_id)
                     VALUES (?, ?, ?, ?)",
                )
                .map_err(|e| e.to_string())?;
            for row in rows {
                stmt.execute(params![
                    row.message_id,
                    row.session_id,
                    row.source_device_id,
                    row.target_device_id
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_delivery_acked(
        &self,
        message_id: &str,
        target_device_id: &str,
    ) -> Result<bool, String> {
        let conn = self.lock()?;
        let changes = conn
            .execute(
                "UPDATE message_deliveries
                 SET acked_at = datetime('now')
                 WHERE message_id = ? AND target_device_id = ? AND acked_at IS NULL",
                params![message_id, target_device_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(changes > 0)
    }

    pub fn get_pending_deliveries(
        &self,
        target_device_id: &str,
        limit: usize,
    ) -> Result<Vec<EncryptedMessageRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT em.id, em.session_id, em.source, em.target, em.type, em.seq, em.ts, em.payload
                 FROM message_deliveries md
                 JOIN encrypted_messages em ON md.message_id = em.id
                 WHERE md.target_device_id = ? AND md.acked_at IS NULL
                 ORDER BY md.id ASC
                 LIMIT ?",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![target_device_id, limit as i64], |row| {
                Ok(EncryptedMessageRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    source: row.get(2)?,
                    target: row.get(3)?,
                    kind: row.get(4)?,
                    seq: row.get(5)?,
                    ts: row.get(6)?,
                    payload: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn revoke_token(&self, token: &str) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT OR IGNORE INTO revoked_tokens (token_hash) VALUES (?)",
            params![hash_token(token)],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn is_token_revoked(&self, token: &str) -> Result<bool, String> {
        let conn = self.lock()?;
        let row: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM revoked_tokens WHERE token_hash = ?",
                params![hash_token(token)],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(row.is_some())
    }

    pub fn log_connection(
        &self,
        device_id: &str,
        session_id: &str,
        role: &str,
        ip: Option<&str>,
        event: &str,
    ) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO connection_logs (device_id, session_id, role, ip, event)
             VALUES (?, ?, ?, ?, ?)",
            params![device_id, session_id, role, ip, event],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_connection_logs(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<ConnectionLogRow>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, device_id, session_id, role, ip, event, created_at
                 FROM connection_logs WHERE session_id = ?
                 ORDER BY id DESC LIMIT ?",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                Ok(ConnectionLogRow {
                    id: row.get(0)?,
                    device_id: row.get(1)?,
                    session_id: row.get(2)?,
                    role: row.get(3)?,
                    ip: row.get(4)?,
                    event: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub fn get_session_version(
        &self,
        session_id: &str,
        namespace: Option<&str>,
    ) -> Result<Option<i64>, String> {
        let conn = self.lock()?;
        let row: Option<i64> = if let Some(namespace) = namespace {
            conn.query_row(
                "SELECT version FROM sessions WHERE id = ? AND namespace = ?",
                params![session_id, normalize_namespace(Some(namespace))],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        } else {
            conn.query_row(
                "SELECT version FROM sessions WHERE id = ?",
                params![session_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };
        Ok(row)
    }

    pub fn session_exists(
        &self,
        session_id: &str,
        namespace: Option<&str>,
    ) -> Result<bool, String> {
        let conn = self.lock()?;
        let row: Option<i64> = if let Some(namespace) = namespace {
            conn.query_row(
                "SELECT 1 FROM sessions WHERE id = ? AND namespace = ?",
                params![session_id, normalize_namespace(Some(namespace))],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        } else {
            conn.query_row(
                "SELECT 1 FROM sessions WHERE id = ?",
                params![session_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };
        Ok(row.is_some())
    }

    pub fn increment_session_version(
        &self,
        session_id: &str,
        expected_version: i64,
        namespace: Option<&str>,
    ) -> Result<bool, String> {
        let conn = self.lock()?;
        let changes = if let Some(namespace) = namespace {
            conn.execute(
                "UPDATE sessions SET version = version + 1
                 WHERE id = ? AND namespace = ? AND version = ?",
                params![session_id, normalize_namespace(Some(namespace)), expected_version],
            )
        } else {
            conn.execute(
                "UPDATE sessions SET version = version + 1
                 WHERE id = ? AND version = ?",
                params![session_id, expected_version],
            )
        }
        .map_err(|e| e.to_string())?;
        Ok(changes > 0)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|_| "db lock poisoned".to_string())
    }
}

fn init_schema(conn: &Connection) -> Result<(), String> {
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
            fcm_token TEXT,
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
         );",
    )
    .map_err(|e| e.to_string())?;

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions(namespace);
         CREATE INDEX IF NOT EXISTS idx_sm_device ON session_memberships(device_id);
         CREATE INDEX IF NOT EXISTS idx_sm_session ON session_memberships(session_id);
         CREATE INDEX IF NOT EXISTS idx_em_session_ts ON encrypted_messages(session_id, ts);
         CREATE INDEX IF NOT EXISTS idx_md_target_pending ON message_deliveries(target_device_id, acked_at);
         CREATE INDEX IF NOT EXISTS idx_md_session ON message_deliveries(session_id);
         CREATE INDEX IF NOT EXISTS idx_md_target_pending_id ON message_deliveries(target_device_id, acked_at, id);",
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    format!("{:x}", digest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::config::RelayConfig;

    fn test_db() -> RelayDb {
        let config = RelayConfig {
            port: 0,
            db_path: ":memory:".to_string(),
            db_busy_timeout_ms: 0,
            db_fast_write_mode: false,
            jwt_secret: "x".repeat(32),
            require_protocol_version: false,
            max_payload_bytes: 1024 * 1024,
        };
        RelayDb::new(&config).expect("create relay db")
    }

    #[test]
    fn save_encrypted_message_ignores_duplicate_ids() {
        let db = test_db();
        db.create_session("sess_1", "default").unwrap();
        let row = EncryptedMessageRow {
            id: "msg_1".to_string(),
            session_id: "sess_1".to_string(),
            source: "dev_a".to_string(),
            target: "dev_b".to_string(),
            kind: "prompt".to_string(),
            seq: 1,
            ts: 100,
            payload: "payload".to_string(),
        };
        assert!(db.save_encrypted_message(row.clone()).is_ok());
        let second = db.save_encrypted_message(row);
        assert!(second.is_ok(), "duplicate insert should be ignored");
    }

    #[test]
    fn pairing_request_roundtrip() {
        let db = test_db();
        db.create_session("sess_1", "default").unwrap();
        db.create_pairing_request(
            "CODE1",
            "sess_1",
            "agent_pk",
            "agent_dev",
            "agent_token",
            "2099-01-01T00:00:00Z",
        )
        .unwrap();
        let req = db.get_pairing_request("CODE1").unwrap().expect("missing request");
        assert!(!req.joined);
        db.join_pairing_request("CODE1", "app_pk", "app_dev", "app_token")
            .unwrap();
        let joined = db.get_pairing_request("CODE1").unwrap().expect("missing request");
        assert!(joined.joined);
        assert_eq!(joined.app_public_key.as_deref(), Some("app_pk"));
        assert_eq!(joined.app_device_id.as_deref(), Some("app_dev"));
    }

    #[test]
    fn device_token_and_session_updates() {
        let db = test_db();
        db.create_session("sess_1", "default").unwrap();
        db.add_device("dev_1", "pk", "agent", "sess_1", "token_1")
            .unwrap();
        let device = db.get_device_by_token("token_1").unwrap().expect("device");
        assert_eq!(device.id, "dev_1");

        db.update_device_token("dev_1", "token_2").unwrap();
        assert!(db.get_device_by_token("token_1").unwrap().is_none());
        assert_eq!(
            db.get_device_by_token("token_2").unwrap().expect("device").id,
            "dev_1"
        );

        db.create_session("sess_2", "default").unwrap();
        db.update_device_session("dev_1", "sess_2", "token_3")
            .unwrap();
        let devices = db.get_devices_by_session_with_tokens("sess_2").unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].session_token, "token_3");
    }

    #[test]
    fn fcm_token_management() {
        let db = test_db();
        db.create_session("sess_1", "default").unwrap();
        db.add_device("dev_1", "pk", "app", "sess_1", "token_1")
            .unwrap();
        db.update_fcm_token("dev_1", "fcm_1").unwrap();
        let tokens = db.get_fcm_tokens_by_session("sess_1", "app").unwrap();
        assert_eq!(tokens, vec!["fcm_1".to_string()]);
        let cleared = db.clear_fcm_token_by_value("fcm_1").unwrap();
        assert_eq!(cleared, 1);
        let empty = db.get_fcm_tokens_by_session("sess_1", "app").unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn session_membership_queries_by_namespace() {
        let db = test_db();
        db.create_session("sess_a", "alpha").unwrap();
        db.create_session("sess_b", "beta").unwrap();
        db.upsert_session_membership("dev_1", "sess_a", "agent").unwrap();
        db.upsert_session_membership("dev_1", "sess_b", "app").unwrap();

        let all = db.get_session_memberships("dev_1").unwrap();
        assert_eq!(all.len(), 2);

        let alpha = db
            .get_session_memberships_by_namespace("dev_1", "alpha")
            .unwrap();
        assert_eq!(alpha.len(), 1);
        assert_eq!(alpha[0].session_id, "sess_a");

        db.touch_session_membership("dev_1", "sess_a").unwrap();
    }

    #[test]
    fn session_version_occ() {
        let db = test_db();
        db.create_session("sess_1", "default").unwrap();
        let version = db.get_session_version("sess_1", Some("default")).unwrap();
        assert_eq!(version, Some(1));
        assert!(db.increment_session_version("sess_1", 1, Some("default")).unwrap());
        let version = db.get_session_version("sess_1", Some("default")).unwrap();
        assert_eq!(version, Some(2));
        assert!(!db.increment_session_version("sess_1", 1, Some("default")).unwrap());
        assert!(db.session_exists("sess_1", Some("default")).unwrap());
    }

    #[test]
    fn encrypted_message_pagination() {
        let db = test_db();
        db.create_session("sess_1", "default").unwrap();
        let row1 = EncryptedMessageRow {
            id: "msg_1".to_string(),
            session_id: "sess_1".to_string(),
            source: "dev_a".to_string(),
            target: "dev_b".to_string(),
            kind: "prompt".to_string(),
            seq: 1,
            ts: 100,
            payload: "payload1".to_string(),
        };
        let row2 = EncryptedMessageRow {
            id: "msg_2".to_string(),
            session_id: "sess_1".to_string(),
            source: "dev_a".to_string(),
            target: "dev_b".to_string(),
            kind: "prompt".to_string(),
            seq: 2,
            ts: 200,
            payload: "payload2".to_string(),
        };
        db.save_encrypted_message(row1).unwrap();
        db.save_encrypted_message(row2).unwrap();
        let newer = db.get_encrypted_messages("sess_1", 150, 100, 0).unwrap();
        assert_eq!(newer.len(), 1);
        assert_eq!(newer[0].id, "msg_2");
    }

    #[test]
    fn connection_logs_roundtrip() {
        let db = test_db();
        db.log_connection("dev_1", "sess_1", "agent", None, "connect")
            .unwrap();
        let logs = db.get_connection_logs("sess_1", 10).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].event, "connect");
    }
}
