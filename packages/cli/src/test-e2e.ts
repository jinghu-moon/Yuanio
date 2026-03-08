import { io } from "socket.io-client";
import {
  DEFAULT_E2EE_INFO,
  MessageType,
  PROTOCOL_VERSION,
  SeqCounter,
  createEnvelopeWeb,
  deriveAesGcmKey,
  generateWebKeyPair,
  openEnvelopeWeb,
  type AckMessage,
  type Envelope,
} from "@yuanio/shared";
import { createRelaySocketOptions } from "./relay-options";

interface PairJoinResponse {
  agentPublicKey: string;
  sessionToken: string;
  deviceId: string;
  sessionId: string;
  protocolVersion?: string;
}

const args = process.argv.slice(2);
const serverUrl = args.includes("--server")
  ? args[args.indexOf("--server") + 1]
  : "http://localhost:3000";
const pairingCode = args.includes("--pairing-code")
  ? args[args.indexOf("--pairing-code") + 1]
  : null;
const prompt = args.includes("--prompt")
  ? args[args.indexOf("--prompt") + 1]
  : "say hello";

if (!pairingCode) {
  console.error("Usage: --pairing-code XXX-XXX [--server url] [--prompt text]");
  process.exit(1);
}

async function main() {
  const keyPair = await generateWebKeyPair();

  console.log("[e2e] 加入配对:", pairingCode);
  const joinRes = await fetch(`${serverUrl}/api/v1/pair/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-yuanio-protocol-version": PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      code: pairingCode,
      publicKey: keyPair.publicKey,
      protocolVersion: PROTOCOL_VERSION,
    }),
  });

  if (!joinRes.ok) {
    console.error("[e2e] 配对失败:", await joinRes.text());
    process.exit(1);
  }

  const { agentPublicKey, sessionToken, deviceId, sessionId } = await joinRes.json() as PairJoinResponse;
  console.log("[e2e] 配对成功, sessionId:", sessionId);

  const sharedKey = await deriveAesGcmKey({
    privateKey: keyPair.privateKey,
    publicKey: agentPublicKey,
    salt: sessionId,
    info: DEFAULT_E2EE_INFO,
  });

  const socket = io(`${serverUrl}/relay`, createRelaySocketOptions(sessionToken));

  const seq = new SeqCounter();
  let sent = false;
  let promptMessageId: string | null = null;

  const sendPrompt = async () => {
    if (sent) return;
    sent = true;
    const envelope = await createEnvelopeWeb(
      deviceId,
      "broadcast",
      sessionId,
      MessageType.PROMPT,
      prompt,
      sharedKey,
      seq.next(),
    );
    promptMessageId = envelope.id;
    console.log("[e2e] 发送 prompt:", prompt);
    socket.emit("message", envelope);
  };

  socket.on("connect", () => {
    console.log("[e2e] 已连接 relay, 等待 agent 上线...");
    setTimeout(() => {
      void sendPrompt();
    }, 3000);
  });

  socket.on("device:online", (info: { role?: string }) => {
    if (info?.role === "agent") {
      console.log("[e2e] agent 已上线");
      void sendPrompt();
    }
  });

  socket.on("ack", (ack: AckMessage & { reason?: string }) => {
    if (!promptMessageId || ack.messageId !== promptMessageId) return;
    if (ack.state === "terminal") {
      console.error("[e2e] agent 终止:", ack.reason || "unknown");
      socket.disconnect();
      process.exit(1);
    }
  });

  socket.on("message", (envelope: Envelope) => {
    void (async () => {
      if (envelope.type === MessageType.STREAM_END) {
        console.log("\n[e2e] 完成");
        socket.disconnect();
        process.exit(0);
      }

      if (envelope.type === MessageType.STREAM_CHUNK) {
        const text = await openEnvelopeWeb(envelope, sharedKey);
        process.stdout.write(text);
      }
    })().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[e2e] 解密失败:", message);
      socket.disconnect();
      process.exit(1);
    });
  });

  socket.on("connect_error", (err) => {
    console.error("[e2e] 连接错误:", err.message);
    process.exit(1);
  });

  setTimeout(() => {
    console.error("\n[e2e] 超时");
    process.exit(1);
  }, 120_000);
}

main().catch((err) => {
  console.error("[e2e] 错误:", err);
  process.exit(1);
});
