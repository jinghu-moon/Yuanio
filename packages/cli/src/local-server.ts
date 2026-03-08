/**
 * local-server.ts — 局域网直连 WS 服务器
 *
 * 使用 Bun.serve + WebSocket upgrade，零外部依赖。
 * 连接鉴权: WS 升级时校验 HMAC-SHA256 签名。
 *
 * HMAC 密钥从 ECDH 共享密钥独立派生（info="yuanio-local-hmac-v1"），
 * 不依赖 AES-GCM 密钥的 extractable 属性。
 */

import type { Envelope, BinaryEnvelope } from "@yuanio/shared";

// ── 类型 ──────────────────────────────────────────

export type ServerMode = "full" | "daemon";

export interface LocalServerOptions {
  port: number;
  mode: ServerMode;
  sessionId: string;
  /** 用于消息加解密的 AES-GCM 密钥 */
  sharedKey: CryptoKey;
  /** ECDH 私钥 (Base64 PKCS8) — 用于派生 HMAC 密钥 */
  secretKey: string;
  /** ECDH 对端公钥 (Base64 SPKI) — 用于派生 HMAC 密钥 */
  peerPublicKey: string;
  deviceId: string;
  onEnvelope: (envelope: Envelope | BinaryEnvelope, ws: ServerWebSocket) => void;
  onClientChange?: (count: number) => void;
}

export interface LocalServer {
  broadcast(envelope: Envelope | BinaryEnvelope): void;
  updateSession(sessionId: string, sharedKey: CryptoKey): void;
  stop(): void;
  readonly port: number;
  readonly clientCount: number;
  readonly authenticatedCount: number;
}

// Bun ServerWebSocket 类型别名
type ServerWebSocket = any;

// ── HMAC 密钥派生 ─────────────────────────────────

const HMAC_INFO = "yuanio-local-hmac-v1";
const AUTH_WINDOW_MS = 60_000; // 60s 时间窗口
const NONCE_CACHE_LIMIT = 200;

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * 从 ECDH 密钥对独立派生 HMAC-SHA256 密钥。
 * 使用 HKDF 派生，info 字段与 AES-GCM 密钥不同，确保密钥隔离。
 */
async function deriveHmacKey(secretKey: string, peerPublicKey: string, salt: string): Promise<CryptoKey> {
  const privBytes = base64ToBytes(secretKey);
  const pubBytes = base64ToBytes(peerPublicKey);

  const priv = await crypto.subtle.importKey(
    "pkcs8", toBufferSource(privBytes),
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
  );
  const pub = await crypto.subtle.importKey(
    "spki", toBufferSource(pubBytes),
    { name: "ECDH", namedCurve: "P-256" }, false, [],
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pub }, priv, 256,
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw", sharedSecret, "HKDF", false, ["deriveKey"],
  );

  const saltBytes = new TextEncoder().encode(salt);
  const infoBytes = new TextEncoder().encode(HMAC_INFO);

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toBufferSource(saltBytes), info: toBufferSource(infoBytes) },
    hkdfKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

async function hmacVerify(
  hmacKey: CryptoKey,
  deviceId: string,
  nonce: string,
  ts: string,
  sig: string,
): Promise<boolean> {
  const message = `${deviceId}${nonce}${ts}`;
  const msgBuf = new TextEncoder().encode(message);
  const sigBuf = hexToBytes(sig);
  return crypto.subtle.verify("HMAC", hmacKey, sigBuf as unknown as ArrayBuffer, msgBuf as unknown as ArrayBuffer);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

const recentNonces = new Map<string, Map<string, number>>();

function registerNonce(deviceId: string, nonce: string): boolean {
  const now = Date.now();
  const cutoff = now - AUTH_WINDOW_MS;
  const map = recentNonces.get(deviceId) ?? new Map<string, number>();
  for (const [key, ts] of map.entries()) {
    if (ts < cutoff) map.delete(key);
  }
  if (map.has(nonce)) return false;
  map.set(nonce, now);
  if (map.size > NONCE_CACHE_LIMIT) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, ts] of map.entries()) {
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestKey = key;
      }
    }
    if (oldestKey) map.delete(oldestKey);
  }
  recentNonces.set(deviceId, map);
  return true;
}

export const __test__ = {
  registerNonce,
  clearNonces: () => {
    recentNonces.clear();
  },
  getNonceCount: (deviceId: string) => recentNonces.get(deviceId)?.size ?? 0,
  authWindowMs: AUTH_WINDOW_MS,
};

// ── 服务器实现 ─────────────────────────────────────

interface ClientData {
  authenticated: boolean;
  deviceId?: string;
}

