import { Database } from "bun:sqlite";
import { DEFAULT_NAMESPACE, loadRelayRuntimeEnv, normalizeNamespace } from "@yuanio/shared";

const { env: relayEnv } = loadRelayRuntimeEnv({ env: process.env, startDir: import.meta.dir });
const dbPath = relayEnv.YUANIO_DB_PATH || "yuanio.db";
const db = new Database(dbPath);
const DB_BUSY_TIMEOUT_MS = Number(relayEnv.YUANIO_DB_BUSY_TIMEOUT_MS ?? 3000);
const DB_FAST_WRITE_MODE = relayEnv.YUANIO_DB_FAST_WRITE_MODE !== "0";

// 鎻愬崌 ACK 楂橀鍐欏満鏅悶鍚愶細WAL + NORMAL锛屽噺灏?fsync 鍘嬪姏
if (DB_FAST_WRITE_MODE) {
  try { db.run("PRAGMA journal_mode = WAL"); } catch {}
  try { db.run("PRAGMA synchronous = NORMAL"); } catch {}
  try { db.run("PRAGMA temp_store = MEMORY"); } catch {}
}
if (Number.isFinite(DB_BUSY_TIMEOUT_MS) && DB_BUSY_TIMEOUT_MS > 0) {
  try { db.run(`PRAGMA busy_timeout = ${Math.floor(DB_BUSY_TIMEOUT_MS)}`); } catch {}
}

db.run(`CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL DEFAULT 'default',
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// 杩佺Щ锛氫负宸叉湁 sessions 琛ㄦ坊鍔?version 鍒?
try { db.run("ALTER TABLE sessions ADD COLUMN version INTEGER DEFAULT 1"); } catch {}
try { db.run(`ALTER TABLE sessions ADD COLUMN namespace TEXT NOT NULL DEFAULT '${DEFAULT_NAMESPACE}'`); } catch {}
db.run("CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions(namespace)");

db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  role TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_token TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
)`);

// 璁惧-浼氳瘽鎴愬憳鍏崇郴锛堢敤浜庝細璇濆垪琛ㄦ潈闄愶級
db.run(`CREATE TABLE IF NOT EXISTS session_memberships (
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  first_seen TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, session_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_sm_device ON session_memberships(device_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sm_session ON session_memberships(session_id)`);

db.run(`CREATE TABLE IF NOT EXISTS pairing_requests (
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
)`);

// Token 鍚婇攢琛?
db.run(`CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  revoked_at TEXT DEFAULT (datetime('now'))
)`);

// 瀵嗘枃娑堟伅鎸佷箙鍖栬〃
db.run(`CREATE TABLE IF NOT EXISTS encrypted_messages (
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
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_em_session_ts ON encrypted_messages(session_id, ts)`);

// ACK 浜や粯闃熷垪锛堟寜鐩爣璁惧锛?
db.run(`CREATE TABLE IF NOT EXISTS message_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  acked_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (message_id, target_device_id)
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_md_target_pending ON message_deliveries(target_device_id, acked_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_md_session ON message_deliveries(session_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_md_target_pending_id ON message_deliveries(target_device_id, acked_at, id)`);

