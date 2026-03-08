import {
  createEnvelopeWeb,
  DEFAULT_E2EE_INFO,
  deriveAesGcmKey,
  MessageType,
  openEnvelopeWeb,
  SeqCounter,
} from "@yuanio/shared";
import { loadKeys } from "../keystore";
import { RelayClient } from "../relay-client";
import type { Envelope, BinaryEnvelope } from "@yuanio/shared";

interface AgentCommandOptions {
  serverUrl: string;
  namespace: string;
}

interface RuntimeContext {
  serverUrl: string;
  sessionId: string;
  deviceId: string;
  sessionToken: string;
  sharedKey: CryptoKey;
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function loadRuntimeContext(serverUrlOverride?: string): Promise<RuntimeContext> {
  const keys = loadKeys();
  if (!keys) {
    throw new Error("未检测到本地密钥，请先执行 --pair");
  }
  if (keys.cryptoVersion !== "webcrypto") {
    throw new Error("仅支持 webcrypto 密钥，请重新配对");
  }
  const sharedKey = await deriveAesGcmKey({
    privateKey: keys.secretKey,
    publicKey: keys.peerPublicKey,
    salt: keys.sessionId,
    info: DEFAULT_E2EE_INFO,
  });
  return {
    serverUrl: serverUrlOverride || keys.serverUrl,
    sessionId: keys.sessionId,
    deviceId: keys.deviceId,
    sessionToken: keys.sessionToken,
    sharedKey,
  };
}

async function waitRelayConnected(relay: RelayClient, timeoutMs: number): Promise<void> {
  if (relay.connected) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("relay 连接超时")), timeoutMs);
    relay.onConnectionChange((connected) => {
      if (!connected) return;
      clearTimeout(timer);
      resolve();
    });
  });
}

function printUsage(): void {
  console.log([
    "用法:",
    "  yuanio agent list [--server URL]",
    "  yuanio agent history [--session <id>] [--limit <n>] [--server URL]",
    "  yuanio agent send --prompt \"...\" [--target <device|broadcast>] [--wait] [--timeout <sec>] [--server URL]",
    "  yuanio agent stop [--server URL]",
    "  yuanio agent wait [--timeout <sec>] [--server URL]",
  ].join("\n"));
}

async function listSessions(ctx: RuntimeContext): Promise<void> {
  const res = await fetch(`${ctx.serverUrl}/api/v1/sessions`, {
    headers: { Authorization: `Bearer ${ctx.sessionToken}` },
  });
  if (!res.ok) throw new Error(`拉取会话失败: HTTP ${res.status}`);
  const payload = await res.json() as {
    currentSessionId?: string;
    sessions?: Array<{
      sessionId: string;
      role: string;
      onlineCount: number;
      hasAgentOnline: boolean;
      hasAppOnline: boolean;
    }>;
  };
  const sessions = payload.sessions || [];
  if (sessions.length === 0) {
    console.log("暂无会话");
    return;
  }
  console.log(`当前会话: ${payload.currentSessionId || "-"}`);
  for (const s of sessions) {
    const mark = s.sessionId === payload.currentSessionId ? "*" : " ";
    console.log(
      `${mark} ${s.sessionId} role=${s.role} online=${s.onlineCount} agent=${s.hasAgentOnline ? "Y" : "N"} app=${s.hasAppOnline ? "Y" : "N"}`,
    );
  }
}

async function history(ctx: RuntimeContext, args: string[]): Promise<void> {
  const sessionId = getFlag(args, "--session") || ctx.sessionId;
  const limit = Math.max(1, Math.min(500, Number(getFlag(args, "--limit") || "50")));
  const res = await fetch(`${ctx.serverUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`, {
    headers: { Authorization: `Bearer ${ctx.sessionToken}` },
  });
  if (!res.ok) throw new Error(`读取历史失败: HTTP ${res.status}`);
  const payload = await res.json() as { messages?: Record<string, unknown>[] };
  const rows = payload.messages || [];
  for (const row of rows) {
    const env = row as unknown as Envelope;
    try {
      const plain = await openEnvelopeWeb(env, ctx.sharedKey);
      const time = new Date(env.ts).toLocaleTimeString();
      const text = plain.replace(/\r?\n/g, "\\n");
      console.log(`${time} [${env.type}] ${text.slice(0, 220)}`);
    } catch {
      const time = new Date(env.ts).toLocaleTimeString();
      console.log(`${time} [${env.type}] <decrypt_error>`);
    }
  }
}

