import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import { getRequestListener } from "@hono/node-server";
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
import { initFCM, isFCMEnabled, sendPush, buildPushPayload, buildErrorPushPayload } from "./fcm";
import { generatePairingCode, generateDeviceId } from "./pair";
import { signToken, verifyToken, verifyTokenForRefresh } from "./jwt";
import { validateWsHelloFrame } from "./ws-handshake";
import { handleWsAckFrame, handleWsMessageFrame, shouldQueueAckByType } from "./ws-message-handler";
import { checkRateLimit, checkRateLimitWithWindow } from "./rate-limit";
import { loadRelayRuntimeEnv } from "@yuanio/shared";
import {
  DEFAULT_NAMESPACE,
  MAX_ENVELOPE_BINARY_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  WsFrameSchema,
  isProtocolCompatible,
  normalizeNamespace,
} from "@yuanio/shared";
import type { AckState } from "@yuanio/shared";

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

// HTTP + WebSocket 服务
const server = createServer(getRequestListener(app.fetch));

type WsConnectionState = {
  ws: WebSocket;
  deviceId: string;
  sessionId: string;
  role: string;
  namespace: string;
  protocolVersion: string;
};

const wsConnectionsByDevice = new Map<string, Set<WebSocket>>();
const wsConnectionBySocket = new Map<WebSocket, WsConnectionState>();
const WS_HANDSHAKE_TIMEOUT_MS = 10_000;

function registerWsConnection(state: WsConnectionState) {
  wsConnectionBySocket.set(state.ws, state);
  let set = wsConnectionsByDevice.get(state.deviceId);
  if (!set) {
    set = new Set<WebSocket>();
    wsConnectionsByDevice.set(state.deviceId, set);
  }
  set.add(state.ws);
}

function unregisterWsConnection(ws: WebSocket): WsConnectionState | null {
  const state = wsConnectionBySocket.get(ws);
  if (!state) return null;
  wsConnectionBySocket.delete(ws);
  const set = wsConnectionsByDevice.get(state.deviceId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) wsConnectionsByDevice.delete(state.deviceId);
  }
  return state;
}

function sendWsFrame(ws: WebSocket, frame: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(frame));
}

function sendWsFrameToDevice(deviceId: string, frame: unknown) {
  const set = wsConnectionsByDevice.get(deviceId);
  if (!set || set.size === 0) return;
  for (const socket of set) {
    sendWsFrame(socket, frame);
  }
}

function broadcastWsPresence(namespace: string, sessionId: string) {
  const rk = roomKey(namespace, sessionId);
  const devMap = onlineDevices.get(rk);
  if (!devMap || devMap.size === 0) return;
  const devices = Array.from(devMap.entries()).map(([id, role]) => ({
    id,
    role,
    sessionId,
  }));
  const frame = {
    type: "presence",
    data: { sessionId, devices },
  };
  for (const deviceId of devMap.keys()) {
    sendWsFrameToDevice(deviceId, frame);
  }
}

function closeWsWithError(ws: WebSocket, code: string, message: string) {
  sendWsFrame(ws, {
    type: "error",
    data: { code, message, retryable: false },
  });
  ws.close(1008, message.slice(0, 120));
}

function normalizeWsPayload(data: RawData): { raw: string; bytes: number } {
  if (typeof data === "string") return { raw: data, bytes: Buffer.byteLength(data) };
  if (data instanceof ArrayBuffer) {
    const buf = Buffer.from(data);
    return { raw: buf.toString("utf-8"), bytes: buf.byteLength };
  }
  if (Array.isArray(data)) {
    const buf = Buffer.concat(data);
    return { raw: buf.toString("utf-8"), bytes: buf.byteLength };
  }
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  return { raw: buf.toString("utf-8"), bytes: buf.byteLength };
}

const wsServer = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: RELAY_MAX_HTTP_BUFFER_BYTES,
});

server.on("upgrade", (request: IncomingMessage, socket, head) => {
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url ?? "/", `http://${host}`);
  if (url.pathname !== "/relay-ws") {
    socket.destroy();
    return;
  }
  wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
    wsServer.emit("connection", ws, request);
  });
});

