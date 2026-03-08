import { createServer } from "node:http";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { Server as SocketServer, Socket } from "socket.io";
import { logger } from "./logger";
import { validateEnvironment } from "./env-validator";
import {
  createSession, saveMessage, getMessages,
  addDevice, getDeviceByToken, updateDeviceToken,
  createPairingRequest, getPairingRequest, joinPairingRequest,
  revokeToken, saveEncryptedMessage, saveEncryptedMessagesBatch, getEncryptedMessages,
  logConnection, getConnectionLogs,
  getSessionVersion, incrementSessionVersion,
  updateFcmToken, getFcmTokensBySession,
  clearFcmTokenByValue,
  getDevicesBySession, queueDeliveriesBatch, markDeliveryAcked, getPendingDeliveries,
  getDevicesBySessionWithTokens, updateDeviceSession, sessionExists,
  getSessionMembershipsByNamespace, upsertSessionMembership,
  getSessionNamespace, sessionBelongsToNamespace,
} from "./db";
import { resolveDeliveryTargets } from "./delivery-queue";
import { initFCM, isFCMEnabled, sendPush, buildPushPayload, buildErrorPushPayload } from "./fcm";
import { generatePairingCode, generateDeviceId } from "./pair";
import { signToken, verifyToken, verifyTokenForRefresh } from "./jwt";
import { checkRateLimit, checkRateLimitWithWindow } from "./rate-limit";
import { loadRelayRuntimeEnv } from "@yuanio/shared";
import {
  ACK_REQUIRED_TYPES,
  DEFAULT_NAMESPACE,
  EnvelopeSchema,
  MAX_ENVELOPE_BINARY_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  isProtocolCompatible,
  normalizeNamespace,
} from "@yuanio/shared";
import type { AckState } from "@yuanio/shared";
import { RELAY_PING_INTERVAL_MS, RELAY_PING_TIMEOUT_MS } from "./socket-options";

const { env: relayEnv } = loadRelayRuntimeEnv({ env: process.env, startDir: import.meta.dir });

const app = new Hono();
const PORT = Number(relayEnv.PORT) || 3000;
const RELAY_LATENCY_LOG = relayEnv.YUANIO_RELAY_LATENCY_LOG === "1";
const WRITE_FLUSH_DELAY_MS = Number(relayEnv.YUANIO_RELAY_FLUSH_DELAY_MS ?? 60);
const WRITE_FLUSH_BATCH_SIZE = Number(relayEnv.YUANIO_RELAY_FLUSH_BATCH_SIZE ?? 64);
const DELIVERY_FLUSH_DELAY_MS = Number(relayEnv.YUANIO_RELAY_DELIVERY_FLUSH_DELAY_MS ?? 40);
const DELIVERY_FLUSH_BATCH_SIZE = Number(relayEnv.YUANIO_RELAY_DELIVERY_FLUSH_BATCH_SIZE ?? 128);
const DELIVERY_IMMEDIATE_DIRECT_MAX_ROWS = Number(
  relayEnv.YUANIO_RELAY_DELIVERY_IMMEDIATE_DIRECT_MAX_ROWS ?? 8,
);
const SESSION_DEVICE_CACHE_TTL_MS = Number(relayEnv.YUANIO_RELAY_SESSION_DEVICE_CACHE_TTL_MS ?? 1000);
const recoveryMsRaw = Number(relayEnv.YUANIO_RELAY_RECOVERY_MS ?? 120_000);
const CONNECTION_RECOVERY_MAX_MS = Number.isFinite(recoveryMsRaw)
  ? Math.max(5_000, Math.floor(recoveryMsRaw))
  : 120_000;
const REQUIRE_PROTOCOL_VERSION = relayEnv.YUANIO_REQUIRE_PROTOCOL_VERSION === "1";
const maxHttpBufferRaw = Number(
  relayEnv.YUANIO_RELAY_MAX_HTTP_BUFFER_BYTES ?? MAX_ENVELOPE_BINARY_PAYLOAD_BYTES,
);
const RELAY_MAX_HTTP_BUFFER_BYTES = Number.isFinite(maxHttpBufferRaw)
  ? Math.max(16 * 1024, Math.floor(maxHttpBufferRaw))
  : MAX_ENVELOPE_BINARY_PAYLOAD_BYTES;
const TELEGRAM_WEBHOOK_FORWARD_ENABLED = relayEnv.YUANIO_TELEGRAM_WEBHOOK_FORWARD_ENABLED !== "0";
const TELEGRAM_WEBHOOK_FORWARD_URL = relayEnv.YUANIO_TELEGRAM_WEBHOOK_FORWARD_URL
  || "http://127.0.0.1:8787/telegram/webhook";
const corsAllowList = (relayEnv.YUANIO_CORS_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const allowAllOrigins = corsAllowList.length === 0 || corsAllowList.includes("*");
const EVENT_LOOP_MONITOR_INTERVAL_MS = Number(relayEnv.YUANIO_RELAY_EVENT_LOOP_MONITOR_INTERVAL_MS ?? 100);
const EVENT_LOOP_WARN_MS = Number(relayEnv.YUANIO_RELAY_EVENT_LOOP_WARN_MS ?? 200);
const EVENT_LOOP_RING_SIZE = Number(relayEnv.YUANIO_RELAY_EVENT_LOOP_RING_SIZE ?? 256);
const OUTBOUND_FLUSH_DELAY_MS = Number(relayEnv.YUANIO_RELAY_OUTBOUND_FLUSH_DELAY_MS ?? 2);
const OUTBOUND_BASE_BATCH_SIZE = Number(relayEnv.YUANIO_RELAY_OUTBOUND_BASE_BATCH_SIZE ?? 16);
const OUTBOUND_MIN_BATCH_SIZE = Number(relayEnv.YUANIO_RELAY_OUTBOUND_MIN_BATCH_SIZE ?? 6);
const OUTBOUND_MAX_BATCH_SIZE = Number(relayEnv.YUANIO_RELAY_OUTBOUND_MAX_BATCH_SIZE ?? 96);
const OUTBOUND_MAX_BUFFERED_BYTES = Number(relayEnv.YUANIO_RELAY_OUTBOUND_MAX_BUFFERED_BYTES ?? 786_432);
const OUTBOUND_MAX_QUEUE_ITEMS = Number(relayEnv.YUANIO_RELAY_OUTBOUND_MAX_QUEUE_ITEMS ?? 2048);
const OUTBOUND_AIMD_RTT_WARN_MS = Number(relayEnv.YUANIO_RELAY_OUTBOUND_AIMD_RTT_WARN_MS ?? 900);
const OUTBOUND_AIMD_DECREASE_FACTOR = Number(relayEnv.YUANIO_RELAY_OUTBOUND_AIMD_DECREASE_FACTOR ?? 0.7);
const OUTBOUND_AIMD_INCREASE_STEP = Number(relayEnv.YUANIO_RELAY_OUTBOUND_AIMD_INCREASE_STEP ?? 1);
const ACK_RTT_RING_SIZE = Number(relayEnv.YUANIO_RELAY_ACK_RTT_RING_SIZE ?? 512);
const ACK_TRACKING_TTL_MS = Number(relayEnv.YUANIO_RELAY_ACK_TRACKING_TTL_MS ?? 120_000);
const ACK_SWEEP_INTERVAL_MS = Number(relayEnv.YUANIO_RELAY_ACK_SWEEP_INTERVAL_MS ?? 5_000);
const ACK_MARK_FLUSH_DELAY_MS = Number(relayEnv.YUANIO_RELAY_ACK_MARK_FLUSH_DELAY_MS ?? 6);
const ACK_MARK_FLUSH_BATCH_SIZE = Number(relayEnv.YUANIO_RELAY_ACK_MARK_FLUSH_BATCH_SIZE ?? 128);
const SESSION_IDLE_RECLAIM_MS_RAW = Number(relayEnv.YUANIO_RELAY_SESSION_IDLE_RECLAIM_MS ?? 3 * 60_000);
const SESSION_IDLE_SWEEP_INTERVAL_MS_RAW = Number(relayEnv.YUANIO_RELAY_SESSION_IDLE_SWEEP_INTERVAL_MS ?? 30_000);
const SESSION_STARTUP_RETRY_AFTER_MS_RAW = Number(relayEnv.YUANIO_RELAY_SESSION_STARTUP_RETRY_AFTER_MS ?? 1200);
const FCM_TOKEN_MAX_LENGTH_RAW = Number(relayEnv.YUANIO_FCM_TOKEN_MAX_LENGTH ?? 4096);
const PUSH_REGISTER_RATE_LIMIT_MAX_RAW = Number(relayEnv.YUANIO_PUSH_REGISTER_RATE_LIMIT_MAX ?? 20);
const PUSH_REGISTER_RATE_LIMIT_WINDOW_MS_RAW = Number(relayEnv.YUANIO_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS ?? 60_000);
const NON_PERSISTED_MESSAGE_TYPES = new Set<string>([
  "stream_chunk",
  "thinking",
  "heartbeat",
  "status",
  "interaction_state",
  "terminal_output",
]);
const TRANSIENT_OUTBOUND_MESSAGE_TYPES = new Set<string>([
  ...NON_PERSISTED_MESSAGE_TYPES,
  "pty_output",
  "pty_status",
  "pty_ack",
]);

const NORMALIZED_ACK_MARK_FLUSH_DELAY_MS = Number.isFinite(ACK_MARK_FLUSH_DELAY_MS)
  ? Math.max(0, Math.floor(ACK_MARK_FLUSH_DELAY_MS))
  : 6;
const NORMALIZED_ACK_MARK_FLUSH_BATCH_SIZE = Number.isFinite(ACK_MARK_FLUSH_BATCH_SIZE)
  ? Math.max(1, Math.floor(ACK_MARK_FLUSH_BATCH_SIZE))
  : 128;
const NORMALIZED_DELIVERY_IMMEDIATE_DIRECT_MAX_ROWS = Number.isFinite(DELIVERY_IMMEDIATE_DIRECT_MAX_ROWS)
  ? Math.max(1, Math.floor(DELIVERY_IMMEDIATE_DIRECT_MAX_ROWS))
  : 8;
const NORMALIZED_FCM_TOKEN_MAX_LENGTH = Number.isFinite(FCM_TOKEN_MAX_LENGTH_RAW)
  ? Math.max(128, Math.floor(FCM_TOKEN_MAX_LENGTH_RAW))
  : 4096;
const NORMALIZED_PUSH_REGISTER_RATE_LIMIT_MAX = Number.isFinite(PUSH_REGISTER_RATE_LIMIT_MAX_RAW)
  ? Math.max(1, Math.floor(PUSH_REGISTER_RATE_LIMIT_MAX_RAW))
  : 20;
const NORMALIZED_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS = Number.isFinite(PUSH_REGISTER_RATE_LIMIT_WINDOW_MS_RAW)
  ? Math.max(1_000, Math.floor(PUSH_REGISTER_RATE_LIMIT_WINDOW_MS_RAW))
  : 60_000;

if (relayEnv.NODE_ENV === "production" && allowAllOrigins) {
  console.warn("[relay] production ???????? YUANIO_CORS_ORIGINS??? CORS ???");
}

function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true; // 鍘熺敓瀹㈡埛绔彙鎵嬮€氬父鏃?Origin
if (allowAllOrigins) return true;
  return corsAllowList.includes(origin);
}

