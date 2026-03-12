import { serve } from "bun";
import { Database } from "bun:sqlite";
import { writeState, removeState } from "./daemon";
import { loadKeys, saveKeys, type StoredKeys } from "./keystore";
import {
  createEnvelopeWeb,
  openEnvelopeWeb,
  deriveAesGcmKey,
  DEFAULT_E2EE_INFO,
  MessageType,
  SeqCounter,
  ACK_REQUIRED_TYPES,
  safeParsePayload,
  SessionSpawnPayloadSchema,
  SessionStopPayloadSchema,
} from "@yuanio/shared";
import type {
  Envelope,
  SessionSwitchPayload,
  SessionSwitchAckPayload,
  ScheduleCreatePayload,
  ScheduleItemPayload,
  ScheduleDeletePayload,
  ScheduleStatusPayload,
  SessionSpawnPayload,
  SessionStopPayload,
  SessionStatusPayload,
} from "@yuanio/shared";
import { RelayClient } from "./relay-client";
import { startWarmLoop } from "./prewarm";
import type { AgentType } from "./spawn";
import { startLocalServer, type LocalServer } from "./local-server";
import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "./session-manager";
import { eventBus } from "./event-bus";
import { MessageStore } from "./message-store";
import { SSEManager } from "./sse-server";
import { PushService } from "./push-service";
import { NotificationHub } from "./notification-hub";
import { buildSkillPromptByName, discoverSkills } from "./remote/skill-engine";
import {
  normalizeSkillInstallError,
  skillInstallCancel,
  skillInstallCommit,
  skillInstallPrepare,
  skillInstallStatus,
  skillInstallSweepExpiredSessions,
} from "./remote/skill-install-engine";

// --- Token 自动刷新 ---

/** 解析 JWT payload 中的 exp（秒级时间戳） */
function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** 检查 token 是否需要刷新（剩余 < 2h），如需要则调用刷新 API */
async function refreshTokenIfNeeded(): Promise<void> {
  const currentKeys = loadKeys();
  if (!currentKeys?.sessionToken) return;

  const exp = parseJwtExp(currentKeys.sessionToken);
  if (!exp) return;

  const remainingSec = exp - Math.floor(Date.now() / 1000);
  if (remainingSec > 2 * 3600) return; // 剩余 > 2h，无需刷新

  console.log(`[daemon] token 剩余 ${Math.floor(remainingSec / 60)} 分钟，开始刷新...`);

  try {
    const res = await fetch(`${serverUrl}/api/v1/token/refresh`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${currentKeys.sessionToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.error(`[daemon] token 刷新失败: HTTP ${res.status}`);
      return;
    }

    const data = await res.json() as { sessionToken: string };
    const newToken = data.sessionToken;

    // 更新 keystore
    saveKeys({ ...currentKeys, sessionToken: newToken });
    console.log("[daemon] token 已刷新，重连 relay...");

    // 热切换 relay 连接，优先不中断现有链路
    void reconnectRelay(newToken);
  } catch (err: any) {
    console.error("[daemon] token 刷新异常:", err.message);
  }
}

// --- SQLite 持久化缓存 (Feature 11) ---
const YUANIO_DIR = `${process.env.HOME || process.env.USERPROFILE}/.yuanio`;
mkdirSync(YUANIO_DIR, { recursive: true });
const LOCK_FILE = join(YUANIO_DIR, "daemon.lock");
const CLI_VERSION = process.env.YUANIO_CLI_VERSION || resolveCliVersion();

function resolveCliVersion(): string {
  try {
    const pkgPath = join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireDaemonLock(): number {
  try {
    const fd = openSync(LOCK_FILE, "wx");
    writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      startedAt: Date.now(),
      version: CLI_VERSION,
    }, null, 2));
    return fd;
  } catch (e: any) {
    if (e?.code !== "EEXIST") {
      throw e;
    }

    try {
      const existing = JSON.parse(readFileSync(LOCK_FILE, "utf-8")) as { pid?: number; version?: string };
      if (existing?.pid && isPidAlive(existing.pid)) {
        throw new Error(`daemon lock already held by pid=${existing.pid} version=${existing.version || "unknown"}`);
      }
    } catch {
      // 锁文件损坏或不可读，视为 stale
    }

    try { unlinkSync(LOCK_FILE); } catch {}
    const fd = openSync(LOCK_FILE, "wx");
    writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      startedAt: Date.now(),
      version: CLI_VERSION,
    }, null, 2));
    return fd;
  }
}

const db = new Database(`${YUANIO_DIR}/cache.db`);
db.exec(`
  CREATE TABLE IF NOT EXISTS message_cache (
    id TEXT PRIMARY KEY,
    envelope TEXT NOT NULL,
    type TEXT,
    received_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_expires ON message_cache(expires_at)`);

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const NON_PERSISTENT_MESSAGE_TYPES = new Set<string>([
  MessageType.HEARTBEAT,
]);

// Phase 6: 结构化消息存储
const messageStore = new MessageStore(db);

// Phase 12: SSE 事件流
const sseManager = new SSEManager();
sseManager.bindEventBus();

// Phase 13: Web Push
const pushService = new PushService(() => sseManager.activeCount);
const notificationHub = new NotificationHub(pushService);
notificationHub.start();