export function startLocalServer(options: LocalServerOptions): LocalServer {
  const {
    port,
    mode,
    deviceId: selfDeviceId,
    secretKey,
    peerPublicKey,
    onEnvelope,
    onClientChange,
  } = options;

  let currentSessionId = options.sessionId;
  let currentSharedKey = options.sharedKey;
  let hmacKeyPromise = deriveHmacKey(secretKey, peerPublicKey, currentSessionId);

  const clients = new Set<ServerWebSocket>();
  const clientData = new WeakMap<ServerWebSocket, ClientData>();
  let stopped = false;

  // Draining 旧会话的连接
  let drainingClients = new Set<ServerWebSocket>();

  const server = Bun.serve<ClientData>({
    port,
    fetch: async (req, server) => {
      const url = new URL(req.url);

      // 健康检查端点
      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          mode,
          clients: clients.size,
          authenticated: countAuthenticated(),
        });
      }

      // WS 升级
      if (url.pathname === "/ws") {
        const peerDeviceId = url.searchParams.get("deviceId");
        const nonce = url.searchParams.get("nonce");
        const ts = url.searchParams.get("ts");
        const sig = url.searchParams.get("sig");

        // 参数完整性检查
        if (!peerDeviceId || !nonce || !ts || !sig) {
          return new Response("Missing auth params", { status: 403 });
        }

        // 时间窗口检查
        const tsNum = parseInt(ts, 10);
        if (isNaN(tsNum) || Math.abs(Date.now() - tsNum) > AUTH_WINDOW_MS) {
          return new Response("Timestamp out of range", { status: 403 });
        }

        // HMAC 校验
        try {
          const hmacKey = await hmacKeyPromise;
          const valid = await hmacVerify(hmacKey, peerDeviceId, nonce, ts, sig);
          if (!valid) {
            return new Response("Invalid signature", { status: 403 });
          }
          if (!registerNonce(peerDeviceId, nonce)) {
            return new Response("Replay detected", { status: 403 });
          }
        } catch {
          return new Response("Auth error", { status: 403 });
        }

        // 升级成功
        const upgraded = server.upgrade(req, {
          data: { authenticated: true, deviceId: peerDeviceId },
        });
        if (!upgraded) {
          return new Response("Upgrade failed", { status: 500 });
        }
        return undefined;
      }

      return new Response("Not Found", { status: 404 });
    },

    websocket: {
      open(ws: ServerWebSocket) {
        const data = ws.data;
        clients.add(ws);
        clientData.set(ws, data);
        console.log(`[local-server] 客户端已连接: ${data.deviceId} (共${clients.size})`);
        onClientChange?.(clients.size);
      },

      message(ws: any, message: string | ArrayBuffer | Buffer) {
        const data = clientData.get(ws);
        if (!data?.authenticated) {
          ws.close(1008, "not authenticated");
          return;
        }

        try {
          const text = typeof message === "string" ? message : new TextDecoder().decode(message);
          const envelope = JSON.parse(text) as Envelope | BinaryEnvelope;

          // 标记来源通道
          (envelope as any)._via = "local";

          // daemon 模式下拒绝 prompt
          if (mode === "daemon" && envelope.type === "prompt") {
            ws.send(JSON.stringify({
              type: "error",
              message: "daemon 模式不处理 prompt",
            }));
            return;
          }

          // 发送 ACK（仅通过原 WS 连接，不广播）
          if (envelope.id && envelope.type === "prompt") {
            ws.send(JSON.stringify({
              type: "ack",
              payload: { messageId: envelope.id, receivedAt: Date.now() },
            }));
          }

          onEnvelope(envelope, ws);
        } catch (e: any) {
          console.error("[local-server] 消息解析失败:", e?.message || e);
        }
      },

      close(ws: ServerWebSocket) {
        clients.delete(ws);
        drainingClients.delete(ws);
        console.log(`[local-server] 客户端断开 (共${clients.size})`);
        onClientChange?.(clients.size);
      },

      drain(_ws: ServerWebSocket) {
        // Bun 在 backpressure 缓解时调用
      },
    },
  });

  function countAuthenticated(): number {
    let count = 0;
    for (const ws of clients) {
      const data = clientData.get(ws);
      if (data?.authenticated) count++;
    }
    return count;
  }

  function broadcast(envelope: Envelope | BinaryEnvelope): void {
    if (stopped || clients.size === 0) return;
    const data = JSON.stringify(envelope);
    for (const ws of clients) {
      try {
        const sent = ws.send(data);
        // Bun: send 返回 number, 0 = backpressure
        if (sent === 0) {
          console.warn("[local-server] backpressure，关闭连接");
          ws.close(1008, "backpressure");
          clients.delete(ws);
          drainingClients.delete(ws);
        }
      } catch {
        clients.delete(ws);
        drainingClients.delete(ws);
      }
    }
  }

  function updateSession(newSessionId: string, newSharedKey: CryptoKey): void {
    // 1. 标记旧连接为 draining
    drainingClients = new Set(clients);

    // 2. 向旧连接发送 session_mismatch 通知
    const notice = JSON.stringify({
      type: "session_mismatch",
      payload: { newSessionId, message: "请使用新会话重新连接" },
    });
    for (const ws of drainingClients) {
      try { ws.send(notice); } catch {}
    }

    // 3. 500ms 后关闭旧连接
    setTimeout(() => {
      for (const ws of drainingClients) {
        try { ws.close(1000, "session switched"); } catch {}
        clients.delete(ws);
      }
      drainingClients.clear();
      onClientChange?.(clients.size);
    }, 500);

    // 4. 更新当前 session
    currentSessionId = newSessionId;
    currentSharedKey = newSharedKey;
    hmacKeyPromise = deriveHmacKey(secretKey, peerPublicKey, newSessionId);
    recentNonces.clear();

    console.log(`[local-server] 会话已切换: ${newSessionId.slice(0, 8)}...`);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    for (const ws of clients) {
      try { ws.close(1001, "server stopping"); } catch {}
    }
    clients.clear();
    drainingClients.clear();
    server.stop();
    console.log("[local-server] 已停止");
  }

  console.log(`[local-server] 已启动 port=${port} mode=${mode}`);

  return {
    broadcast,
    updateSession,
    stop,
    get port() { return port; },
    get clientCount() { return clients.size; },
    get authenticatedCount() { return countAuthenticated(); },
  };
}