const eventLoopLagSamples: number[] = [];
let eventLoopLagLastMs = 0;
let eventLoopLagMaxMs = 0;
let eventLoopExpected = performance.now() + EVENT_LOOP_MONITOR_INTERVAL_MS;

const eventLoopTimer = setInterval(() => {
  const now = performance.now();
  const lag = Math.max(0, now - eventLoopExpected);
  eventLoopLagLastMs = lag;
  if (lag > eventLoopLagMaxMs) eventLoopLagMaxMs = lag;
  eventLoopLagSamples.push(lag);
  if (eventLoopLagSamples.length > Math.max(1, EVENT_LOOP_RING_SIZE)) {
    eventLoopLagSamples.shift();
  }
  if (RELAY_LATENCY_LOG && lag >= EVENT_LOOP_WARN_MS) {
    console.warn(`[relay] event_loop_lag=${lag.toFixed(1)}ms`);
  }
  eventLoopExpected = now + EVENT_LOOP_MONITOR_INTERVAL_MS;
}, Math.max(10, EVENT_LOOP_MONITOR_INTERVAL_MS));
eventLoopTimer.unref?.();

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low]!;
  const weight = rank - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

function summarizeEventLoopLag() {
  if (eventLoopLagSamples.length === 0) {
    return { count: 0, p50: 0, p95: 0, max: 0, last: 0 };
  }
  const sorted = [...eventLoopLagSamples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: eventLoopLagMaxMs,
    last: eventLoopLagLastMs,
  };
}

function runSoon(task: () => void) {
  if (typeof setImmediate === "function") {
    const immediate = setImmediate(task);
    immediate.unref?.();
    return;
  }
  const t = setTimeout(task, 0);
  t.unref?.();
}

function getRequestNamespace(c: any, body?: Record<string, unknown>): string {
  const fromBody = typeof body?.namespace === "string" ? body.namespace : undefined;
  const fromHeader = c.req.header("x-yuanio-namespace") || undefined;
  return normalizeNamespace(fromBody || fromHeader || DEFAULT_NAMESPACE);
}

function getClientIp(c: any): string {
  const xffRaw = c.req.header("x-forwarded-for") || "";
  const xff = xffRaw.split(",").map((s: string) => s.trim()).find(Boolean);
  return xff || c.req.header("x-real-ip") || "unknown";
}

function normalizeFcmToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token) return null;
  if (token.length > NORMALIZED_FCM_TOKEN_MAX_LENGTH) return null;
  return token;
}

function registerFcmTokenForDevice(deviceId: string, role: string, token: string) {
  updateFcmToken(deviceId, token);
  logger.info({ role, event: "fcm_token_registered" }, "FCM token registered");
}

function logPushRegisterAudit(
  event: "accepted" | "rejected",
  info: {
    ip: string;
    deviceId?: string;
    sessionId?: string;
    role?: string;
    reason?: string;
  },
) {
  const detail = [
    `event=${event}`,
    `ip=${info.ip}`,
    info.deviceId ? `device=${info.deviceId}` : null,
    info.sessionId ? `session=${info.sessionId}` : null,
    info.role ? `role=${info.role}` : null,
    info.reason ? `reason=${info.reason}` : null,
  ].filter(Boolean).join(" ");
  console.log(`[push-register] ${detail}`);
}

// --- 鍩虹璺敱 ---
app.get("/health", (c) => {
  const relayState = buildRelayStateSnapshot();
  return c.json({
    status: "ok",
    protocolVersion: PROTOCOL_VERSION,
    serverNowMs: relayState.serverNowMs,
    relayState,
    eventLoopLagMs: summarizeEventLoopLag(),
    ackRttMs: summarizeAckRtt(),
    outboundQueue: summarizeOutboundQueues(),
    fcm: {
      enabled: isFCMEnabled(),
      pushRegisterRateLimit: {
        max: NORMALIZED_PUSH_REGISTER_RATE_LIMIT_MAX,
        windowMs: NORMALIZED_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS,
      },
    },
  });
});

app.get("/relay/state", (c) => {
  const relayState = buildRelayStateSnapshot();
  const statusCode: 200 | 202 = relayState.status === "warming_up" ? 202 : 200;
  return c.json(relayState, statusCode);
});