// Phase 14: 通知收件箱 + 时间线 + Artifact 版本
db.exec(`
  CREATE TABLE IF NOT EXISTS inbox_notifications (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data TEXT,
    created_at INTEGER NOT NULL,
    read_at INTEGER
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_notifications_created ON inbox_notifications(created_at DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_notifications_read ON inbox_notifications(read_at)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS timeline_events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_timeline_events_created ON timeline_events(created_at DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_timeline_events_session_created ON timeline_events(session_id, created_at DESC)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS artifact_versions (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    meta TEXT,
    created_at INTEGER NOT NULL
  )
`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_versions_unique ON artifact_versions(artifact_id, version)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_artifact_versions_created ON artifact_versions(artifact_id, created_at DESC)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS skill_audit_logs (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    level TEXT NOT NULL,
    action TEXT NOT NULL,
    message TEXT NOT NULL,
    install_id TEXT,
    run_id TEXT,
    detail TEXT
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_audit_logs_at ON skill_audit_logs(at DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_audit_logs_install_id ON skill_audit_logs(install_id, at DESC)`);

interface InboxNotification {
  id: string;
  sessionId?: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  createdAt: number;
  readAt?: number;
}

interface TimelineEvent {
  id: string;
  sessionId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

interface ArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  content: string;
  meta?: Record<string, unknown>;
  createdAt: number;
}

interface SkillAuditLogItem {
  id: string;
  at: number;
  level: "info" | "warn" | "error";
  action: string;
  message: string;
  installId?: string;
  runId?: string;
  detail?: Record<string, unknown>;
}

const SKILL_AUDIT_MAX = 300;

function appendSkillAudit(
  action: string,
  message: string,
  level: "info" | "warn" | "error" = "info",
  detail?: Record<string, unknown>,
): void {
  const item: SkillAuditLogItem = {
    id: `skill_log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    level,
    action,
    message,
    installId: typeof detail?.installId === "string" ? detail.installId : undefined,
    runId: typeof detail?.runId === "string" ? detail.runId : undefined,
    detail,
  };
  db.run(
    `INSERT OR REPLACE INTO skill_audit_logs (id, at, level, action, message, install_id, run_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.at,
      item.level,
      item.action,
      item.message,
      item.installId ?? null,
      item.runId ?? null,
      item.detail ? JSON.stringify(item.detail) : null,
    ],
  );
}

function listSkillAuditLogs(limit: number, filter?: { installId?: string; runId?: string }): SkillAuditLogItem[] {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (filter?.installId) {
    where.push("install_id = ?");
    args.push(filter.installId);
  }
  if (filter?.runId) {
    where.push("run_id = ?");
    args.push(filter.runId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.query(
    `SELECT id, at, level, action, message, install_id, run_id, detail
     FROM skill_audit_logs
     ${whereSql}
     ORDER BY at DESC
     LIMIT ?`,
  ).all(...args, limit) as Array<{
    id: string;
    at: number;
    level: "info" | "warn" | "error";
    action: string;
    message: string;
    install_id: string | null;
    run_id: string | null;
    detail: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    level: row.level,
    action: row.action,
    message: row.message,
    installId: row.install_id || undefined,
    runId: row.run_id || undefined,
    detail: parseJsonObject(row.detail),
  }));
}

function trimSkillAuditLogs(limit: number): void {
  const keep = Math.max(1, Math.floor(limit));
  db.run(
    `DELETE FROM skill_audit_logs
     WHERE id IN (
       SELECT id FROM skill_audit_logs
       ORDER BY at DESC
       LIMIT -1 OFFSET ?
     )`,
    [keep],
  );
}

function appendSkillAuditWithTrim(
  action: string,
  message: string,
  level: "info" | "warn" | "error" = "info",
  detail?: Record<string, unknown>,
): void {
  appendSkillAudit(action, message, level, detail);
  try {
    trimSkillAuditLogs(SKILL_AUDIT_MAX);
  } catch {
    // ignore trim failure
  }
}

function skillApiError(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status });
}

function toSkillInstallErrorResponse(error: unknown): { status: number; code: string; message: string } {
  const normalized = normalizeSkillInstallError(error);
  return {
    status: normalized.status,
    code: normalized.code,
    message: normalized.message,
  };
}

function clampLimit(raw: string | null, fallback: number, max = 200): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(1, Math.floor(n)), max);
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
}

function appendInboxNotification(input: {
  sessionId?: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}): InboxNotification {
  const item: InboxNotification = {
    id: randomUUID(),
    sessionId: input.sessionId || undefined,
    type: input.type,
    title: input.title,
    body: input.body || "",
    data: input.data,
    createdAt: Date.now(),
  };
  db.run(
    `INSERT INTO inbox_notifications (id, session_id, type, title, body, data, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      item.id,
      item.sessionId ?? null,
      item.type,
      item.title,
      item.body,
      item.data ? JSON.stringify(item.data) : null,
      item.createdAt,
    ],
  );
  return item;
}

function listInboxNotifications(limit = 50, unreadOnly = false): InboxNotification[] {
  const sql = unreadOnly
    ? `SELECT id, session_id, type, title, body, data, created_at, read_at FROM inbox_notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT ?`
    : `SELECT id, session_id, type, title, body, data, created_at, read_at FROM inbox_notifications ORDER BY created_at DESC LIMIT ?`;
  const rows = db.query(sql).all(limit) as Array<{
    id: string;
    session_id: string | null;
    type: string;
    title: string;
    body: string | null;
    data: string | null;
    created_at: number;
    read_at: number | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id || undefined,
    type: row.type,
    title: row.title,
    body: row.body || "",
    data: parseJsonObject(row.data),
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  }));
}

function markInboxNotificationsRead(ids?: string[], beforeTs?: number): number {
  const readAt = Date.now();
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    db.run(
      `UPDATE inbox_notifications SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`,
      [readAt, ...ids],
    );
    const row = db.query(`SELECT changes() as c`).get() as { c: number } | null;
    return row?.c ?? 0;
  }

  if (beforeTs && Number.isFinite(beforeTs) && beforeTs > 0) {
    db.run(
      `UPDATE inbox_notifications SET read_at = ? WHERE created_at <= ? AND read_at IS NULL`,
      [readAt, Math.floor(beforeTs)],
    );
    const row = db.query(`SELECT changes() as c`).get() as { c: number } | null;
    return row?.c ?? 0;
  }

  db.run(`UPDATE inbox_notifications SET read_at = ? WHERE read_at IS NULL`, [readAt]);
  const row = db.query(`SELECT changes() as c`).get() as { c: number } | null;
  return row?.c ?? 0;
}