wsServer.on("connection", (ws: WebSocket, request: IncomingMessage) => {
  let ready = false;
  let state: WsConnectionState | null = null;
  const ip = (request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    || request.socket.remoteAddress
    || null;
  const timer = setTimeout(() => {
    closeWsWithError(ws, "handshake_timeout", "hello timeout");
  }, WS_HANDSHAKE_TIMEOUT_MS);
  timer.unref?.();

  ws.on("message", async (data: RawData) => {
    const { raw, bytes } = normalizeWsPayload(data);
    if (bytes > RELAY_MAX_HTTP_BUFFER_BYTES) {
      closeWsWithError(ws, "payload_too_large", "payload too large");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      closeWsWithError(ws, "bad_request", "invalid json");
      return;
    }
    if (!ready) {
      const result = await validateWsHelloFrame({
        frame: parsed,
        requireProtocolVersion: REQUIRE_PROTOCOL_VERSION,
        serverVersion: PROTOCOL_VERSION,
        verifyToken,
      });
      if (!result.ok) {
        closeWsWithError(ws, "auth_failed", result.error);
        return;
      }
      ready = true;
      clearTimeout(timer);
      state = {
        ws,
        deviceId: result.payload.deviceId,
        sessionId: result.payload.sessionId,
        role: result.payload.role,
        namespace: result.namespace,
        protocolVersion: result.protocolVersion,
      };
      registerWsConnection(state);
      logger.info(
        { event: "ws_connected", role: state.role, namespace: state.namespace, deviceId: state.deviceId },
        "WS device connected",
      );
      logConnection(state.deviceId, state.sessionId, state.role, ip, "connect");
      upsertSessionMembership(state.deviceId, state.sessionId, state.role);
      invalidateSessionDevicesCache(state.sessionId);
      const rk = roomKey(state.namespace, state.sessionId);
      if (!onlineDevices.has(rk)) onlineDevices.set(rk, new Map());
      const roomOnline = onlineDevices.get(rk)!;
      const wasOnline = roomOnline.has(state.deviceId);
      roomOnline.set(state.deviceId, state.role);
      if (!wasOnline) {
        broadcastWsPresence(state.namespace, state.sessionId);
      }
      return;
    }

    if (!state) return;
    const activeState = state;
    const parsedFrame = WsFrameSchema.safeParse(parsed);
    if (!parsedFrame.success) {
      closeWsWithError(ws, "bad_request", "invalid ws frame");
      return;
    }
    const frame = parsedFrame.data;
    const rk = roomKey(activeState.namespace, activeState.sessionId);
    touchSessionRuntimeState(rk);
    if (frame.type === "message") {
      const envelope = frame.data as any;
      const relayRecvAt = Date.now();
      if (envelope?.type === "prompt") {
        const relayTs = relayRecvAt;
        envelope.relayTs = relayTs;
        if (RELAY_LATENCY_LOG) {
          if (typeof envelope.ts === "number") {
            console.log(`[relay] send→relay (${envelope.id}): ${relayTs - envelope.ts}ms`);
          } else {
            console.log(`[relay] relay_recv (${envelope.id}): ${relayTs}ms`);
          }
        }
      }

      const shouldPersist = (type?: string) => {
        if (!type) return true;
        if (type.startsWith("pty_")) return false;
        return !NON_PERSISTED_MESSAGE_TYPES.has(type);
      };

      try {
        handleWsMessageFrame({
          envelope,
          sender: activeState,
          deps: {
            shouldPersist,
            shouldQueueAck: shouldQueueAckByType,
            getSessionDevices: getSessionDevicesCached,
            sendToDevice: (deviceId, frame) => {
              const hasWs = wsConnectionsByDevice.has(deviceId);
              if (hasWs) {
                sendWsFrameToDevice(deviceId, frame);
              }
            },
            persistEnvelope: (env) => {
              enqueueWrite({
                id: env.id,
                session_id: activeState.sessionId,
                source: env.source,
                target: env.target,
                type: env.type,
                seq: env.seq,
                ts: env.ts,
                payload: env.payload,
              });
            },
            queueDeliveries: (rows) => enqueueDeliveriesWithPriority(rows, true),
            trackAckExpectations: (messageId, targets, recvAt) => {
              if (typeof messageId === "string" && targets.length > 0) {
                trackAckExpectations(messageId, targets, recvAt);
              }
            },
          },
        });
      } catch {
        closeWsWithError(ws, "bad_request", "invalid message");
      }
      return;
    }

    if (frame.type === "ack") {
      try {
        handleWsAckFrame({
          ack: frame.data as any,
          sender: activeState,
          deps: {
            getOnlinePeers: (sessionId, deviceId) => getOnlinePeerDeviceIds(rk, deviceId),
            sendToDevice: sendWsFrameToDevice,
            markAcked: (messageId, deviceId) => enqueueAckMark(messageId, deviceId),
            observeAck: (messageId, deviceId, state) => {
              if (!state) return;
              observeAckRtt(messageId, deviceId, state);
            },
          },
        });
      } catch {
        closeWsWithError(ws, "bad_request", "invalid ack");
      }
      return;
    }
  });

  ws.on("close", () => {
    if (!state) return;
    unregisterWsConnection(ws);
    logger.info(
      { event: "ws_disconnected", role: state.role, namespace: state.namespace, deviceId: state.deviceId },
      "WS device disconnected",
    );
    logConnection(state.deviceId, state.sessionId, state.role, ip, "disconnect");
    const rk = roomKey(state.namespace, state.sessionId);
    const devMap = onlineDevices.get(rk);
    if (devMap) {
      devMap.delete(state.deviceId);
      if (devMap.size === 0) onlineDevices.delete(rk);
    }
    broadcastWsPresence(state.namespace, state.sessionId);
  });

  ws.on("error", (err: Error) => {
    logger.warn({ event: "ws_error", message: err?.message }, "WS error");
  });
});

function roomKey(namespace: string, sessionId: string): string {
  return `${normalizeNamespace(namespace)}:${sessionId}`;
}

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

function getOnlinePeerDeviceIds(rk: string, sourceDeviceId: string): string[] {
  const devMap = onlineDevices.get(rk);
  if (!devMap || devMap.size === 0) return [];
  const result: string[] = [];
  for (const targetId of devMap.keys()) {
    if (targetId !== sourceDeviceId) result.push(targetId);
  }
  return result;
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

  for (const deviceId of state.deviceRefs.keys()) {
    recentAckByDevice.delete(deviceId);
  }
  state.deviceRefs.clear();
  state.reclaimCount += 1;
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

validateEnvironment();

// 鍒濆鍖?FCM 鎺ㄩ€?
initFCM();

server.listen(PORT, () => {
  console.log(`Relay server running on http://localhost:${PORT}`);
});