// 杩炴帴鍏冩暟鎹棩蹇楄〃锛堜粎璋冭瘯鐢級
db.run(`CREATE TABLE IF NOT EXISTS connection_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ip TEXT,
  event TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

export function createSession(id: string, namespace: string = DEFAULT_NAMESPACE) {
  db.run("INSERT INTO sessions (id, namespace) VALUES (?, ?)", [id, normalizeNamespace(namespace)]);
  return { id };
}

export function saveMessage(sessionId: string, role: string, content: string) {
  db.run(
    "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
    [sessionId, role, content]
  );
}

export function getMessages(sessionId: string) {
  return db.query("SELECT * FROM messages WHERE session_id = ? ORDER BY id").all(sessionId);
}

export function getSessionNamespace(sessionId: string): string | null {
  const row = db.query("SELECT namespace FROM sessions WHERE id = ?").get(sessionId) as { namespace?: string } | null;
  if (!row?.namespace) return null;
  return normalizeNamespace(row.namespace);
}

export function sessionBelongsToNamespace(sessionId: string, namespace: string): boolean {
  const row = db.query("SELECT 1 FROM sessions WHERE id = ? AND namespace = ?").get(
    sessionId,
    normalizeNamespace(namespace),
  );
  return !!row;
}

// 杩佺Щ锛氫负宸叉湁 devices 琛ㄦ坊鍔?fcm_token 鍒?
try { db.run("ALTER TABLE devices ADD COLUMN fcm_token TEXT"); } catch {}

// --- 璁惧鎿嶄綔 ---

export function addDevice(id: string, publicKey: string, role: string, sessionId: string, sessionToken: string) {
  db.run(
    "INSERT INTO devices (id, public_key, role, session_id, session_token) VALUES (?, ?, ?, ?, ?)",
    [id, publicKey, role, sessionId, sessionToken],
  );
  upsertSessionMembership(id, sessionId, role);
}

export function getDeviceByToken(token: string) {
  return db.query("SELECT * FROM devices WHERE session_token = ?").get(token) as any;
}

export function getDevicesBySession(sessionId: string) {
  return db.query("SELECT id, role FROM devices WHERE session_id = ?").all(sessionId) as {
    id: string;
    role: string;
  }[];
}

export function getDevicesBySessionWithTokens(sessionId: string) {
  return db.query(
    "SELECT id, role, session_token FROM devices WHERE session_id = ?",
  ).all(sessionId) as { id: string; role: string; session_token: string }[];
}

export function updateDeviceSession(deviceId: string, sessionId: string, sessionToken: string) {
  db.run(
    "UPDATE devices SET session_id = ?, session_token = ? WHERE id = ?",
    [sessionId, sessionToken, deviceId],
  );
}

// --- 浼氳瘽鎴愬憳鍏崇郴 ---

export function upsertSessionMembership(deviceId: string, sessionId: string, role: string) {
  db.run(
    `INSERT INTO session_memberships (device_id, session_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(device_id, session_id) DO UPDATE SET
       role = excluded.role,
       last_seen = datetime('now')`,
    [deviceId, sessionId, role],
  );
}

export function touchSessionMembership(deviceId: string, sessionId: string) {
  db.run(
    "UPDATE session_memberships SET last_seen = datetime('now') WHERE device_id = ? AND session_id = ?",
    [deviceId, sessionId],
  );
}

export function getSessionMemberships(deviceId: string) {
  return db.query(
    `SELECT sm.session_id, sm.role,
            CAST(strftime('%s', sm.first_seen) AS INTEGER) * 1000 AS first_seen_ts,
            CAST(strftime('%s', sm.last_seen) AS INTEGER) * 1000 AS last_seen_ts
     FROM session_memberships sm
     WHERE sm.device_id = ?
     ORDER BY sm.last_seen DESC`,
  ).all(deviceId) as {
    session_id: string;
    role: string;
    first_seen_ts: number;
    last_seen_ts: number;
  }[];
}

export function getSessionMembershipsByNamespace(deviceId: string, namespace: string) {
  return db.query(
    `SELECT sm.session_id, sm.role,
            CAST(strftime('%s', sm.first_seen) AS INTEGER) * 1000 AS first_seen_ts,
            CAST(strftime('%s', sm.last_seen) AS INTEGER) * 1000 AS last_seen_ts
     FROM session_memberships sm
     JOIN sessions s ON s.id = sm.session_id
     WHERE sm.device_id = ? AND s.namespace = ?
     ORDER BY sm.last_seen DESC`,
  ).all(deviceId, normalizeNamespace(namespace)) as {
    session_id: string;
    role: string;
    first_seen_ts: number;
    last_seen_ts: number;
  }[];
}

/** 鏇存柊璁惧鐨?session_token锛堢敤浜?token 鍒锋柊锛?*/
export function updateDeviceToken(deviceId: string, newToken: string) {
  db.run("UPDATE devices SET session_token = ? WHERE id = ?", [newToken, deviceId]);
}

// --- FCM Token ---

export function updateFcmToken(deviceId: string, fcmToken: string) {
  db.run("UPDATE devices SET fcm_token = ? WHERE id = ?", [fcmToken, deviceId]);
}

export function getFcmTokensBySession(sessionId: string, role: string): string[] {
  const rows = db.query(
    "SELECT fcm_token FROM devices WHERE session_id = ? AND role = ? AND fcm_token IS NOT NULL",
  ).all(sessionId, role) as { fcm_token: string }[];
  return rows.map((r) => r.fcm_token);
}

export function clearFcmTokenByValue(fcmToken: string): number {
  const result = db.run(
    "UPDATE devices SET fcm_token = NULL WHERE fcm_token = ?",
    [fcmToken],
  );
  return result.changes;
}

// --- 閰嶅鎿嶄綔 ---

export function createPairingRequest(code: string, sessionId: string, agentPublicKey: string, agentDeviceId: string, sessionToken: string, expiresAt: string) {
  db.run(
    "INSERT INTO pairing_requests (code, session_id, agent_public_key, agent_device_id, session_token, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [code, sessionId, agentPublicKey, agentDeviceId, sessionToken, expiresAt],
  );
}

export function getPairingRequest(code: string) {
  return db.query("SELECT * FROM pairing_requests WHERE code = ?").get(code) as any;
}

export function joinPairingRequest(code: string, appPublicKey: string, appDeviceId: string, appSessionToken: string) {
  db.run(
    "UPDATE pairing_requests SET joined = 1, app_public_key = ?, app_device_id = ?, app_session_token = ? WHERE code = ?",
    [appPublicKey, appDeviceId, appSessionToken, code],
  );
}

// --- Token 鍚婇攢 ---

function hashToken(token: string): string {
  return Bun.hash(token).toString(16);
}

export function revokeToken(token: string) {
  db.run("INSERT OR IGNORE INTO revoked_tokens (token_hash) VALUES (?)", [hashToken(token)]);
}

export function isTokenRevoked(token: string): boolean {
  return !!db.query("SELECT 1 FROM revoked_tokens WHERE token_hash = ?").get(hashToken(token));
}

// --- 瀵嗘枃娑堟伅鎸佷箙鍖?---

export interface EncryptedMessageRow {
  id: string;
  session_id: string;
  source: string;
  target: string;
  type: string;
  seq: number;
  ts: number;
  payload: string;
}

const INSERT_ENCRYPTED_MESSAGE_SQL =
  `INSERT OR IGNORE INTO encrypted_messages (id, session_id, source, target, type, seq, ts, payload)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const saveEncryptedMessagesBatchTx = db.transaction((rows: EncryptedMessageRow[]) => {
  for (const row of rows) {
    db.run(
      INSERT_ENCRYPTED_MESSAGE_SQL,
      [row.id, row.session_id, row.source, row.target, row.type, row.seq, row.ts, row.payload],
    );
  }
});

export function saveEncryptedMessage(envelope: EncryptedMessageRow) {
  db.run(
    INSERT_ENCRYPTED_MESSAGE_SQL,
    [envelope.id, envelope.session_id, envelope.source, envelope.target,
      envelope.type, envelope.seq, envelope.ts, envelope.payload],
  );
}

export function saveEncryptedMessagesBatch(rows: EncryptedMessageRow[]) {
  if (rows.length === 0) return;
  saveEncryptedMessagesBatchTx(rows);
}

export function getEncryptedMessages(
  sessionId: string,
  afterTs: number = 0,
  limit: number = 100,
  afterCursor: number = 0,
) {
  if (afterCursor > 0) {
    return db.query(
      "SELECT rowid AS cursor, * FROM encrypted_messages WHERE session_id = ? AND rowid > ? ORDER BY rowid ASC LIMIT ?",
    ).all(sessionId, afterCursor, limit) as any[];
  }
  return db.query(
    "SELECT rowid AS cursor, * FROM encrypted_messages WHERE session_id = ? AND ts > ? ORDER BY rowid ASC LIMIT ?",
  ).all(sessionId, afterTs, limit) as any[];
}

// --- ACK 浜や粯闃熷垪 ---

export function queueDelivery(
  messageId: string,
  sessionId: string,
  sourceDeviceId: string,
  targetDeviceId: string,
) {
  db.run(
    `INSERT OR IGNORE INTO message_deliveries
     (message_id, session_id, source_device_id, target_device_id)
     VALUES (?, ?, ?, ?)`,
    [messageId, sessionId, sourceDeviceId, targetDeviceId],
  );
}

export interface DeliveryRow {
  messageId: string;
  sessionId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
}

const queueDeliveriesBatchTx = db.transaction((rows: DeliveryRow[]) => {
  for (const row of rows) {
    db.run(
      `INSERT OR IGNORE INTO message_deliveries
       (message_id, session_id, source_device_id, target_device_id)
       VALUES (?, ?, ?, ?)`,
      [row.messageId, row.sessionId, row.sourceDeviceId, row.targetDeviceId],
    );
  }
});

export function queueDeliveriesBatch(rows: DeliveryRow[]) {
  if (rows.length === 0) return;
  queueDeliveriesBatchTx(rows);
}

export function markDeliveryAcked(messageId: string, targetDeviceId: string): boolean {
  const result = db.run(
    `UPDATE message_deliveries
     SET acked_at = datetime('now')
     WHERE message_id = ? AND target_device_id = ? AND acked_at IS NULL`,
    [messageId, targetDeviceId],
  );
  return result.changes > 0;
}

export function getPendingDeliveries(targetDeviceId: string, limit: number = 100) {
  return db.query(
    `SELECT em.id, em.session_id, em.source, em.target, em.type, em.seq, em.ts, em.payload
     FROM message_deliveries md
     JOIN encrypted_messages em ON md.message_id = em.id
     WHERE md.target_device_id = ? AND md.acked_at IS NULL
     ORDER BY md.id ASC
     LIMIT ?`,
  ).all(targetDeviceId, limit) as any[];
}

// --- 杩炴帴鍏冩暟鎹棩蹇?---

export function logConnection(deviceId: string, sessionId: string, role: string, ip: string | null, event: "connect" | "disconnect") {
  db.run(
    "INSERT INTO connection_logs (device_id, session_id, role, ip, event) VALUES (?, ?, ?, ?, ?)",
    [deviceId, sessionId, role, ip, event],
  );
}

export function getConnectionLogs(sessionId: string, limit: number = 50) {
  return db.query(
    "SELECT * FROM connection_logs WHERE session_id = ? ORDER BY id DESC LIMIT ?",
  ).all(sessionId, limit) as any[];
}

// --- 涔愯骞跺彂鎺у埗 ---

export function getSessionVersion(sessionId: string, namespace?: string): number | null {
  const row = namespace
    ? db.query("SELECT version FROM sessions WHERE id = ? AND namespace = ?").get(sessionId, normalizeNamespace(namespace))
    : db.query("SELECT version FROM sessions WHERE id = ?").get(sessionId);
  return (row as { version?: number } | null)?.version ?? null;
}

export function sessionExists(sessionId: string, namespace?: string): boolean {
  if (namespace) {
    return !!db.query("SELECT 1 FROM sessions WHERE id = ? AND namespace = ?").get(sessionId, normalizeNamespace(namespace));
  }
  return !!db.query("SELECT 1 FROM sessions WHERE id = ?").get(sessionId);
}

/** 涔愯鏇存柊锛氫粎褰?expectedVersion 鍖归厤鏃堕€掑鐗堟湰鍙凤紝杩斿洖鏄惁鎴愬姛 */
export function incrementSessionVersion(sessionId: string, expectedVersion: number, namespace?: string): boolean {
  const result = namespace
    ? db.run(
      "UPDATE sessions SET version = version + 1 WHERE id = ? AND namespace = ? AND version = ?",
      [sessionId, normalizeNamespace(namespace), expectedVersion],
    )
    : db.run(
      "UPDATE sessions SET version = version + 1 WHERE id = ? AND version = ?",
      [sessionId, expectedVersion],
    );
  return result.changes > 0;
}