app.post("/telegram/webhook", async (c) => {
  if (!TELEGRAM_WEBHOOK_FORWARD_ENABLED) {
    return c.text("disabled", 503);
  }
  try {
    const raw = await c.req.text();
    const secret = c.req.header("x-telegram-bot-api-secret-token");
    const headers: Record<string, string> = {
      "content-type": c.req.header("content-type") || "application/json",
    };
    if (secret) headers["x-telegram-bot-api-secret-token"] = secret;

    const upstream = await fetch(TELEGRAM_WEBHOOK_FORWARD_URL, {
      method: "POST",
      headers,
      body: raw,
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "text/plain; charset=utf-8";
    return c.body(text || "ok", upstream.status as 200 | 400 | 401 | 404 | 500, {
      "content-type": contentType,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[telegram-forward] ${msg}`);
    return c.text("forward error", 502);
  }
});

app.post("/sessions", async (c) => {
  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}
  const namespace = getRequestNamespace(c, body);
  const id = crypto.randomUUID();
  createSession(id, namespace);
  return c.json({ id, namespace });
});

app.get("/sessions/:id", (c) => {
  const messages = getMessages(c.req.param("id"));
  return c.json({ messages });
});

// --- 閰嶅 API ---

// CLI 鍒涘缓閰嶅璇锋眰
app.post("/api/v1/pair/create", async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(ip)) return c.json({ error: "rate limit exceeded", retryAfter: 60 }, 429);

  const body = await c.req.json() as { publicKey?: string; namespace?: string; protocolVersion?: string };
  const { publicKey } = body;
  if (!publicKey) return c.json({ error: "publicKey required" }, 400);
  const namespace = getRequestNamespace(c, body);
  const clientProtocol = body.protocolVersion || c.req.header("x-yuanio-protocol-version") || undefined;
  if (REQUIRE_PROTOCOL_VERSION && !clientProtocol) {
    return c.json({ error: "protocol version required", serverProtocolVersion: PROTOCOL_VERSION }, 426);
  }
  const protocolCheck = isProtocolCompatible(clientProtocol, PROTOCOL_VERSION);
  if (!protocolCheck.ok) {
    return c.json({ error: "protocol mismatch", detail: protocolCheck.reason, serverProtocolVersion: PROTOCOL_VERSION }, 426);
  }

  const sessionId = crypto.randomUUID();
  createSession(sessionId, namespace);

  const deviceId = generateDeviceId();
  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const sessionToken = await signToken({
    deviceId,
    sessionId,
    role: "agent",
    namespace,
    protocolVersion: PROTOCOL_VERSION,
  });

  addDevice(deviceId, publicKey, "agent", sessionId, sessionToken);
  createPairingRequest(pairingCode, sessionId, publicKey, deviceId, sessionToken, expiresAt);

  return c.json({ pairingCode, sessionToken, deviceId, sessionId, namespace, protocolVersion: PROTOCOL_VERSION });
});

// App 鍔犲叆閰嶅
app.post("/api/v1/pair/join", async (c) => {
  const ip = getClientIp(c);
  if (!checkRateLimit(ip)) return c.json({ error: "rate limit exceeded", retryAfter: 60 }, 429);

  const body = await c.req.json() as {
    code?: string;
    publicKey?: string;
    protocolVersion?: string;
  };
  const { code, publicKey } = body;
  if (!code || !publicKey) return c.json({ error: "code and publicKey required" }, 400);
  const clientProtocol = body.protocolVersion || c.req.header("x-yuanio-protocol-version") || undefined;
  if (REQUIRE_PROTOCOL_VERSION && !clientProtocol) {
    return c.json({ error: "protocol version required", serverProtocolVersion: PROTOCOL_VERSION }, 426);
  }
  const protocolCheck = isProtocolCompatible(clientProtocol, PROTOCOL_VERSION);
  if (!protocolCheck.ok) {
    return c.json({ error: "protocol mismatch", detail: protocolCheck.reason, serverProtocolVersion: PROTOCOL_VERSION }, 426);
  }

  const req = getPairingRequest(code);
  if (!req) return c.json({ error: "invalid code" }, 404);
  if (req.joined) return c.json({ error: "already joined" }, 409);
  if (new Date(req.expires_at) < new Date()) return c.json({ error: "code expired" }, 410);

  const namespace = getSessionNamespace(req.session_id) || DEFAULT_NAMESPACE;
  const deviceId = generateDeviceId();
  const sessionToken = await signToken({
    deviceId,
    sessionId: req.session_id,
    role: "app",
    namespace,
    protocolVersion: PROTOCOL_VERSION,
  });

  addDevice(deviceId, publicKey, "app", req.session_id, sessionToken);
  joinPairingRequest(code, publicKey, deviceId, sessionToken);

  return c.json({
    agentPublicKey: req.agent_public_key,
    sessionToken,
    deviceId,
    sessionId: req.session_id,
    namespace,
    protocolVersion: PROTOCOL_VERSION,
  });
});

// 杞閰嶅鐘舵€?
app.get("/api/v1/pair/status/:code", (c) => {
  const req = getPairingRequest(c.req.param("code"));
  if (!req) return c.json({ error: "not found" }, 404);

  return c.json({
    joined: !!req.joined,
    appPublicKey: req.app_public_key || null,
  });
});

// 涓诲姩鍚婇攢 token
app.post("/api/v1/token/revoke", async (c) => {
  const { token } = await c.req.json();
  if (!token) return c.json({ error: "token required" }, 400);
  revokeToken(token);
  return c.json({ revoked: true });
});

// Token 鍒锋柊锛堝惈瀹介檺鏈熼獙璇侊級
app.post("/api/v1/token/refresh", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const oldToken = authHeader.slice(7);

  // 瀹介檺鏈熼獙璇侊細鍏佽杩囨湡鍚?1h 鍐呯殑 token
const payload = await verifyTokenForRefresh(oldToken);
  if (!payload) return c.json({ error: "token invalid or beyond grace period" }, 401);

  // 纭璁惧瀛樺湪
const device = getDeviceByToken(oldToken);
  if (!device) return c.json({ error: "device not found" }, 404);

  // 绛惧彂鏂?token锛堜繚鎸佺浉鍚?deviceId/sessionId/role锛?
const newToken = await signToken({
    deviceId: payload.deviceId,
    sessionId: payload.sessionId,
    role: payload.role,
    namespace: payload.namespace,
    protocolVersion: PROTOCOL_VERSION,
  });

  // 鏇存柊 DB + 鍚婇攢鏃?token
  updateDeviceToken(payload.deviceId, newToken);
  revokeToken(oldToken);

  return c.json({ sessionToken: newToken });
});

// FCM Push token 娉ㄥ唽锛圚TTP锛?
app.post("/api/v1/push/register", async (c) => {
  const ip = getClientIp(c);
  const allow = checkRateLimitWithWindow(
    `push_register:${ip}`,
    NORMALIZED_PUSH_REGISTER_RATE_LIMIT_MAX,
    NORMALIZED_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS,
  );
  if (!allow) {
    logPushRegisterAudit("rejected", { ip, reason: "rate_limit" });
    return c.json({
      error: "rate limit exceeded",
      retryAfter: Math.ceil(NORMALIZED_PUSH_REGISTER_RATE_LIMIT_WINDOW_MS / 1000),
    }, 429);
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    logPushRegisterAudit("rejected", { ip, reason: "authorization_required" });
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) {
    logPushRegisterAudit("rejected", { ip, reason: "invalid_token" });
    return c.json({ error: "invalid token" }, 401);
  }

  const device = getDeviceByToken(token);
  if (!device || device.id !== payload.deviceId) {
    logPushRegisterAudit("rejected", {
      ip,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
      role: payload.role,
      reason: "device_not_found",
    });
    return c.json({ error: "device not found" }, 404);
  }
  if (!sessionBelongsToNamespace(payload.sessionId, payload.namespace)) {
    logPushRegisterAudit("rejected", {
      ip,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
      role: payload.role,
      reason: "namespace_mismatch",
    });
    return c.json({ error: "namespace mismatch" }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await c.req.json(); } catch {}
  const fcmToken = normalizeFcmToken(body.token);
  if (!fcmToken) {
    logPushRegisterAudit("rejected", {
      ip,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
      role: payload.role,
      reason: "invalid_fcm_token",
    });
    return c.json({
      error: `token required and max length is ${NORMALIZED_FCM_TOKEN_MAX_LENGTH}`,
    }, 400);
  }

  registerFcmTokenForDevice(payload.deviceId, payload.role, fcmToken);
  logPushRegisterAudit("accepted", {
    ip,
    deviceId: payload.deviceId,
    sessionId: payload.sessionId,
    role: payload.role,
  });
  return c.json({
    registered: true,
    deviceId: payload.deviceId,
    role: payload.role,
    sessionId: payload.sessionId,
  });
});

// 鏌ヨ浼氳瘽娑堟伅鍘嗗彶锛堝瘑鏂囷級鈥?闇€ JWT 璁よ瘉
app.get("/api/v1/sessions/:id/messages", async (c) => {
  // JWT 璁よ瘉
const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid token" }, 401);

  // 楠岃瘉璇锋眰鑰呯殑 sessionId 涓庤矾寰勫弬鏁板尮閰?
const sessionId = c.req.param("id");
  if (payload.sessionId !== sessionId) {
    return c.json({ error: "session mismatch" }, 403);
  }
  if (!sessionBelongsToNamespace(sessionId, payload.namespace)) {
    return c.json({ error: "namespace mismatch" }, 403);
  }

  const afterTsRaw = Number(c.req.query("after") || 0);
  const afterTs = Number.isFinite(afterTsRaw) ? Math.max(0, afterTsRaw) : 0;
  const afterCursorRaw = Number(c.req.query("afterCursor") || 0);
  const afterCursor = Number.isFinite(afterCursorRaw) ? Math.max(0, Math.floor(afterCursorRaw)) : 0;
  const limitRaw = Number(c.req.query("limit") || 100);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100, 500));
  const messages = getEncryptedMessages(sessionId, afterTs, limit, afterCursor);
  const nextCursor = messages.length > 0 ? Number(messages[messages.length - 1]?.cursor || afterCursor) : afterCursor;
  return c.json({ messages, count: messages.length, nextCursor });
});

// 璁惧寰呮敹娑堟伅闃熷垪锛圓CK 蹇呴渶绫诲瀷锛?
app.get("/api/v1/queue/pending", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid token" }, 401);

  const limitRaw = Number(c.req.query("limit") || 100);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100, 500));
  const messages = getPendingDeliveries(payload.deviceId, limit);
  const now = Date.now();
  const filtered = messages.filter((row) => !hasRecentAck(payload.deviceId, String(row?.id || ""), now));
  return c.json({ messages: filtered, count: filtered.length });
});

// 浼氳瘽鍒楄〃锛堜粎杩斿洖褰撳墠璁惧鍙闂殑浼氳瘽锛?
app.get("/api/v1/sessions", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid token" }, 401);

  const rows = getSessionMembershipsByNamespace(payload.deviceId, payload.namespace);
  const sessions = rows.map((row) => {
    const devMap = onlineDevices.get(roomKey(payload.namespace, row.session_id));
    const roles = new Set<string>();
    if (devMap) {
      for (const role of devMap.values()) roles.add(role);
    }
    const onlineRoles = Array.from(roles);
    return {
      sessionId: row.session_id,
      role: row.role,
      firstSeen: row.first_seen_ts,
      lastSeen: row.last_seen_ts,
      onlineCount: devMap?.size ?? 0,
      onlineRoles,
      hasAgentOnline: onlineRoles.includes("agent"),
      hasAppOnline: onlineRoles.includes("app"),
    };
  });

  return c.json({ currentSessionId: payload.sessionId, sessions });
});

// 杩炴帴鍏冩暟鎹棩蹇楋紙璋冭瘯鐢級
app.get("/api/v1/sessions/:id/connections", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid token" }, 401);

  const sessionId = c.req.param("id");
  if (payload.sessionId !== sessionId) return c.json({ error: "session mismatch" }, 403);
  if (!sessionBelongsToNamespace(sessionId, payload.namespace)) {
    return c.json({ error: "namespace mismatch" }, 403);
  }

  const logs = getConnectionLogs(sessionId);
  return c.json({ logs, count: logs.length });
});

// 涔愯骞跺彂鎺у埗锛氳幏鍙栦細璇濈増鏈?
app.get("/api/v1/sessions/:id/version", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid token" }, 401);

  const sessionId = c.req.param("id");
  if (payload.sessionId !== sessionId) return c.json({ error: "session mismatch" }, 403);

  const version = getSessionVersion(sessionId, payload.namespace);
  if (version === null) return c.json({ error: "session not found" }, 404);
  return c.json({ version });
});

// 杩滅▼鍒囨崲浼氳瘽锛氬垱寤烘柊 session 鎴栧垏鎹㈠埌鎸囧畾 session
app.post("/api/v1/sessions/switch", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid token" }, 401);

  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const requestedSessionId = typeof body?.sessionId === "string" && body.sessionId.trim()
    ? body.sessionId.trim()
    : null;

  const currentSessionId = payload.sessionId;
  if (!sessionBelongsToNamespace(currentSessionId, payload.namespace)) {
    return c.json({ error: "namespace mismatch" }, 403);
  }
  const online = onlineDevices.get(roomKey(payload.namespace, currentSessionId));
  if (!online || online.size === 0) {
    return c.json({ error: "no online devices" }, 409);
  }

  // 鐩爣浼氳瘽
const targetSessionId = requestedSessionId ?? crypto.randomUUID();
  if (requestedSessionId && !sessionExists(requestedSessionId, payload.namespace)) {
    return c.json({ error: "session not found" }, 404);
  }
  if (!requestedSessionId) createSession(targetSessionId, payload.namespace);

  // 浠呭垏鎹㈠湪绾胯澶囷紝閬垮厤绂荤嚎璁惧琚己鍒跺け鏁?
const onlineDeviceIds = new Set(Array.from(online.keys()));
  const devices = getDevicesBySessionWithTokens(currentSessionId)
    .filter((d) => onlineDeviceIds.has(d.id));

  if (devices.length === 0) {
    return c.json({ error: "no online devices in session" }, 409);
  }
  if (!devices.some((d) => d.role === "agent")) {
    return c.json({ error: "agent offline" }, 409);
  }

  const tokens: Record<string, string> = {};
  for (const dev of devices) {
    const newToken = await signToken({
      deviceId: dev.id,
      sessionId: targetSessionId,
      role: dev.role,
      namespace: payload.namespace,
      protocolVersion: PROTOCOL_VERSION,
    });
    tokens[dev.id] = newToken;
    updateDeviceSession(dev.id, targetSessionId, newToken);
    upsertSessionMembership(dev.id, targetSessionId, dev.role);
    revokeToken(dev.session_token);
  }

  return c.json({ sessionId: targetSessionId, tokens });
});

// 涔愯骞跺彂鎺у埗锛氬甫鐗堟湰鏍￠獙鐨勬洿鏂?
app.post("/api/v1/sessions/:id/update", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "authorization required" }, 401);
  }
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: "invalid token" }, 401);

  const sessionId = c.req.param("id");
  if (payload.sessionId !== sessionId) return c.json({ error: "session mismatch" }, 403);

  const { expectedVersion } = await c.req.json();
  if (typeof expectedVersion !== "number") return c.json({ error: "expectedVersion required" }, 400);

  const ok = incrementSessionVersion(sessionId, expectedVersion, payload.namespace);
  if (!ok) {
    const current = getSessionVersion(sessionId, payload.namespace);
    return c.json({ error: "version conflict", currentVersion: current }, 409);
  }
  return c.json({ success: true, newVersion: expectedVersion + 1 });
});

// HTTP + Socket.IO 鏈嶅姟鍣?
const server = createServer(getRequestListener(app.fetch));
const io = new SocketServer(server, {
  cors: {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  },
  pingInterval: RELAY_PING_INTERVAL_MS,
  pingTimeout: RELAY_PING_TIMEOUT_MS,
  transports: ["websocket"],
  allowUpgrades: false,
  perMessageDeflate: false,
  httpCompression: false,
  maxHttpBufferSize: RELAY_MAX_HTTP_BUFFER_BYTES,
  connectionStateRecovery: {
    maxDisconnectionDuration: CONNECTION_RECOVERY_MAX_MS,
    skipMiddlewares: true,
  },
});

// 缁熶竴 /relay 鍛藉悕绌洪棿 鈥?闆剁煡璇嗕俊灏佽矾鐢?
const relay = io.of("/relay");

function roomKey(namespace: string, sessionId: string): string {
  return `${normalizeNamespace(namespace)}:${sessionId}`;
}

// 璁よ瘉涓棿浠讹細楠岃瘉 JWT
relay.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string;
  if (!token) return next(new Error("auth token required"));
  const protocolVersion = socket.handshake.auth?.protocolVersion as string | undefined;
  if (REQUIRE_PROTOCOL_VERSION && !protocolVersion) {
    return next(new Error("protocol version required"));
  }
  const compat = isProtocolCompatible(protocolVersion, PROTOCOL_VERSION);
  if (!compat.ok) {
    return next(new Error(`protocol mismatch: ${compat.reason}`));
  }

  const payload = await verifyToken(token);
  if (!payload) return next(new Error("invalid or expired token"));

  socket.data.deviceId = payload.deviceId;
  socket.data.sessionId = payload.sessionId;
  socket.data.role = payload.role;
  socket.data.namespace = payload.namespace;
  socket.data.protocolVersion = protocolVersion;
  next();
});

// 寮傛鎵归噺鍐欏叆缂撳啿鍖?鈥?鍏堝箍鎾啀鍒风洏锛屾秷闄ゆ祦寮忚緭鍑洪樆濉?
const writeBuffer: Parameters<typeof saveEncryptedMessage>[0][] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writeFlushing = false;

function enqueueWrite(msg: Parameters<typeof saveEncryptedMessage>[0]) {
  writeBuffer.push(msg);
  if (!flushTimer && !writeFlushing) {
    flushTimer = setTimeout(flushWrites, Math.max(0, WRITE_FLUSH_DELAY_MS));
  }
  maybeFlushWritesSoon();
}

function flushWrites() {
  flushTimer = null;
  if (writeFlushing) return;
  writeFlushing = true;

  const drain = () => {
    const batch = writeBuffer.splice(0, Math.max(1, WRITE_FLUSH_BATCH_SIZE));
    if (batch.length > 0) {
      try { saveEncryptedMessagesBatch(batch); } catch {}
    }
    if (writeBuffer.length > 0) {
      runSoon(drain);
      return;
    }
    writeFlushing = false;
    if (writeBuffer.length > 0 && !flushTimer) {
      flushTimer = setTimeout(flushWrites, Math.max(0, WRITE_FLUSH_DELAY_MS));
    }
  };

  drain();
}

function flushWritesSoon() {
  if (flushTimer || writeFlushing) return;
  flushTimer = setTimeout(flushWrites, 0);
}

function maybeFlushWritesSoon() {
  if (writeBuffer.length >= Math.max(1, WRITE_FLUSH_BATCH_SIZE)) {
    flushWritesSoon();
  }
}

type DeliveryWriteRow = {
  messageId: string;
  sessionId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
};

const deliveryBuffer: DeliveryWriteRow[] = [];
let deliveryFlushTimer: ReturnType<typeof setTimeout> | null = null;
let deliveryFlushing = false;

function enqueueDeliveries(rows: DeliveryWriteRow[]) {
  enqueueDeliveriesWithPriority(rows, false);
}

function enqueueDeliveriesWithPriority(rows: DeliveryWriteRow[], immediate: boolean) {
  if (rows.length === 0) return;
  if (
    immediate
    && rows.length <= NORMALIZED_DELIVERY_IMMEDIATE_DIRECT_MAX_ROWS
    && deliveryBuffer.length === 0
    && !deliveryFlushTimer
    && !deliveryFlushing
  ) {
    try {
      queueDeliveriesBatch(rows);
      return;
    } catch {
      // 鍚屾蹇矾寰勫け璐ユ椂閫€鍥炲紓姝ョ紦鍐诧紝淇濇寔鍔熻兘鍙敤銆?
      }
  }
  deliveryBuffer.push(...rows);
  if (immediate) {
    flushDeliveriesSoon();
    return;
  }
  if (!deliveryFlushTimer && !deliveryFlushing) {
    deliveryFlushTimer = setTimeout(flushDeliveries, Math.max(0, DELIVERY_FLUSH_DELAY_MS));
  }
  if (deliveryBuffer.length >= Math.max(1, DELIVERY_FLUSH_BATCH_SIZE)) {
    flushDeliveriesSoon();
  }
}

function flushDeliveriesSoon() {
  if (deliveryFlushTimer || deliveryFlushing) return;
  deliveryFlushTimer = setTimeout(flushDeliveries, 0);
}

function flushDeliveries() {
  deliveryFlushTimer = null;
  if (deliveryFlushing) return;
  deliveryFlushing = true;

  const drain = () => {
    const batch = deliveryBuffer.splice(0, Math.max(1, DELIVERY_FLUSH_BATCH_SIZE));
    if (batch.length > 0) {
      try { queueDeliveriesBatch(batch); } catch {}
    }
    if (deliveryBuffer.length > 0) {
      runSoon(drain);
      return;
    }
    deliveryFlushing = false;
    if (deliveryBuffer.length > 0 && !deliveryFlushTimer) {
      deliveryFlushTimer = setTimeout(flushDeliveries, Math.max(0, DELIVERY_FLUSH_DELAY_MS));
    }
  };

  drain();
}

const sessionDevicesCache = new Map<string, {
  expiresAt: number;
  devices: { id: string; role: string }[];
}>();

function getSessionDevicesCached(sessionId: string): { id: string; role: string }[] {
  const now = Date.now();
  const cached = sessionDevicesCache.get(sessionId);
  if (cached && cached.expiresAt > now) return cached.devices;
  const devices = getDevicesBySession(sessionId);
  sessionDevicesCache.set(sessionId, {
    expiresAt: now + Math.max(200, SESSION_DEVICE_CACHE_TTL_MS),
    devices,
  });
  return devices;
}

function invalidateSessionDevicesCache(sessionId: string) {
  sessionDevicesCache.delete(sessionId);
}

type AckPayload = {
  messageId: string;
  source: string;
  sessionId: string;
  state: AckState;
  retryAfterMs?: number;
  reason?: string;
  at: number;
};

type OutboundEventName = "message" | "ack";

type OutboundPacket = {
  event: OutboundEventName;
  data: unknown;
  bytes: number;
  transient: boolean;
  priority: number;
  direct?: boolean;
  type?: string;
};

type OutboundState = {
  key: string;
  roomKey: string;
  namespace: string;
  sessionId: string;
  deviceId: string;
  queue: OutboundPacket[];
  bufferedBytes: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  batchSize: number;
  droppedTransient: number;
  slowDisconnects: number;
};

type SessionRuntimePhase = "warming_up" | "ready" | "idle";

type SessionRuntimeState = {
  roomKey: string;
  namespace: string;
  sessionId: string;
  refs: number;
  deviceRefs: Map<string, number>;
  phase: SessionRuntimePhase;
  lastActiveAtMs: number;
  warmupStartedAtMs: number;
  warmupReadyAtMs: number;
  warmupCount: number;
  reclaimCount: number;
  startupPromise: Promise<void> | null;
};

type AckPendingRow = {
  recvAt: number;
  expiresAt: number;
};

const OUTBOUND_PRIORITY_NORMAL = 1;
const OUTBOUND_PRIORITY_PTY = 2;
const OUTBOUND_PRIORITY_ACK = 3;

const outboundDeviceSockets = new Map<string, Set<Socket>>();
const outboundStates = new Map<string, OutboundState>();
const sessionRuntimeStates = new Map<string, SessionRuntimeState>();
const ackPending = new Map<string, AckPendingRow>();
const recentAckByDevice = new Map<string, Map<string, number>>();
const ackRttSamples: number[] = [];
let ackRttLastMs = 0;
let ackRttMaxMs = 0;

function safeInt(value: number, fallback: number, min = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

const NORMALIZED_OUTBOUND_FLUSH_DELAY_MS = safeInt(OUTBOUND_FLUSH_DELAY_MS, 8, 0);
const NORMALIZED_OUTBOUND_BASE_BATCH_SIZE = safeInt(OUTBOUND_BASE_BATCH_SIZE, 24, 1);
const NORMALIZED_OUTBOUND_MIN_BATCH_SIZE = safeInt(OUTBOUND_MIN_BATCH_SIZE, 6, 1);
const NORMALIZED_OUTBOUND_MAX_BATCH_SIZE = Math.max(
  NORMALIZED_OUTBOUND_MIN_BATCH_SIZE,
  safeInt(OUTBOUND_MAX_BATCH_SIZE, 128, NORMALIZED_OUTBOUND_MIN_BATCH_SIZE),
);
const NORMALIZED_OUTBOUND_MAX_BUFFERED_BYTES = safeInt(OUTBOUND_MAX_BUFFERED_BYTES, 786_432, 1_024);
const NORMALIZED_OUTBOUND_MAX_QUEUE_ITEMS = safeInt(OUTBOUND_MAX_QUEUE_ITEMS, 2_048, 8);
const NORMALIZED_OUTBOUND_AIMD_RTT_WARN_MS = safeInt(OUTBOUND_AIMD_RTT_WARN_MS, 900, 50);
const NORMALIZED_OUTBOUND_AIMD_INCREASE_STEP = safeInt(OUTBOUND_AIMD_INCREASE_STEP, 1, 1);
const NORMALIZED_OUTBOUND_AIMD_DECREASE_FACTOR = Number.isFinite(OUTBOUND_AIMD_DECREASE_FACTOR)
  ? Math.min(0.95, Math.max(0.1, OUTBOUND_AIMD_DECREASE_FACTOR))
  : 0.7;
const NORMALIZED_ACK_RTT_RING_SIZE = safeInt(ACK_RTT_RING_SIZE, 512, 32);
const NORMALIZED_ACK_TRACKING_TTL_MS = safeInt(ACK_TRACKING_TTL_MS, 120_000, 5_000);
const NORMALIZED_ACK_SWEEP_INTERVAL_MS = safeInt(ACK_SWEEP_INTERVAL_MS, 5_000, 1_000);
const RECENT_ACK_TTL_MS = safeInt(
  Number(relayEnv.YUANIO_RELAY_RECENT_ACK_TTL_MS ?? 15_000),
  15_000,
  1_000,
);
const RECENT_ACK_MAX_PER_DEVICE = safeInt(
  Number(relayEnv.YUANIO_RELAY_RECENT_ACK_MAX_PER_DEVICE ?? 2_048),
  2_048,
  64,
);
const NORMALIZED_SESSION_IDLE_RECLAIM_MS = safeInt(SESSION_IDLE_RECLAIM_MS_RAW, 3 * 60_000, 5_000);
const NORMALIZED_SESSION_IDLE_SWEEP_INTERVAL_MS = safeInt(SESSION_IDLE_SWEEP_INTERVAL_MS_RAW, 30_000, 1_000);
const NORMALIZED_SESSION_STARTUP_RETRY_AFTER_MS = safeInt(SESSION_STARTUP_RETRY_AFTER_MS_RAW, 1_200, 100);

function summarizeAckRtt() {
  if (ackRttSamples.length === 0) {
    return { count: 0, p50: 0, p95: 0, max: 0, last: 0, pending: ackPending.size };
  }
  const sorted = [...ackRttSamples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: ackRttMaxMs,
    last: ackRttLastMs,
    pending: ackPending.size,
  };
}

function summarizeOutboundQueues() {
  let totalQueueItems = 0;
  let totalBufferedBytes = 0;
  let maxQueueItems = 0;
  let maxBufferedBytes = 0;
  let droppedTransient = 0;
  let slowDisconnects = 0;

  for (const state of outboundStates.values()) {
    totalQueueItems += state.queue.length;
    totalBufferedBytes += state.bufferedBytes;
    maxQueueItems = Math.max(maxQueueItems, state.queue.length);
    maxBufferedBytes = Math.max(maxBufferedBytes, state.bufferedBytes);
    droppedTransient += state.droppedTransient;
    slowDisconnects += state.slowDisconnects;
  }

  return {
    devices: outboundStates.size,
    totalQueueItems,
    totalBufferedBytes,
    maxQueueItems,
    maxBufferedBytes,
    droppedTransient,
    slowDisconnects,
    baseBatchSize: NORMALIZED_OUTBOUND_BASE_BATCH_SIZE,
    minBatchSize: NORMALIZED_OUTBOUND_MIN_BATCH_SIZE,
    maxBatchSize: NORMALIZED_OUTBOUND_MAX_BATCH_SIZE,
    flushDelayMs: NORMALIZED_OUTBOUND_FLUSH_DELAY_MS,
  };
}

function summarizeSessionRuntimeStates() {
  let activeSessions = 0;
  let warmingUpSessions = 0;
  let readySessions = 0;
  let idleSessions = 0;
  let activeRefs = 0;
  let activeDevices = 0;
  let startupInFlight = 0;
  let reclaimedSessions = 0;

  for (const state of sessionRuntimeStates.values()) {
    activeRefs += state.refs;
    activeDevices += state.deviceRefs.size;
    reclaimedSessions += state.reclaimCount;
    if (state.refs > 0) activeSessions += 1;
    if (state.startupPromise) startupInFlight += 1;
    if (state.phase === "warming_up") warmingUpSessions += 1;
    else if (state.phase === "ready") readySessions += 1;
    else idleSessions += 1;
  }

  const phase: "warming_up" | "ready" = warmingUpSessions > 0 ? "warming_up" : "ready";
  return {
    phase,
    trackedSessions: sessionRuntimeStates.size,
    activeSessions,
    warmingUpSessions,
    readySessions,
    idleSessions,
    activeRefs,
    activeDevices,
    startupInFlight,
    reclaimedSessions,
    retryAfterMs: phase === "warming_up" ? NORMALIZED_SESSION_STARTUP_RETRY_AFTER_MS : 0,
    idleReclaimMs: NORMALIZED_SESSION_IDLE_RECLAIM_MS,
    sweepIntervalMs: NORMALIZED_SESSION_IDLE_SWEEP_INTERVAL_MS,
  };
}

function buildRelayStateSnapshot() {
  const runtime = summarizeSessionRuntimeStates();
  return {
    status: runtime.phase,
    protocolVersion: PROTOCOL_VERSION,
    serverNowMs: Date.now(),
    retryAfterMs: runtime.retryAfterMs,
    runtime,
  };
}

function isTransientMessageType(type: string | undefined): boolean {
  if (!type) return false;
  return type.startsWith("pty_") || TRANSIENT_OUTBOUND_MESSAGE_TYPES.has(type);
}

function estimatePayloadBytes(data: unknown): number {
  if (data == null) return 0;
  if (typeof data === "string") return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.length;
  if (data instanceof Uint8Array) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  try {
    return Buffer.byteLength(JSON.stringify(data));
  } catch {
    return 256;
  }
}

function normalizeAckState(value: unknown): AckState {
  if (value === "working") return "working";
  if (value === "retry_after") return "retry_after";
  if (value === "terminal") return "terminal";
  return "ok";
}

function normalizeAckPayload(raw: any, source: string, sessionId: string): AckPayload | null {
  const messageId = typeof raw?.messageId === "string" ? raw.messageId : "";
  if (!messageId) return null;
  const state = normalizeAckState(raw?.state);
  const retryAfterMs = Number.isFinite(raw?.retryAfterMs)
    ? Math.max(0, Math.floor(raw.retryAfterMs))
    : undefined;
  const reason = typeof raw?.reason === "string" && raw.reason.length > 0
    ? raw.reason.slice(0, 240)
    : undefined;
  const at = Number.isFinite(raw?.at) ? Math.floor(raw.at) : Date.now();
  return {
    messageId,
    source,
    sessionId,
    state,
    retryAfterMs,
    reason,
    at,
  };
}

function deviceQueueKey(rk: string, deviceId: string): string {
  return `${rk}::${deviceId}`;
}

function ackTrackKey(messageId: string, targetDeviceId: string): string {
  return `${messageId}::${targetDeviceId}`;
}

function pruneRecentAcksForDevice(deviceId: string, now: number = Date.now()) {
  const map = recentAckByDevice.get(deviceId);
  if (!map) return;
  for (const [messageId, expiresAt] of map.entries()) {
    if (expiresAt <= now) map.delete(messageId);
  }
  if (map.size === 0) {
    recentAckByDevice.delete(deviceId);
    return;
  }
  if (map.size > RECENT_ACK_MAX_PER_DEVICE) {
    const entries = Array.from(map.entries()).sort((a, b) => a[1] - b[1]);
    const drop = map.size - RECENT_ACK_MAX_PER_DEVICE;
    for (let i = 0; i < drop; i++) {
      const key = entries[i]?.[0];
      if (key) map.delete(key);
    }
  }
}

function hasRecentAck(deviceId: string, messageId: string, now: number = Date.now()): boolean {
  if (!messageId) return false;
  const map = recentAckByDevice.get(deviceId);
  if (!map) return false;
  const expiresAt = map.get(messageId);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    map.delete(messageId);
    if (map.size === 0) recentAckByDevice.delete(deviceId);
    return false;
  }
  return true;
}

function rememberRecentAck(deviceId: string, messageId: string, now: number = Date.now()) {
  if (!messageId) return;
  let map = recentAckByDevice.get(deviceId);
  if (!map) {
    map = new Map<string, number>();
    recentAckByDevice.set(deviceId, map);
  }
  map.set(messageId, now + RECENT_ACK_TTL_MS);
  if (map.size > RECENT_ACK_MAX_PER_DEVICE) {
    pruneRecentAcksForDevice(deviceId, now);
  }
}

type PendingAckMark = {
  messageId: string;
  targetDeviceId: string;
};

const pendingAckMarks: PendingAckMark[] = [];
const pendingAckMarkKeys = new Set<string>();
let ackMarkFlushTimer: ReturnType<typeof setTimeout> | null = null;

function ackMarkKey(messageId: string, targetDeviceId: string): string {
  return `${messageId}::${targetDeviceId}`;
}

function flushPendingAckMarks() {
  if (ackMarkFlushTimer) {
    clearTimeout(ackMarkFlushTimer);
    ackMarkFlushTimer = null;
  }
  if (pendingAckMarks.length === 0) return;

  const batch = pendingAckMarks.splice(0, NORMALIZED_ACK_MARK_FLUSH_BATCH_SIZE);
  if (pendingAckMarks.length > 0) {
    ackMarkFlushTimer = setTimeout(flushPendingAckMarks, NORMALIZED_ACK_MARK_FLUSH_DELAY_MS);
    ackMarkFlushTimer.unref?.();
  }

  for (const row of batch) {
    pendingAckMarkKeys.delete(ackMarkKey(row.messageId, row.targetDeviceId));
    try {
      markDeliveryAcked(row.messageId, row.targetDeviceId);
    } catch (err) {
      console.warn(
        `[relay] markDeliveryAcked failed device=${row.targetDeviceId} message=${row.messageId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

function enqueueAckMark(messageId: string, targetDeviceId: string) {
  if (!messageId || !targetDeviceId) return;
  const key = ackMarkKey(messageId, targetDeviceId);
  if (pendingAckMarkKeys.has(key)) return;
  pendingAckMarkKeys.add(key);
  pendingAckMarks.push({ messageId, targetDeviceId });

  if (pendingAckMarks.length >= NORMALIZED_ACK_MARK_FLUSH_BATCH_SIZE) {
    flushPendingAckMarks();
    return;
  }
  if (ackMarkFlushTimer) return;
  ackMarkFlushTimer = setTimeout(flushPendingAckMarks, NORMALIZED_ACK_MARK_FLUSH_DELAY_MS);
  ackMarkFlushTimer.unref?.();
}

function ensureOutboundState(
  key: string,
  rk: string,
  namespace: string,
  sessionId: string,
  deviceId: string,
): OutboundState {
  const existing = outboundStates.get(key);
  if (existing) return existing;
  const state: OutboundState = {
    key,
    roomKey: rk,
    namespace,
    sessionId,
    deviceId,
    queue: [],
    bufferedBytes: 0,
    flushTimer: null,
    flushing: false,
    batchSize: Math.min(
      NORMALIZED_OUTBOUND_MAX_BATCH_SIZE,
      Math.max(NORMALIZED_OUTBOUND_MIN_BATCH_SIZE, NORMALIZED_OUTBOUND_BASE_BATCH_SIZE),
    ),
    droppedTransient: 0,
    slowDisconnects: 0,
  };
  outboundStates.set(key, state);
  return state;
}

function registerDeviceSocket(
  rk: string,
  namespace: string,
  sessionId: string,
  deviceId: string,
  socket: Socket,
) {
  const key = deviceQueueKey(rk, deviceId);
  let set = outboundDeviceSockets.get(key);
  if (!set) {
    set = new Set<Socket>();
    outboundDeviceSockets.set(key, set);
  }
  set.add(socket);
  ensureOutboundState(key, rk, namespace, sessionId, deviceId);
}

function unregisterDeviceSocket(rk: string, deviceId: string, socket: Socket): boolean {
  const key = deviceQueueKey(rk, deviceId);
  const set = outboundDeviceSockets.get(key);
  if (!set) return false;
  set.delete(socket);
  if (set.size > 0) return true;
  outboundDeviceSockets.delete(key);

  const state = outboundStates.get(key);
  if (state) {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    outboundStates.delete(key);
  }
  return false;
}

function scheduleOutboundFlush(state: OutboundState, immediate = false) {
  if (state.flushing || state.queue.length === 0) return;
  if (immediate && state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  if (state.flushTimer) return;
  const delay = immediate ? 0 : Math.max(0, NORMALIZED_OUTBOUND_FLUSH_DELAY_MS);
  state.flushTimer = setTimeout(() => flushOutboundQueue(state.key), delay);
  state.flushTimer.unref?.();
}

function updateBatchSizeByAimd(state: OutboundState): number {
  const shouldDecrease = eventLoopLagLastMs >= EVENT_LOOP_WARN_MS
    || ackRttLastMs >= NORMALIZED_OUTBOUND_AIMD_RTT_WARN_MS;
  if (shouldDecrease) {
    const decreased = Math.floor(state.batchSize * NORMALIZED_OUTBOUND_AIMD_DECREASE_FACTOR);
    state.batchSize = Math.max(NORMALIZED_OUTBOUND_MIN_BATCH_SIZE, decreased);
    return state.batchSize;
  }
  state.batchSize = Math.min(
    NORMALIZED_OUTBOUND_MAX_BATCH_SIZE,
    state.batchSize + NORMALIZED_OUTBOUND_AIMD_INCREASE_STEP,
  );
  return state.batchSize;
}

function dropOneTransientPacket(state: OutboundState): boolean {
  let index = -1;
  for (let i = state.queue.length - 1; i >= 0; i -= 1) {
    if (state.queue[i]?.transient) {
      index = i;
      break;
    }
  }
  if (index < 0) return false;
  const [dropped] = state.queue.splice(index, 1);
  if (dropped) {
    state.bufferedBytes = Math.max(0, state.bufferedBytes - dropped.bytes);
    state.droppedTransient += 1;
  }
  return true;
}

function disconnectSlowConsumer(state: OutboundState, reason: string) {
  const sockets = outboundDeviceSockets.get(state.key);
  state.queue = [];
  state.bufferedBytes = 0;
  state.slowDisconnects += 1;
  if (!sockets || sockets.size === 0) return;
  console.warn(
    `[relay] slow consumer disconnected device=${state.deviceId} ns=${state.namespace} session=${state.sessionId} reason=${reason}`,
  );
  for (const targetSocket of sockets) {
    targetSocket.disconnect(true);
  }
}

function resolveOutboundPriority(event: OutboundEventName, type: string | undefined): number {
  if (event === "ack" || type === "ack") return OUTBOUND_PRIORITY_ACK;
  if (type && type.startsWith("pty_")) return OUTBOUND_PRIORITY_PTY;
  return OUTBOUND_PRIORITY_NORMAL;
}

function emitPacketToSockets(sockets: Set<Socket>, packet: OutboundPacket) {
  for (const targetSocket of sockets) {
    if (targetSocket.connected) {
      targetSocket.emit(packet.event, packet.data);
    }
  }
}

function insertPacketByPriority(state: OutboundState, packet: OutboundPacket) {
  if (state.queue.length === 0) {
    state.queue.push(packet);
    return;
  }
  const tail = state.queue[state.queue.length - 1];
  if (tail && tail.priority >= packet.priority) {
    state.queue.push(packet);
    return;
  }
  let insertAt = state.queue.length;
  for (let i = state.queue.length - 1; i >= 0; i -= 1) {
    const current = state.queue[i];
    if (!current) continue;
    if (current.priority >= packet.priority) {
      insertAt = i + 1;
      break;
    }
    insertAt = i;
  }
  state.queue.splice(insertAt, 0, packet);
}

function enqueueOutboundPacket(
  namespace: string,
  sessionId: string,
  rk: string,
  targetDeviceId: string,
  packet: OutboundPacket,
) {
  const key = deviceQueueKey(rk, targetDeviceId);
  const sockets = outboundDeviceSockets.get(key);
  if (!sockets || sockets.size === 0) return;
  const state = ensureOutboundState(key, rk, namespace, sessionId, targetDeviceId);

  if (packet.direct) {
    emitPacketToSockets(sockets, packet);
    return;
  }

  // prompt 涓轰汉鏈轰氦浜掑叆鍙ｏ紝鍦ㄩ槦鍒楃┖闂叉椂鐩存帴鍙戦€侊紝鍑忓皯 flush 瀹氭椂鍣ㄦ姈鍔ㄣ€?
if (
    packet.event === "message"
    && packet.type === "prompt"
    && state.queue.length === 0
    && !state.flushing
    && !state.flushTimer
  ) {
    emitPacketToSockets(sockets, packet);
    return;
  }

  const willExceed = state.queue.length + 1 > NORMALIZED_OUTBOUND_MAX_QUEUE_ITEMS
    || state.bufferedBytes + packet.bytes > NORMALIZED_OUTBOUND_MAX_BUFFERED_BYTES;
  if (packet.transient && willExceed) {
    state.droppedTransient += 1;
    return;
  }

  insertPacketByPriority(state, packet);
  state.bufferedBytes += packet.bytes;

  while (
    (state.queue.length > NORMALIZED_OUTBOUND_MAX_QUEUE_ITEMS
      || state.bufferedBytes > NORMALIZED_OUTBOUND_MAX_BUFFERED_BYTES)
    && dropOneTransientPacket(state)
  ) {
    // 浼樺厛鍓旈櫎鐬椂娑堟伅锛岄伩鍏嶅叧閿秷鎭涪澶便€?
    }
if (
    state.queue.length > NORMALIZED_OUTBOUND_MAX_QUEUE_ITEMS
    || state.bufferedBytes > NORMALIZED_OUTBOUND_MAX_BUFFERED_BYTES
  ) {
    disconnectSlowConsumer(
      state,
      `queue=${state.queue.length}/${NORMALIZED_OUTBOUND_MAX_QUEUE_ITEMS},bytes=${state.bufferedBytes}/${NORMALIZED_OUTBOUND_MAX_BUFFERED_BYTES}`,
    );
    return;
  }

  const shouldImmediate = packet.priority > OUTBOUND_PRIORITY_NORMAL || state.queue.length >= state.batchSize;
  scheduleOutboundFlush(state, shouldImmediate);
}

function flushOutboundQueue(stateKey: string) {
  const state = outboundStates.get(stateKey);
  if (!state) return;
  state.flushTimer = null;
  if (state.flushing) return;
  state.flushing = true;

  const drain = () => {
    const current = outboundStates.get(stateKey);
    if (!current) return;
    const sockets = outboundDeviceSockets.get(stateKey);
    if (!sockets || sockets.size === 0) {
      current.queue = [];
      current.bufferedBytes = 0;
      current.flushing = false;
      return;
    }

    const batchSize = updateBatchSizeByAimd(current);
    let sent = 0;
    while (sent < batchSize && current.queue.length > 0) {
      const packet = current.queue.shift()!;
      current.bufferedBytes = Math.max(0, current.bufferedBytes - packet.bytes);
      emitPacketToSockets(sockets, packet);
      sent += 1;
    }

    if (current.queue.length > 0) {
      runSoon(drain);
      return;
    }

    current.flushing = false;
    if (current.queue.length > 0) {
      scheduleOutboundFlush(current);
    }
  };

  drain();
}

function getOnlinePeerDeviceIds(rk: string, sourceDeviceId: string): string[] {
  const devMap = onlineDevices.get(rk);
  if (!devMap || devMap.size === 0) return [];
  const result: string[] = [];
  for (const targetId of devMap.keys()) {
    if (targetId !== sourceDeviceId) result.push(targetId);
  }
  return result;
}

function resolveRealtimeTargets(
  rk: string,
  sessionId: string,
  sourceDeviceId: string,
  target: string,
): string[] {
  const devMap = onlineDevices.get(rk);
  if (!devMap || devMap.size === 0) return [];

  const devices = getSessionDevicesCached(sessionId);
  const resolved = resolveDeliveryTargets(target, sourceDeviceId, devices);
  const unique = new Set<string>();

  if (target !== "broadcast" && resolved.length === 0 && devMap.has(target) && target !== sourceDeviceId) {
    unique.add(target);
  } else {
    for (const deviceId of resolved) {
      if (devMap.has(deviceId)) unique.add(deviceId);
    }
  }

  if (target === "broadcast" && unique.size === 0) {
    for (const deviceId of devMap.keys()) {
      if (deviceId !== sourceDeviceId) unique.add(deviceId);
    }
  }

  return Array.from(unique);
}

function enqueueOutboundMessage(
  namespace: string,
  sessionId: string,
  rk: string,
  targetDeviceId: string,
  envelope: any,
) {
  const t = typeof envelope?.type === "string" ? envelope.type : undefined;
  enqueueOutboundPacket(namespace, sessionId, rk, targetDeviceId, {
    event: "message",
    data: envelope,
    bytes: estimatePayloadBytes(envelope),
    transient: isTransientMessageType(t),
    priority: resolveOutboundPriority("message", t),
    direct: !!t && t.startsWith("pty_"),
    type: t,
  });
}

function enqueueOutboundAck(
  namespace: string,
  sessionId: string,
  rk: string,
  targetDeviceId: string,
  ack: AckPayload,
) {
  enqueueOutboundPacket(namespace, sessionId, rk, targetDeviceId, {
    event: "ack",
    data: ack,
    bytes: estimatePayloadBytes(ack),
    transient: false,
    priority: resolveOutboundPriority("ack", "ack"),
    direct: true,
    type: "ack",
  });
}

function trackAckExpectations(messageId: string, targets: string[], recvAt: number) {
  const expiresAt = recvAt + NORMALIZED_ACK_TRACKING_TTL_MS;
  for (const target of targets) {
    ackPending.set(ackTrackKey(messageId, target), { recvAt, expiresAt });
  }
}

function observeAckRtt(messageId: string, sourceDeviceId: string, state: AckState) {
  if (state === "retry_after") return;
  const pending = ackPending.get(ackTrackKey(messageId, sourceDeviceId));
  if (!pending) return;
  const now = Date.now();
  const rtt = Math.max(0, now - pending.recvAt);
  ackRttLastMs = rtt;
  ackRttMaxMs = Math.max(ackRttMaxMs, rtt);
  ackRttSamples.push(rtt);
  if (ackRttSamples.length > NORMALIZED_ACK_RTT_RING_SIZE) {
    ackRttSamples.shift();
  }
  ackPending.delete(ackTrackKey(messageId, sourceDeviceId));
}

const ackSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, row] of ackPending.entries()) {
    if (row.expiresAt <= now) {
      ackPending.delete(key);
    }
  }
  for (const deviceId of recentAckByDevice.keys()) {
    pruneRecentAcksForDevice(deviceId, now);
  }
}, NORMALIZED_ACK_SWEEP_INTERVAL_MS);
ackSweepTimer.unref?.();

// 鍦ㄧ嚎璁惧杩借釜: roomKey(namespace:sessionId) -> Set<{deviceId, role}>
const onlineDevices = new Map<string, Map<string, string>>();

function getOrCreateSessionRuntimeState(rk: string, namespace: string, sessionId: string): SessionRuntimeState {
  const existing = sessionRuntimeStates.get(rk);
  if (existing) return existing;
  const now = Date.now();
  const state: SessionRuntimeState = {
    roomKey: rk,
    namespace,
    sessionId,
    refs: 0,
    deviceRefs: new Map<string, number>(),
    phase: "warming_up",
    lastActiveAtMs: now,
    warmupStartedAtMs: now,
    warmupReadyAtMs: 0,
    warmupCount: 0,
    reclaimCount: 0,
    startupPromise: null,
  };
  sessionRuntimeStates.set(rk, state);
  return state;
}

function ensureSessionRuntimeReady(state: SessionRuntimeState): Promise<void> {
  if (state.phase === "ready" && !state.startupPromise) {
    return Promise.resolve();
  }
  if (state.startupPromise) {
    return state.startupPromise;
  }

  state.phase = "warming_up";
  state.warmupStartedAtMs = Date.now();
  const warmupTask = Promise.resolve()
    .then(() => {
      // 杞婚噺棰勭儹锛氭彁鍓嶅姞杞戒細璇濊澶囧揩鐓э紝闄嶄綆棣栨娑堟伅璺敱鎶栧姩銆?
getSessionDevicesCached(state.sessionId);
    })
    .then(() => {
      state.warmupReadyAtMs = Date.now();
      state.warmupCount += 1;
      state.phase = state.refs > 0 ? "ready" : "idle";
    })
    .catch((error) => {
      state.phase = state.refs > 0 ? "warming_up" : "idle";
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[relay] session warmup failed ns=${state.namespace} session=${state.sessionId}: ${msg}`,
      );
      throw error;
    })
    .finally(() => {
      state.startupPromise = null;
    });

  state.startupPromise = warmupTask;
  return warmupTask;
}

function retainSessionRuntimeState(namespace: string, sessionId: string, deviceId: string): SessionRuntimeState {
  const rk = roomKey(namespace, sessionId);
  const state = getOrCreateSessionRuntimeState(rk, namespace, sessionId);
  const now = Date.now();
  const coldStart = state.refs === 0;
  state.refs += 1;
  state.lastActiveAtMs = now;
  const deviceRef = state.deviceRefs.get(deviceId) || 0;
  state.deviceRefs.set(deviceId, deviceRef + 1);
  if (coldStart) {
    state.phase = "warming_up";
  }
  void ensureSessionRuntimeReady(state).catch(() => {});
  return state;
}

function touchSessionRuntimeState(rk: string): void {
  const state = sessionRuntimeStates.get(rk);
  if (!state) return;
  state.lastActiveAtMs = Date.now();
}

function releaseSessionRuntimeState(rk: string, deviceId: string): void {
  const state = sessionRuntimeStates.get(rk);
  if (!state) return;
  state.lastActiveAtMs = Date.now();
  if (state.refs > 0) state.refs -= 1;
  const deviceRef = state.deviceRefs.get(deviceId) || 0;
  if (deviceRef <= 1) state.deviceRefs.delete(deviceId);
  else state.deviceRefs.set(deviceId, deviceRef - 1);
  if (state.refs === 0 && !state.startupPromise) {
    state.phase = "idle";
  }
}

function reclaimSessionRuntimeState(state: SessionRuntimeState): void {
  invalidateSessionDevicesCache(state.sessionId);
  onlineDevices.delete(state.roomKey);

  const devicePrefix = `${state.roomKey}::`;
  for (const [key, sockets] of outboundDeviceSockets.entries()) {
    if (!key.startsWith(devicePrefix)) continue;
    sockets.clear();
    outboundDeviceSockets.delete(key);
  }

  for (const [key, outboundState] of outboundStates.entries()) {
    if (outboundState.roomKey !== state.roomKey) continue;
    if (outboundState.flushTimer) clearTimeout(outboundState.flushTimer);
    outboundStates.delete(key);
  }

  for (const deviceId of state.deviceRefs.keys()) {
    recentAckByDevice.delete(deviceId);
  }
  state.deviceRefs.clear();
  state.reclaimCount += 1;
}

function emitServerState(
  socket: Socket,
  state: SessionRuntimeState,
  reason: "connect" | "warmup_ready" | "warmup_retry",
) {
  socket.emit("server_state", {
    reason,
    namespace: state.namespace,
    sessionId: state.sessionId,
    phase: state.phase,
    refs: state.refs,
    activeDevices: state.deviceRefs.size,
    retryAfterMs: state.phase === "warming_up" ? NORMALIZED_SESSION_STARTUP_RETRY_AFTER_MS : 0,
    serverNowMs: Date.now(),
  });
}

const sessionRuntimeSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [rk, state] of sessionRuntimeStates.entries()) {
    if (state.refs > 0) continue;
    if (state.startupPromise) continue;
    if (now - state.lastActiveAtMs < NORMALIZED_SESSION_IDLE_RECLAIM_MS) continue;
    reclaimSessionRuntimeState(state);
    sessionRuntimeStates.delete(rk);
    if (RELAY_LATENCY_LOG) {
      console.log(
        `[relay] reclaimed idle session ns=${state.namespace} session=${state.sessionId}`,
      );
    }
  }
}, NORMALIZED_SESSION_IDLE_SWEEP_INTERVAL_MS);
sessionRuntimeSweepTimer.unref?.();

function broadcastDeviceList(namespace: string, sessionId: string) {
  const rk = roomKey(namespace, sessionId);
  const devMap = onlineDevices.get(rk);
  const list = devMap ? Array.from(devMap.entries()).map(([id, role]) => ({ deviceId: id, role })) : [];
  relay.to(rk).emit("device_list", list);
}

relay.on("connection", (socket) => {
  const { deviceId, sessionId, role, namespace } = socket.data;
  const rk = roomKey(namespace, sessionId);
  const runtimeState = retainSessionRuntimeState(namespace, sessionId, deviceId);
  void ensureSessionRuntimeReady(runtimeState)
    .then(() => {
      if (socket.connected) emitServerState(socket, runtimeState, "warmup_ready");
    })
    .catch(() => {
      if (socket.connected) emitServerState(socket, runtimeState, "warmup_retry");
    });
  const ip = socket.handshake.headers["x-forwarded-for"] as string || socket.handshake.address;
  let highestInboundSeq = 0;
  logger.info({ role, namespace, event: "device_connected" }, "Device connected");

  logConnection(deviceId, sessionId, role, ip, "connect");
  upsertSessionMembership(deviceId, sessionId, role);
  invalidateSessionDevicesCache(sessionId);

  // 鑷姩鍔犲叆 session room
  socket.join(rk);

  // 杩借釜鍦ㄧ嚎璁惧
if (!onlineDevices.has(rk)) onlineDevices.set(rk, new Map());
  const roomOnline = onlineDevices.get(rk)!;
  const wasOnline = roomOnline.has(deviceId);
  roomOnline.set(deviceId, role);
  registerDeviceSocket(rk, namespace, sessionId, deviceId, socket);
  emitServerState(socket, runtimeState, "connect");

  // 閫氱煡鍚?session 鍏朵粬璁惧
if (!wasOnline) {
    socket.to(rk).emit("device:online", { deviceId, role });
  }
  broadcastDeviceList(namespace, sessionId);

  // 淇″皝璺敱锛氭寜鐩爣璁惧鍏ュ嚭绔欓槦鍒?+ 寮傛鎵归噺鍐欏叆 + 绂荤嚎鎺ㄩ€?
socket.on("message", (rawEnvelope: any) => {
    touchSessionRuntimeState(rk);
    const parsedEnvelope = EnvelopeSchema.safeParse(rawEnvelope);
    if (!parsedEnvelope.success) {
      if (RELAY_LATENCY_LOG) {
        const firstIssue = parsedEnvelope.error.issues[0];
        console.warn(`[relay] drop invalid envelope from ${deviceId}: ${firstIssue?.path?.join(".") || "unknown"} ${firstIssue?.message || ""}`);
      }
      return;
    }

    const envelope = parsedEnvelope.data as any;
    // source/sessionId 浠?socket 璁よ瘉缁撴灉涓哄噯锛岄伩鍏嶄吉閫犮€?
envelope.source = deviceId;
    envelope.sessionId = sessionId;

    if (envelope.seq > highestInboundSeq + 1) {
      console.warn(
        `[relay] inbound seq gap device=${deviceId} expected>${highestInboundSeq + 1} got=${envelope.seq}`,
      );
    }
    if (envelope.seq > highestInboundSeq) {
      highestInboundSeq = envelope.seq;
    }

    const t = envelope.type as string | undefined;
    const relayRecvAt = Date.now();
    if (t === "prompt") {
      const relayTs = relayRecvAt;
      envelope.relayTs = relayTs;
      if (RELAY_LATENCY_LOG) {
        if (typeof envelope.ts === "number") {
          console.log(`[relay] send鈫抮elay (${envelope.id}): ${relayTs - envelope.ts}ms`);
        } else {
          console.log(`[relay] relay_recv (${envelope.id}): ${relayTs}ms`);
        }
      }
    }
    const normalizedTarget = typeof envelope?.target === "string" && envelope.target.length > 0
      ? envelope.target
      : "broadcast";
    const realtimeTargets = resolveRealtimeTargets(rk, sessionId, deviceId, normalizedTarget);
    for (const targetDeviceId of realtimeTargets) {
      enqueueOutboundMessage(namespace, sessionId, rk, targetDeviceId, envelope);
    }

    // PTY 涓庨儴鍒嗛珮棰戞秷鎭负涓存椂鏁版嵁娴侊紝涓嶆寔涔呭寲銆?
const shouldPersist = !(t && (t.startsWith("pty_") || NON_PERSISTED_MESSAGE_TYPES.has(t)));
    if (shouldPersist) {
      enqueueWrite({
        id: envelope.id, session_id: sessionId, source: envelope.source,
        target: envelope.target, type: envelope.type, seq: envelope.seq,
        ts: envelope.ts, payload: envelope.payload,
      });
    }

    // ACK 蹇呴渶绫诲瀷锛氬啓鍏ヤ氦浠橀槦鍒楋紙鎸夌洰鏍囪澶囷級
if (ACK_REQUIRED_TYPES.includes(envelope.type)) {
      const devices = getSessionDevicesCached(sessionId);
      const targets = resolveDeliveryTargets(normalizedTarget, deviceId, devices);
      const rows = targets.map((targetId) => ({
        messageId: envelope.id,
        sessionId,
        sourceDeviceId: deviceId,
        targetDeviceId: targetId,
      }));
      enqueueDeliveriesWithPriority(rows, true);
      if (typeof envelope?.id === "string" && targets.length > 0) {
        trackAckExpectations(envelope.id, targets, relayRecvAt);
      }
    }

    // 绂荤嚎鎺ㄩ€侊細agent 鍙戞秷鎭椂妫€鏌?app 璁惧鏄惁鍦ㄧ嚎
if (role === "agent" && isFCMEnabled()) {
      const devMap = onlineDevices.get(rk);
      const appOnline = devMap
        ? Array.from(devMap.entries()).some(([, r]) => r === "app")
        : false;

      if (!appOnline) {
        if (!t) return;
        // 鏋勫缓鎺ㄩ€?payload
        let pushPayload = buildPushPayload(t, {
          sessionId,
          messageId: envelope.id,
        });
        // status 娑堟伅闇€妫€鏌ユ槸鍚﹀惈 error锛堥浂鐭ヨ瘑锛氬彧鐪?type 瀛楁锛?
if (!pushPayload && t === "status") {
          const looksLikeError = (typeof envelope?.status === "string" && envelope.status === "error")
            || (typeof envelope?.level === "string" && envelope.level === "error");
          if (looksLikeError) {
            pushPayload = buildErrorPushPayload({
              sessionId,
              messageId: envelope.id,
            });
          } else {
            pushPayload = null; // 淇濆畧绛栫暐锛氫笉鎺ㄩ€佹櫘閫?status
          }
        }
        if (pushPayload) {
          const tokens = getFcmTokensBySession(sessionId, "app");
          for (const tk of tokens) {
            sendPush(tk, pushPayload)
              .then((ok) => {
                if (!ok) {
                  const removed = clearFcmTokenByValue(tk);
                  if (removed > 0) {
                    console.log(`[relay] 娓呯悊澶辨晥 FCM token (${removed})`);
                  }
                }
              })
              .catch(() => {});
          }
        }
      }
    }
  });

  // FCM Token 娉ㄥ唽
socket.on("register_fcm_token", (data: { token?: string }) => {
    const fcmToken = normalizeFcmToken(data?.token);
    if (!fcmToken) return;
    registerFcmTokenForDevice(deviceId, role, fcmToken);
  });

  // ACK 杞彂锛氭帴鏀舵柟纭鍏抽敭娑堟伅
socket.on("ack", (ack: any) => {
    touchSessionRuntimeState(rk);
    const normalizedAck = normalizeAckPayload(ack, deviceId, sessionId);
    if (!normalizedAck) return;
    const shouldMarkDelivery = normalizedAck.state !== "retry_after"
      && !hasRecentAck(deviceId, normalizedAck.messageId);
    if (shouldMarkDelivery) {
      rememberRecentAck(deviceId, normalizedAck.messageId);
    }
    observeAckRtt(normalizedAck.messageId, deviceId, normalizedAck.state);

    // ACK 浼樺厛杞彂锛岄伩鍏嶈 DB 鍐欏叆闃诲锛涗氦浠樿惤搴撴敼涓哄紓姝ュ井鎵广€?
const targets = getOnlinePeerDeviceIds(rk, deviceId);
    for (const targetDeviceId of targets) {
      enqueueOutboundAck(namespace, sessionId, rk, targetDeviceId, normalizedAck);
    }
    if (shouldMarkDelivery) {
      enqueueAckMark(normalizedAck.messageId, deviceId);
    }
  });

  socket.on("disconnect", () => {
    logger.info({ role, event: "device_disconnected" }, "Device disconnected");
    logConnection(deviceId, sessionId, role, ip, "disconnect");
    invalidateSessionDevicesCache(sessionId);
    const stillOnline = unregisterDeviceSocket(rk, deviceId, socket);
    releaseSessionRuntimeState(rk, deviceId);
    if (stillOnline) return;
    // 绉婚櫎鍦ㄧ嚎璁惧
const devMap = onlineDevices.get(rk);
    if (devMap) {
      devMap.delete(deviceId);
      if (devMap.size === 0) onlineDevices.delete(rk);
    }
    socket.to(rk).emit("device:offline", { deviceId, role });
    broadcastDeviceList(namespace, sessionId);
  });
});

// 楠岃瘉鐜鍙橀噺
validateEnvironment();

// 鍒濆鍖?FCM 鎺ㄩ€?
initFCM();

server.listen(PORT, () => {
  console.log(`Relay server running on http://localhost:${PORT}`);
});