async function waitForStreamEnd(
  relay: RelayClient,
  sharedKey: CryptoKey,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待超时")), timeoutMs);
    relay.onMessage(async (envelope: Envelope | BinaryEnvelope) => {
      if (typeof (envelope as any)?.payload !== "string") return;
      const env = envelope as Envelope;
      try {
        const plain = await openEnvelopeWeb(env, sharedKey);
        if (env.type === MessageType.STREAM_CHUNK) {
          process.stdout.write(plain);
          return;
        }
        if (env.type === MessageType.STREAM_END) {
          clearTimeout(timer);
          resolve();
        }
      } catch {
        // ignore decrypt errors from other sessions
      }
    });
  });
}

async function sendPrompt(ctx: RuntimeContext, args: string[]): Promise<void> {
  const prompt = getFlag(args, "--prompt") || args.join(" ").trim();
  if (!prompt) throw new Error("缺少 prompt，请使用 --prompt \"...\"");
  const target = getFlag(args, "--target") || "broadcast";
  const timeoutSec = Number(getFlag(args, "--timeout") || "120");
  const wait = hasFlag(args, "--wait");

  const relay = new RelayClient(ctx.serverUrl, ctx.sessionToken);
  const seq = new SeqCounter();
  try {
    await waitRelayConnected(relay, 8000);
    const env = await createEnvelopeWeb(
      ctx.deviceId,
      target,
      ctx.sessionId,
      MessageType.PROMPT,
      prompt,
      ctx.sharedKey,
      seq.next(),
    );
    relay.send(env);
    console.log(`已发送 prompt -> ${target}`);
    if (wait) {
      await waitForStreamEnd(relay, ctx.sharedKey, Math.max(1, timeoutSec) * 1000);
      console.log("\n任务结束");
    }
  } finally {
    relay.disconnect();
  }
}

async function sendCancel(ctx: RuntimeContext): Promise<void> {
  const relay = new RelayClient(ctx.serverUrl, ctx.sessionToken);
  const seq = new SeqCounter();
  try {
    await waitRelayConnected(relay, 8000);
    const env = await createEnvelopeWeb(
      ctx.deviceId,
      "broadcast",
      ctx.sessionId,
      MessageType.CANCEL,
      JSON.stringify({ reason: "manual stop" }),
      ctx.sharedKey,
      seq.next(),
    );
    relay.send(env);
    console.log("已发送取消请求");
  } finally {
    relay.disconnect();
  }
}

async function waitOnly(ctx: RuntimeContext, args: string[]): Promise<void> {
  const timeoutSec = Number(getFlag(args, "--timeout") || "180");
  const relay = new RelayClient(ctx.serverUrl, ctx.sessionToken);
  try {
    await waitRelayConnected(relay, 8000);
    await waitForStreamEnd(relay, ctx.sharedKey, Math.max(1, timeoutSec) * 1000);
    console.log("\n任务结束");
  } finally {
    relay.disconnect();
  }
}

export async function runAgentCommand(args: string[], options: AgentCommandOptions): Promise<void> {
  const [sub, ...rest] = args;
  if (!sub || sub === "-h" || sub === "--help") {
    printUsage();
    return;
  }
  const serverOverride = getFlag(rest, "--server") || options.serverUrl;
  const ctx = await loadRuntimeContext(serverOverride);

  switch (sub) {
    case "list":
      await listSessions(ctx);
      return;
    case "history":
      await history(ctx, rest);
      return;
    case "send":
      await sendPrompt(ctx, rest);
      return;
    case "stop":
      await sendCancel(ctx);
      return;
    case "wait":
      await waitOnly(ctx, rest);
      return;
    default:
      printUsage();
      throw new Error(`未知子命令: ${sub}`);
  }
}