function appendTimelineEvent(
  eventType: string,
  payload: Record<string, unknown>,
  sessionId?: string,
): TimelineEvent {
  const event: TimelineEvent = {
    id: randomUUID(),
    sessionId: sessionId || undefined,
    eventType,
    payload,
    createdAt: Date.now(),
  };
  db.run(
    `INSERT INTO timeline_events (id, session_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    [event.id, event.sessionId ?? null, event.eventType, JSON.stringify(event.payload), event.createdAt],
  );
  return event;
}

function listTimelineEvents(options: {
  sessionId?: string;
  limit?: number;
  beforeTs?: number;
}): { events: TimelineEvent[]; nextCursor: number | null; hasMore: boolean } {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const beforeTs = options.beforeTs && Number.isFinite(options.beforeTs) ? Math.floor(options.beforeTs) : undefined;
  const params: Array<string | number> = [];
  const where: string[] = [];
  if (options.sessionId) {
    where.push(`session_id = ?`);
    params.push(options.sessionId);
  }
  if (beforeTs && beforeTs > 0) {
    where.push(`created_at < ?`);
    params.push(beforeTs);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.query(
    `SELECT id, session_id, event_type, payload, created_at FROM timeline_events ${whereSql} ORDER BY created_at DESC LIMIT ?`,
  ).all(...params, limit + 1) as Array<{
    id: string;
    session_id: string | null;
    event_type: string;
    payload: string;
    created_at: number;
  }>;
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const events = sliced.map((row) => ({
    id: row.id,
    sessionId: row.session_id || undefined,
    eventType: row.event_type,
    payload: parseJsonObject(row.payload),
    createdAt: row.created_at,
  }));
  const nextCursor = events.length > 0 ? events[events.length - 1].createdAt : null;
  return { events, nextCursor, hasMore };
}

function createArtifactVersion(
  artifactId: string,
  content: string,
  meta?: Record<string, unknown>,
): ArtifactVersion {
  const max = db.query(`SELECT MAX(version) as maxVersion FROM artifact_versions WHERE artifact_id = ?`).get(artifactId) as {
    maxVersion: number | null;
  } | null;
  const version = (max?.maxVersion ?? 0) + 1;
  const item: ArtifactVersion = {
    id: randomUUID(),
    artifactId,
    version,
    content,
    meta,
    createdAt: Date.now(),
  };
  db.run(
    `INSERT INTO artifact_versions (id, artifact_id, version, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [item.id, item.artifactId, item.version, item.content, item.meta ? JSON.stringify(item.meta) : null, item.createdAt],
  );
  return item;
}

function listArtifactVersions(
  artifactId: string,
  limit = 20,
  beforeVersion?: number,
): { versions: ArtifactVersion[]; hasMore: boolean; nextBeforeVersion: number | null } {
  const capped = Math.min(Math.max(limit, 1), 100);
  const rows = beforeVersion && Number.isFinite(beforeVersion)
    ? db.query(
      `SELECT id, artifact_id, version, content, meta, created_at
       FROM artifact_versions
       WHERE artifact_id = ? AND version < ?
       ORDER BY version DESC
       LIMIT ?`,
    ).all(artifactId, Math.floor(beforeVersion), capped + 1)
    : db.query(
      `SELECT id, artifact_id, version, content, meta, created_at
       FROM artifact_versions
       WHERE artifact_id = ?
       ORDER BY version DESC
       LIMIT ?`,
    ).all(artifactId, capped + 1);
  const typedRows = rows as Array<{
    id: string;
    artifact_id: string;
    version: number;
    content: string;
    meta: string | null;
    created_at: number;
  }>;
  const hasMore = typedRows.length > capped;
  const sliced = hasMore ? typedRows.slice(0, capped) : typedRows;
  const versions = sliced.map((row) => ({
    id: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    content: row.content,
    meta: parseJsonObject(row.meta),
    createdAt: row.created_at,
  }));
  const nextBeforeVersion = versions.length > 0 ? versions[versions.length - 1].version : null;
  return { versions, hasMore, nextBeforeVersion };
}

function getLatestArtifactVersion(artifactId: string): ArtifactVersion | null {
  const row = db.query(
    `SELECT id, artifact_id, version, content, meta, created_at
     FROM artifact_versions
     WHERE artifact_id = ?
     ORDER BY version DESC
     LIMIT 1`,
  ).get(artifactId) as {
    id: string;
    artifact_id: string;
    version: number;
    content: string;
    meta: string | null;
    created_at: number;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    content: row.content,
    meta: parseJsonObject(row.meta),
    createdAt: row.created_at,
  };
}

function cacheMessage(envelope: Envelope): void {
  const now = Date.now();
  db.run(
    `INSERT OR REPLACE INTO message_cache (id, envelope, type, received_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [envelope.id, JSON.stringify(envelope), envelope.type, now, now + CACHE_TTL],
  );
}

function shouldPersistEnvelope(envelope: Envelope): boolean {
  return !NON_PERSISTENT_MESSAGE_TYPES.has(envelope.type);
}

function getCachedMessages(): { envelope: Envelope; receivedAt: number }[] {
  // 先清理过期消息
  db.run(`DELETE FROM message_cache WHERE expires_at < ?`, [Date.now()]);
  const rows = db.query(`SELECT envelope, received_at FROM message_cache ORDER BY received_at ASC`).all() as any[];
  return rows.map((r) => ({
    envelope: JSON.parse(r.envelope),
    receivedAt: r.received_at,
  }));
}

function clearCache(): number {
  const count = db.query(`SELECT COUNT(*) as c FROM message_cache`).get() as any;
  db.run(`DELETE FROM message_cache`);
  return count?.c ?? 0;
}

function getCacheCount(): number {
  const row = db.query(`SELECT COUNT(*) as c FROM message_cache`).get() as any;
  return row?.c ?? 0;
}

let daemonLockFd: number;
try {
  daemonLockFd = acquireDaemonLock();
  console.log(`[daemon] 已获取进程锁 (${LOCK_FILE})`);
} catch (e: any) {
  console.error(`[daemon] 启动失败: ${e?.message || e}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const serverUrl = args.includes("--server")
  ? args[args.indexOf("--server") + 1]
  : "http://localhost:3000";
const warmFlag = args.includes("--warm") || process.env.YUANIO_DAEMON_WARM === "1";
const warmAgentArg = args.includes("--warm-agent")
  ? args[args.indexOf("--warm-agent") + 1]
  : process.env.YUANIO_DAEMON_WARM_AGENT;
const warmIntervalMinRaw = args.includes("--warm-interval")
  ? Number(args[args.indexOf("--warm-interval") + 1])
  : Number(process.env.YUANIO_DAEMON_WARM_INTERVAL_MIN || 15);
const warmIntervalMin = Number.isFinite(warmIntervalMinRaw) ? warmIntervalMinRaw : 15;
const defaultAgent = ((): AgentType => {
  const raw = process.env.YUANIO_DEFAULT_AGENT;
  if (raw === "claude" || raw === "codex" || raw === "gemini") return raw;
  return "codex";
})();

const warmAgent = (warmAgentArg || (warmFlag ? defaultAgent : "")) as AgentType;
const warmEnabled = ["claude", "codex", "gemini"].includes(warmAgent);

// --- Relay 长连接 ---
let relayClient: RelayClient | null = null;
let relayConnected = false;
const seq = new SeqCounter();
let pendingSwitchAck: { sessionId: string } | null = null;
let localServer: LocalServer | null = null;
let localServerSessionId: string | null = null;
let relaySwitchPromise: Promise<boolean> | null = null;
const daemonLocalPortRaw = Number(process.env.YUANIO_DAEMON_LOCAL_PORT || "19394");
const DAEMON_LOCAL_PORT = Number.isFinite(daemonLocalPortRaw) && daemonLocalPortRaw > 0
  ? Math.floor(daemonLocalPortRaw)
  : 19394;

/** 设置 relay 事件监听 */
function setupRelayListeners(relay: RelayClient) {
  relay.onConnectionChange((connected) => {
    if (relay !== relayClient) return;
    relayConnected = connected;
    if (connected) {
      console.log("[daemon] relay 已连接");
      if (pendingSwitchAck) {
        void sendSessionSwitchAck(pendingSwitchAck.sessionId);
        pendingSwitchAck = null;
      }
      return;
    }
    console.log("[daemon] relay 已断开");
  });

  relay.onError((message) => {
    if (relay !== relayClient) return;
    console.error("[daemon] relay 连接错误:", message);
  });

  relay.onMessage((rawEnvelope) => {
    if (relay !== relayClient) return;
    if (typeof (rawEnvelope as any)?.payload !== "string") return;
    const envelope = rawEnvelope as Envelope;
    // daemon 作为接收端也要回 ACK，避免手机端 reliable send 重试超时
    if (ACK_REQUIRED_TYPES.includes(envelope.type) && envelope.id) {
      const currentKeys = loadKeys();
      if (currentKeys?.deviceId) {
        relay.sendAck(
          envelope.id,
          currentKeys.deviceId,
          envelope.sessionId,
          "working",
        );
      }
    }

    if (envelope.type === MessageType.SESSION_SWITCH) {
      void handleSessionSwitch(envelope).then((handled) => {
        if (!handled) {
          if (shouldPersistEnvelope(envelope)) {
            cacheMessage(envelope);
            console.log(`[daemon] 缓存消息 type=${envelope.type} (共${getCacheCount()}条)`);
          }
        }
      });
      return;
    }
    if (
      envelope.type === MessageType.SESSION_SPAWN ||
      envelope.type === MessageType.SESSION_STOP ||
      envelope.type === MessageType.SESSION_LIST
    ) {
      void handleSessionLifecycleMessage(envelope).catch((err) => {
        console.warn("[daemon] 会话生命周期处理失败:", err instanceof Error ? err.message : err);
      });
      return;
    }
    if (shouldPersistEnvelope(envelope)) {
      cacheMessage(envelope);
    }
    // 同步广播到本地直连客户端
    localServer?.broadcast(envelope);
    eventBus.emit({ type: "message-received", sessionId: envelope.sessionId, message: envelope });
    appendTimelineEvent(
      "relay_message",
      {
        type: envelope.type,
        source: envelope.source,
        target: envelope.target,
        id: envelope.id,
        seq: envelope.seq,
      },
      envelope.sessionId,
    );
    if (shouldPersistEnvelope(envelope)) {
      console.log(`[daemon] 缓存消息 type=${envelope.type} (共${getCacheCount()}条)`);
    }
  });
}

function createRelayClient(token: string): RelayClient {
  const relay = new RelayClient(serverUrl, token);
  setupRelayListeners(relay);
  return relay;
}

async function waitForRelayConnected(relay: RelayClient, timeoutMs: number): Promise<boolean> {
  if (relay.connected) return true;
  const deadline = Date.now() + Math.max(500, timeoutMs);
  while (Date.now() < deadline) {
    if (relay.connected) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function reconnectRelay(newToken: string): Promise<boolean> {
  if (!relayClient) {
    relayClient = createRelayClient(newToken);
    relayConnected = false;
    return true;
  }

  if (relaySwitchPromise) return await relaySwitchPromise;

  const currentRelay = relayClient;
  const switchTask = (async () => {
    const candidate = createRelayClient(newToken);
    const connected = await waitForRelayConnected(candidate, 10000);
    if (!connected) {
      candidate.disconnect();
      console.warn("[daemon] relay 热切换失败，保留旧连接");
      return false;
    }

    relayClient = candidate;
    relayConnected = candidate.connected;
    currentRelay.disconnect();
    console.log("[daemon] relay 已热切换到新连接");
    if (pendingSwitchAck) {
      void sendSessionSwitchAck(pendingSwitchAck.sessionId);
      pendingSwitchAck = null;
    }
    return true;
  })().finally(() => {
    relaySwitchPromise = null;
  });

  relaySwitchPromise = switchTask;
  return await switchTask;
}

function ensureLocalServerWithKeys(keys: StoredKeys): void {
  if (!keys.secretKey || !keys.peerPublicKey || !keys.sessionId || !keys.deviceId) return;

  if (localServer && localServerSessionId === keys.sessionId) return;

  if (localServer) {
    try { localServer.stop(); } catch {}
    localServer = null;
    localServerSessionId = null;
  }

  try {
    localServer = startLocalServer({
      port: DAEMON_LOCAL_PORT,
      mode: "daemon",
      sessionId: keys.sessionId,
      sharedKey: null as unknown as CryptoKey, // daemon 模式不需要 sharedKey 用于消息加解密
      secretKey: keys.secretKey,
      peerPublicKey: keys.peerPublicKey,
      deviceId: keys.deviceId,
      onEnvelope: (env) => {
        // daemon 模式仅缓存（prompt 已在 local-server 内部被拒绝）
        const envelope = env as Envelope;
        if (shouldPersistEnvelope(envelope)) {
          cacheMessage(envelope);
          console.log(`[daemon] 本地消息缓存 type=${envelope.type} (共${getCacheCount()}条)`);
        }
      },
      onClientChange: (count) => {
        console.log(`[daemon] 直连客户端: ${count}`);
      },
    });
    localServerSessionId = keys.sessionId;
  } catch (e: any) {
    console.warn(`[daemon] 本地服务器启动失败: ${e?.message || e}`);
  }
}

const keys = loadKeys();
if (keys) {
  relayClient = createRelayClient(keys.sessionToken);
  ensureLocalServerWithKeys(keys);
} else {
  console.log("[daemon] 未找到密钥，跳过 relay 连接");
}

if (warmEnabled) {
  console.log(`[daemon] 预热 agent: ${warmAgent} (每 ${warmIntervalMin} 分钟)`);
  startWarmLoop({
    agent: warmAgent,
    intervalMs: Math.max(1, warmIntervalMin) * 60 * 1000,
    label: "daemon-warm",
  });
}

// --- Phase 4: SessionManager ---
const sessionManager = new SessionManager();
sessionManager.load();
console.log(`[daemon] 已加载 ${sessionManager.list().length} 个持久化会话`);

const unsubscribeEventPersistence = eventBus.subscribe((event) => {
  if (event.type !== "message-received") {
    const sessionId = "sessionId" in event && typeof event.sessionId === "string"
      ? event.sessionId
      : undefined;
    appendTimelineEvent(`event_${event.type}`, event as unknown as Record<string, unknown>, sessionId);
  }

  if (event.type === "approval-requested") {
    appendInboxNotification({
      sessionId: event.sessionId,
      type: "approval",
      title: "需要审批",
      body: `会话 ${event.sessionId} 请求审批`,
      data: { requestId: event.requestId },
    });
    return;
  }

  if (event.type === "task-completed") {
    appendInboxNotification({
      type: "task",
      title: "任务完成",
      body: `任务 ${event.taskId} 已完成`,
      data: { taskId: event.taskId },
    });
  }
});

// 定期清理已退出的会话（每 60 秒）
setInterval(() => {
  const pruned = sessionManager.pruneDeadSessions();
  if (pruned > 0) console.log(`[daemon] 清理 ${pruned} 个已退出会话`);
}, 60_000);

// --- HTTP 健康检查 ---
const server = serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        pid: process.pid,
        uptime: process.uptime(),
        relay: relayConnected ? "connected" : "disconnected",
        cachedMessages: getCacheCount(),
        sseConnections: sseManager.activeCount,
      });
    }
    // Phase 12: SSE 事件流
    if (url.pathname === "/events" && req.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || undefined;
      const connId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return sseManager.createResponse(connId, sessionId);
    }
    if (url.pathname === "/messages") {
      return Response.json({ messages: getCachedMessages() });
    }
    if (url.pathname === "/messages/clear" && req.method === "POST") {
      const count = clearCache();
      return Response.json({ cleared: count });
    }
    if (url.pathname === "/control/rebind" && req.method === "POST") {
      let trigger = "launcher";
      try {
        const body = await req.json() as { trigger?: string };
        if (typeof body?.trigger === "string" && body.trigger.trim()) {
          trigger = body.trigger.trim();
        }
      } catch {}
      const result = await rebindRuntimeFromKeystore(trigger);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }
    if (url.pathname === "/sessions") {
      return Response.json({ sessions });
    }
    // Feature 9: 定时任务 HTTP 端点
    if (url.pathname === "/schedules" && req.method === "GET") {
      return Response.json({ schedules: loadSchedules() });
    }
    if (url.pathname === "/schedules" && req.method === "POST") {
      const body = await req.json() as ScheduleCreatePayload;
      const item = addSchedule(body);
      return Response.json(item);
    }
    if (url.pathname === "/schedules" && req.method === "DELETE") {
      const body = await req.json() as ScheduleDeletePayload;
      const removed = removeSchedule(body.id);
      return Response.json({ removed });
    }
    // Phase 6: 消息分页端点
    if (url.pathname.startsWith("/messages/") && req.method === "GET") {
      const parts = url.pathname.split("/");
      // GET /messages/:sessionId
      if (parts.length === 3 && parts[2] !== "clear") {
        const sessionId = decodeURIComponent(parts[2]);
        const limit = Number(url.searchParams.get("limit") || "50");
        const beforeSeqRaw = url.searchParams.get("beforeSeq") || url.searchParams.get("before");
        const beforeSeq = beforeSeqRaw ? Number(beforeSeqRaw) : undefined;

        const rows = messageStore.getMessages(sessionId, limit, beforeSeq);
        const messages = rows.reverse(); // 返回正序
        const nextBeforeSeq = rows.length > 0 ? rows[0].seq : null;
        const hasMore = rows.length >= limit;

        return Response.json({
          messages: messages.map((m) => ({
            id: m.id, seq: m.seq, content: JSON.parse(m.content), role: m.role, createdAt: m.createdAt,
          })),
          page: { limit, beforeSeq: beforeSeq ?? null, nextBeforeSeq, hasMore },
        });
      }
      // GET /messages/:sessionId/after
      if (parts.length === 4 && parts[3] === "after") {
        const sessionId = decodeURIComponent(parts[2]);
        const afterSeq = Number(url.searchParams.get("afterSeq") || url.searchParams.get("after") || "0");
        const limit = Number(url.searchParams.get("limit") || "50");

        const rows = messageStore.getMessagesAfter(sessionId, afterSeq, limit);
        return Response.json({
          messages: rows.map((m) => ({
            id: m.id, seq: m.seq, content: JSON.parse(m.content), role: m.role, createdAt: m.createdAt,
          })),
          page: { limit, afterSeq, hasMore: rows.length >= limit },
        });
      }
    }
    // Phase 4: 会话管理端点
    if (url.pathname === "/sessions/list" && req.method === "GET") {
      return Response.json({ sessions: sessionManager.list() });
    }
    if (url.pathname === "/sessions/spawn" && req.method === "POST") {
      try {
        const body = await req.json() as {
          directory?: string;
          dir?: string;
          agent?: string;
          prompt?: string;
          resumeSessionId?: string;
        };
        const directory = body.directory || body.dir || process.cwd();
        const agent = (body.agent || defaultAgent) as import("./spawn").AgentType;
        const session = sessionManager.spawn(directory, agent, body.prompt, body.resumeSessionId);
        syncDaemonSessionsState();
        return Response.json({ sessionId: session.id, pid: session.pid, agent: session.agent });
      } catch (e: any) {
        return Response.json({ error: e?.message || String(e) }, { status: 400 });
      }
    }
    if (url.pathname === "/sessions/stop" && req.method === "POST") {
      const body = await req.json() as { sessionId?: string; id?: string };
      const sessionId = body.sessionId || body.id || "";
      if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
      const stopped = sessionManager.stop(sessionId);
      syncDaemonSessionsState();
      return Response.json({ stopped });
    }

    // Phase 14: 通知收件箱
    if (url.pathname === "/notifications" && req.method === "GET") {
      const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
      const unreadOnly = url.searchParams.get("unread") === "1";
      const notifications = listInboxNotifications(limit, unreadOnly);
      const unreadCount = notifications.filter((n) => !n.readAt).length;
      return Response.json({ notifications, unreadCount });
    }
    if (url.pathname === "/notifications/read" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { ids?: string[]; beforeTs?: number };
      const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id.trim()) : undefined;
      const beforeTs = typeof body.beforeTs === "number" ? body.beforeTs : undefined;
      const marked = markInboxNotificationsRead(ids, beforeTs);
      return Response.json({ marked });
    }

    // Phase 14: 时间线
    if (url.pathname === "/timeline" && req.method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || undefined;
      const limit = clampLimit(url.searchParams.get("limit"), 100, 200);
      const cursor = url.searchParams.get("cursor");
      const beforeTs = cursor ? Number(cursor) : undefined;
      const result = listTimelineEvents({ sessionId, limit, beforeTs });
      return Response.json({
        events: result.events,
        page: {
          limit,
          cursor: beforeTs ?? null,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      });
    }

    // Phase 14: Artifact 版本化
    if (url.pathname === "/artifacts/version" && req.method === "POST") {
      const body = await req.json().catch(() => null) as {
        artifactId?: string;
        content?: string;
        meta?: Record<string, unknown>;
      } | null;
      if (!body?.artifactId || typeof body.artifactId !== "string") {
        return Response.json({ error: "artifactId required" }, { status: 400 });
      }
      if (typeof body.content !== "string") {
        return Response.json({ error: "content must be string" }, { status: 400 });
      }
      const item = createArtifactVersion(body.artifactId.trim(), body.content, body.meta);
      appendTimelineEvent("artifact_version_created", {
        artifactId: item.artifactId,
        version: item.version,
      });
      return Response.json(item);
    }
    if (url.pathname.startsWith("/artifacts/") && req.method === "GET") {
      const parts = url.pathname.split("/").filter(Boolean);
      // /artifacts/:artifactId/latest
      if (parts.length === 3 && parts[2] === "latest") {
        const artifactId = decodeURIComponent(parts[1] || "");
        if (!artifactId) return Response.json({ error: "artifactId required" }, { status: 400 });
        const latest = getLatestArtifactVersion(artifactId);
        return Response.json({ latest });
      }
      // /artifacts/:artifactId/versions
      if (parts.length === 3 && parts[2] === "versions") {
        const artifactId = decodeURIComponent(parts[1] || "");
        if (!artifactId) return Response.json({ error: "artifactId required" }, { status: 400 });
        const limit = clampLimit(url.searchParams.get("limit"), 20, 100);
        const beforeRaw = url.searchParams.get("beforeVersion");
        const beforeVersion = beforeRaw ? Number(beforeRaw) : undefined;
        const result = listArtifactVersions(artifactId, limit, beforeVersion);
        return Response.json({
          versions: result.versions,
          page: {
            limit,
            beforeVersion: beforeVersion ?? null,
            nextBeforeVersion: result.nextBeforeVersion,
            hasMore: result.hasMore,
          },
        });
      }
    }

    // Skills 管理（Web/Android/TUI 共用）
    if (url.pathname === "/skills/list" && req.method === "GET") {
      const scope = (url.searchParams.get("scope") || "all").trim().toLowerCase();
      const cwd = process.cwd();
      const items = discoverSkills(cwd).filter((item) => {
        if (scope === "project") return item.scope === "project";
        if (scope === "user") return item.scope === "user";
        return true;
      }).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        path: item.path,
        scope: item.scope,
        source: item.source,
        userInvocable: item.userInvocable,
        context: item.context,
        disableModelInvocation: item.disableModelInvocation,
        argumentHint: item.argumentHint || null,
      }));
      return Response.json({ items });
    }

    if (url.pathname === "/skills/install/prepare" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as {
        source?: string;
        scope?: string;
      };
      const source = typeof body.source === "string" ? body.source.trim() : "";
      const scope = body.scope === "user" ? "user" : "project";
      if (!source) {
        return skillApiError(400, "SKILL_INSTALL_SOURCE_REQUIRED", "source is required");
      }
      try {
        const result = await skillInstallPrepare({ source, scope, cwd: process.cwd() });
        appendSkillAuditWithTrim("prepare", `prepare success installId=${result.installId}`, "info", {
          installId: result.installId,
          source,
          scope,
          candidateCount: result.candidates.length,
        });
        return Response.json(result);
      } catch (error: unknown) {
        const err = toSkillInstallErrorResponse(error);
        appendSkillAuditWithTrim("prepare", `prepare failed: ${err.message}`, "error", {
          source,
          scope,
          code: err.code,
        });
        return skillApiError(err.status, err.code, err.message);
      }
    }

    if (url.pathname === "/skills/install/commit" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as {
        installId?: string;
        selected?: string[] | string;
        force?: boolean;
        conflictPolicy?: string;
      };
      const installId = typeof body.installId === "string" ? body.installId.trim() : "";
      if (!installId) {
        return skillApiError(400, "SKILL_INSTALL_INSTALL_ID_REQUIRED", "installId is required");
      }
      try {
        const result = await skillInstallCommit({
          installId,
          selected: body.selected,
          force: body.force === true,
          conflictPolicy: body.conflictPolicy === "overwrite" || body.conflictPolicy === "rename" || body.conflictPolicy === "skip"
            ? body.conflictPolicy
            : undefined,
          cwd: process.cwd(),
        });
        appendSkillAuditWithTrim("commit", `commit success installId=${installId}`, "info", {
          installId,
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
          total: result.total,
        });
        return Response.json(result);
      } catch (error: unknown) {
        const err = toSkillInstallErrorResponse(error);
        appendSkillAuditWithTrim("commit", `commit failed: ${err.message}`, "error", {
          installId,
          code: err.code,
        });
        return skillApiError(err.status, err.code, err.message);
      }
    }

    if (url.pathname === "/skills/install/cancel" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { installId?: string };
      const installId = typeof body.installId === "string" ? body.installId.trim() : "";
      if (!installId) {
        return skillApiError(400, "SKILL_INSTALL_INSTALL_ID_REQUIRED", "installId is required");
      }
      const result = await skillInstallCancel(installId);
      appendSkillAuditWithTrim("cancel", `cancel installId=${installId} existed=${result.existed ? "true" : "false"}`);
      return Response.json(result);
    }

    if (url.pathname === "/skills/install/status" && req.method === "GET") {
      const installId = (url.searchParams.get("installId") || "").trim();
      if (!installId) {
        return skillApiError(400, "SKILL_INSTALL_INSTALL_ID_REQUIRED", "installId is required");
      }
      const result = await skillInstallStatus(installId);
      if (!result) return skillApiError(404, "SKILL_INSTALL_SESSION_NOT_FOUND", "install session not found");
      return Response.json(result);
    }
    if (url.pathname.startsWith("/skills/install/status/") && req.method === "GET") {
      const installId = decodeURIComponent(url.pathname.slice("/skills/install/status/".length));
      if (!installId) return skillApiError(400, "SKILL_INSTALL_INSTALL_ID_REQUIRED", "installId is required");
      const result = await skillInstallStatus(installId);
      if (!result) return skillApiError(404, "SKILL_INSTALL_SESSION_NOT_FOUND", "install session not found");
      return Response.json(result);
    }

    if (url.pathname === "/skills/dry-run" && req.method === "POST") {
      const body = await req.json().catch(() => ({})) as { name?: string; args?: string };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const args = typeof body.args === "string" ? body.args : "";
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (!name) {
        return skillApiError(400, "SKILL_RUN_NAME_REQUIRED", "name is required");
      }
      const preview = buildSkillPromptByName(name, args, process.cwd());
      if (!preview) {
        appendSkillAuditWithTrim("dry-run", `dry-run failed: skill not found (${name})`, "warn", { name, runId });
        return skillApiError(404, "SKILL_RUN_NOT_FOUND", `skill not found: ${name}`);
      }
      appendSkillAuditWithTrim("dry-run", `dry-run success: ${name}`, "info", { name, args, runId });
      return Response.json({
        runId,
        skill: {
          id: preview.skill.id,
          name: preview.skill.name,
          description: preview.skill.description,
          scope: preview.skill.scope,
          source: preview.skill.source,
          path: preview.skill.path,
        },
        prompt: preview.prompt,
      });
    }

    if (url.pathname === "/skills/logs" && req.method === "GET") {
      const limit = clampLimit(url.searchParams.get("limit"), 50, 300);
      const installId = (url.searchParams.get("installId") || "").trim() || undefined;
      const runId = (url.searchParams.get("runId") || "").trim() || undefined;
      return Response.json({ items: listSkillAuditLogs(limit, { installId, runId }) });
    }

    // Phase 13: Web Push 端点
    if (url.pathname === "/push/vapid-public-key" && req.method === "GET") {
      const key = pushService.getPublicKey();
      return key
        ? Response.json({ publicKey: key })
        : Response.json({ error: "VAPID keys not available" }, { status: 500 });
    }
    if (url.pathname === "/push/subscribe" && req.method === "POST") {
      const body = await req.json() as { endpoint: string; keys: { p256dh: string; auth: string } };
      pushService.subscribe(body.endpoint, body.keys);
      return Response.json({ subscribed: true });
    }
    if (url.pathname === "/push/subscribe" && req.method === "DELETE") {
      const body = await req.json() as { endpoint: string };
      const removed = pushService.unsubscribeEndpoint(body.endpoint);
      return Response.json({ removed });
    }
    return new Response("Not Found", { status: 404 });
  },
});

// --- 状态文件 ---
let sessions = keys ? [keys.sessionId] : [];
const daemonStartedAt = new Date().toISOString();

function writeDaemonState(): void {
  writeState({
    pid: process.pid,
    port: server.port ?? 0,
    version: CLI_VERSION,
    startedAt: daemonStartedAt,
    sessions,
  });
}

function syncDaemonSessionsState(): void {
  const latestKeys = loadKeys();
  const currentSession = latestKeys?.sessionId;
  const listed = sessionManager.list().map((s) => s.sessionId);
  sessions = Array.from(new Set([...(currentSession ? [currentSession] : []), ...listed]));
  writeDaemonState();
}

writeDaemonState();

interface RebindResult {
  ok: boolean;
  relay: "connected" | "disconnected";
  localServer: "running" | "stopped";
  sessionId?: string;
  reason?: string;
}

async function rebindRuntimeFromKeystore(trigger: string): Promise<RebindResult> {
  const latest = loadKeys();
  if (!latest?.sessionToken || !latest.sessionId) {
    return {
      ok: false,
      relay: relayConnected ? "connected" : "disconnected",
      localServer: localServer ? "running" : "stopped",
      reason: "keystore not ready",
    };
  }

  const switched = await reconnectRelay(latest.sessionToken);
  if (!switched && !relayConnected) {
    // 热切换失败且当前无可用连接时，执行兜底硬重连
    relayClient?.disconnect();
    relayClient = createRelayClient(latest.sessionToken);
    relayConnected = false;
    console.warn("[daemon] relay 热切换失败，已触发兜底硬重连");
  }

  ensureLocalServerWithKeys(latest);

  if (!sessions.includes(latest.sessionId)) {
    sessions = [latest.sessionId, ...sessions];
    writeDaemonState();
  }

  console.log(`[daemon] 运行时重绑完成 trigger=${trigger} session=${latest.sessionId}`);
  return {
    ok: true,
    relay: relayConnected ? "connected" : "disconnected",
    localServer: localServer ? "running" : "stopped",
    sessionId: latest.sessionId,
  };
}

console.log(`[daemon] 已启动 PID=${process.pid} 端口=${server.port} relay=${serverUrl}`);
console.log(`[daemon] 版本: ${CLI_VERSION}`);

const stateHeartbeatTimer = setInterval(() => {
  syncDaemonSessionsState();
}, 60_000);
const skillInstallSweepTimer = setInterval(() => {
  void skillInstallSweepExpiredSessions()
    .then((pruned) => {
      if (pruned > 0) {
        appendSkillAuditWithTrim(
          "session-sweep",
          `pruned ${pruned} expired skill install session(s)`,
          "info",
          { pruned },
        );
      }
    })
    .catch(() => {});
}, 60_000);

// --- Token 定时刷新（每 30 分钟检查） ---
let tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;
if (keys) {
  tokenRefreshTimer = setInterval(refreshTokenIfNeeded, 30 * 60 * 1000);
  // 启动时也检查一次
  refreshTokenIfNeeded().catch(() => {});
}

// --- 优雅退出 ---
function cleanup() {
  clearInterval(stateHeartbeatTimer);
  clearInterval(skillInstallSweepTimer);
  if (tokenRefreshTimer) {
    clearInterval(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
  unsubscribeEventPersistence();
  notificationHub.stop();
  pushService.stop();
  sseManager.stop();
  localServer?.stop();
  relayClient?.disconnect();
  removeState();
  try { closeSync(daemonLockFd); } catch {}
  try { unlinkSync(LOCK_FILE); } catch {}
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
process.on("exit", () => {
  try { closeSync(daemonLockFd); } catch {}
  try { unlinkSync(LOCK_FILE); } catch {}
});

// --- 会话切换处理 ---
async function deriveSharedKeyForSession(keys: StoredKeys, sessionId: string): Promise<CryptoKey> {
  return deriveAesGcmKey({
    privateKey: keys.secretKey,
    publicKey: keys.peerPublicKey,
    salt: sessionId,
    info: DEFAULT_E2EE_INFO,
  });
}

async function handleSessionSwitch(envelope: Envelope): Promise<boolean> {
  const currentKeys = loadKeys();
  if (!currentKeys?.secretKey || !currentKeys.peerPublicKey || !currentKeys.sessionId) {
    console.warn("[daemon] session_switch 缺少密钥材料");
    return false;
  }

  let payload: string;
  try {
    const sharedKey = await deriveSharedKeyForSession(currentKeys, currentKeys.sessionId);
    payload = await openEnvelopeWeb(envelope, sharedKey);
  } catch (err: any) {
    console.warn("[daemon] session_switch 解密失败:", err?.message || err);
    return false;
  }

  let sw: SessionSwitchPayload;
  try {
    sw = JSON.parse(payload);
  } catch {
    return false;
  }

  const newSessionId = sw.sessionId;
  const newToken = sw.tokens?.[currentKeys.deviceId];
  if (!newSessionId || !newToken) {
    console.warn("[daemon] session_switch 缺少 token，忽略");
    return false;
  }

  saveKeys({ ...currentKeys, sessionId: newSessionId, sessionToken: newToken });
  pendingSwitchAck = { sessionId: newSessionId };
  const rebound = await rebindRuntimeFromKeystore("session_switch");
  if (!rebound.ok) {
    console.warn(`[daemon] session_switch 重绑失败: ${rebound.reason || "unknown"}`);
  }
  console.log(`[daemon] 已切换会话: ${newSessionId}`);
  return true;
}

async function sendSessionSwitchAck(sessionId: string): Promise<void> {
  const currentKeys = loadKeys();
  if (!currentKeys?.secretKey || !currentKeys.peerPublicKey || !currentKeys.deviceId) return;
  if (!relayClient || !relayConnected) return;

  const sharedKey = await deriveSharedKeyForSession(currentKeys, sessionId);
  const payload: SessionSwitchAckPayload = {
    sessionId,
    deviceId: currentKeys.deviceId,
    role: "agent",
  };
  const env = await createEnvelopeWeb(
    currentKeys.deviceId,
    "broadcast",
    sessionId,
    MessageType.SESSION_SWITCH_ACK,
    JSON.stringify(payload),
    sharedKey,
    seq.next(),
  );
  relayClient.send(env);
}

function listTrackedSessions() {
  return sessionManager.list().map((item) => ({
    sessionId: item.sessionId,
    pid: item.pid,
    agent: item.agent,
    directory: item.directory,
    startedAt: item.startedAt,
    status: item.status,
  }));
}

async function sendEncryptedRelayPayload(
  sessionId: string,
  target: string,
  type: MessageType,
  payload: string,
): Promise<void> {
  const currentKeys = loadKeys();
  if (!currentKeys?.secretKey || !currentKeys.peerPublicKey || !currentKeys.deviceId) return;
  if (!relayClient || !relayConnected) return;
  const sharedKey = await deriveSharedKeyForSession(currentKeys, sessionId);
  const env = await createEnvelopeWeb(
    currentKeys.deviceId,
    target || "broadcast",
    sessionId,
    type,
    payload,
    sharedKey,
    seq.next(),
  );
  relayClient.send(env);
}

async function sendSessionStatus(
  sessionId: string,
  target: string,
  payload: SessionStatusPayload,
): Promise<void> {
  await sendEncryptedRelayPayload(
    sessionId,
    target,
    MessageType.SESSION_STATUS,
    JSON.stringify(payload),
  );
}

async function sendSessionList(
  sessionId: string,
  target: string,
): Promise<void> {
  await sendEncryptedRelayPayload(
    sessionId,
    target,
    MessageType.SESSION_LIST,
    JSON.stringify({ sessions: listTrackedSessions() }),
  );
}

async function handleSessionLifecycleMessage(envelope: Envelope): Promise<void> {
  const currentKeys = loadKeys();
  if (!currentKeys?.secretKey || !currentKeys.peerPublicKey || !currentKeys.deviceId) {
    return;
  }

  const target = envelope.source || "broadcast";
  const responseSessionId = envelope.sessionId || currentKeys.sessionId;
  if (!responseSessionId) return;
  let plaintext = "";
  try {
    const sharedKey = await deriveSharedKeyForSession(currentKeys, responseSessionId);
    plaintext = await openEnvelopeWeb(envelope, sharedKey);
  } catch (err: any) {
    await sendSessionStatus(responseSessionId, target, {
      action: envelope.type === MessageType.SESSION_STOP ? "stop" : envelope.type === MessageType.SESSION_LIST ? "list" : "spawn",
      ok: false,
      message: `解密失败: ${err?.message || String(err)}`,
    });
    return;
  }

  try {
    if (envelope.type === MessageType.SESSION_SPAWN) {
      const req = safeParsePayload(SessionSpawnPayloadSchema, plaintext, "SESSION_SPAWN") as SessionSpawnPayload;
      const agent = (req.agent || defaultAgent) as AgentType;
      const session = sessionManager.spawn(req.directory, agent, undefined, req.resumeSessionId);
      syncDaemonSessionsState();
      appendTimelineEvent(
        "session_spawn",
        { sessionId: session.id, directory: req.directory, agent, resumeSessionId: req.resumeSessionId ?? null },
        responseSessionId,
      );
      await sendSessionStatus(responseSessionId, target, {
        action: "spawn",
        ok: true,
        sessionId: session.id,
        session: {
          sessionId: session.id,
          pid: session.pid,
          agent: session.agent,
          directory: session.directory,
          startedAt: session.startedAt,
          status: session.handle ? "running" : "stopped",
        },
        message: "session spawned",
      });
      await sendSessionList(responseSessionId, target);
      return;
    }

    if (envelope.type === MessageType.SESSION_STOP) {
      const req = safeParsePayload(SessionStopPayloadSchema, plaintext, "SESSION_STOP") as SessionStopPayload;
      const stopped = sessionManager.stop(req.sessionId);
      syncDaemonSessionsState();
      appendTimelineEvent(
        "session_stop",
        { sessionId: req.sessionId, stopped },
        responseSessionId,
      );
      await sendSessionStatus(responseSessionId, target, {
        action: "stop",
        ok: stopped,
        sessionId: req.sessionId,
        message: stopped ? "session stopped" : "session not found",
      });
      await sendSessionList(responseSessionId, target);
      return;
    }

    if (envelope.type === MessageType.SESSION_LIST) {
      const sessions = listTrackedSessions();
      appendTimelineEvent(
        "session_list",
        { count: sessions.length },
        responseSessionId,
      );
      await sendSessionList(responseSessionId, target);
      await sendSessionStatus(responseSessionId, target, {
        action: "list",
        ok: true,
        sessions,
      });
    }
  } catch (err: any) {
    await sendSessionStatus(responseSessionId, target, {
      action: envelope.type === MessageType.SESSION_STOP ? "stop" : envelope.type === MessageType.SESSION_LIST ? "list" : "spawn",
      ok: false,
      message: err?.message || String(err),
    });
  }
}

// --- Feature 9: 定时任务引擎 ---

const SCHEDULES_FILE = `${YUANIO_DIR}/schedules.json`;
let scheduleSeq = 0;

interface ScheduleEntry {
  id: string;
  cron: string;
  prompt: string;
  agent?: string;
  enabled: boolean;
  lastRun?: number;
}

function loadSchedules(): ScheduleEntry[] {
  try {
    if (!existsSync(SCHEDULES_FILE)) return [];
    return JSON.parse(readFileSync(SCHEDULES_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveSchedules(schedules: ScheduleEntry[]): void {
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

function addSchedule(payload: ScheduleCreatePayload): ScheduleEntry {
  const schedules = loadSchedules();
  const entry: ScheduleEntry = {
    id: payload.id || `sched_${++scheduleSeq}_${Date.now()}`,
    cron: payload.cron,
    prompt: payload.prompt,
    agent: payload.agent,
    enabled: payload.enabled !== false,
  };
  schedules.push(entry);
  saveSchedules(schedules);
  return entry;
}

function removeSchedule(id: string): boolean {
  const schedules = loadSchedules();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  schedules.splice(idx, 1);
  saveSchedules(schedules);
  return true;
}

/** 简易 5 字段 cron 匹配（分 时 日 月 周） */
function matchCron(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const checks = [
    { value: date.getMinutes(), field: fields[0] },
    { value: date.getHours(), field: fields[1] },
    { value: date.getDate(), field: fields[2] },
    { value: date.getMonth() + 1, field: fields[3] },
    { value: date.getDay(), field: fields[4] },
  ];

  return checks.every(({ value, field }) => matchCronField(field, value));
}

function matchCronField(field: string, value: number): boolean {
  if (field === "*") return true;

  // 处理 */n 步进
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    return step > 0 && value % step === 0;
  }

  // 处理逗号分隔
  const parts = field.split(",");
  for (const part of parts) {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

/** 调度触发：通过 relay 发送 SCHEDULE_TRIGGER 消息 */
async function triggerSchedule(entry: ScheduleEntry): Promise<void> {
  const currentKeys = loadKeys();
  if (!currentKeys?.secretKey || !currentKeys.peerPublicKey || !currentKeys.deviceId) return;
  if (!relayClient || !relayConnected) return;

  const sharedKey = await deriveSharedKeyForSession(currentKeys, currentKeys.sessionId);
  const payload = JSON.stringify({
    scheduleId: entry.id,
    prompt: entry.prompt,
    agent: entry.agent,
  });

  const env = await createEnvelopeWeb(
    currentKeys.deviceId,
    "broadcast",
    currentKeys.sessionId,
    MessageType.SCHEDULE_TRIGGER,
    payload,
    sharedKey,
    seq.next(),
  );
  relayClient.send(env);
  console.log(`[scheduler] 触发: ${entry.id} → "${entry.prompt.slice(0, 50)}"`);
}

// 每 60 秒检查调度
setInterval(() => {
  const now = new Date();
  const schedules = loadSchedules();
  let changed = false;

  for (const entry of schedules) {
    if (!entry.enabled) continue;
    if (!matchCron(entry.cron, now)) continue;

    // 防止同一分钟重复触发
    const lastMin = entry.lastRun
      ? Math.floor(entry.lastRun / 60000)
      : 0;
    const nowMin = Math.floor(Date.now() / 60000);
    if (lastMin === nowMin) continue;

    entry.lastRun = Date.now();
    changed = true;
    void triggerSchedule(entry);
  }

  if (changed) saveSchedules(schedules);
}, 60_000);

console.log("[scheduler] 定时任务引擎已启动");
