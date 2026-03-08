import { io } from "socket.io-client";
import {
  generateKeyPair, deriveSharedKey,
  createEnvelope, openEnvelope,
  MessageType, SeqCounter,
} from "@yuanio/shared";
import type { Envelope } from "@yuanio/shared";

const args = process.argv.slice(2);
const serverUrl = args.includes("--server")
  ? args[args.indexOf("--server") + 1]
  : "http://localhost:3000";
const pairingCode = args.includes("--pairing-code")
  ? args[args.indexOf("--pairing-code") + 1]
  : null;
const prompt = args.includes("--prompt")
  ? args[args.indexOf("--prompt") + 1]
  : "说你好";

if (!pairingCode) {
  console.error("Usage: --pairing-code XXX-XXX [--server url] [--prompt text]");
  process.exit(1);
}

async function main() {
  const kp = generateKeyPair();

  // 1. 加入配对
  console.log("[e2e] 加入配对:", pairingCode);
  const joinRes = await fetch(`${serverUrl}/api/v1/pair/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: pairingCode, publicKey: kp.publicKey }),
  });

  if (!joinRes.ok) {
    console.error("[e2e] 配对失败:", await joinRes.text());
    process.exit(1);
  }

  const { agentPublicKey, sessionToken, deviceId, sessionId } = await joinRes.json();
  console.log("[e2e] 配对成功, sessionId:", sessionId);

  // 2. DH 共享密钥
  const sharedKey = deriveSharedKey(kp.secretKey, agentPublicKey);

  // 3. 连接 /relay
  const socket = io(`${serverUrl}/relay`, {
    auth: { token: sessionToken },
  });

  const seq = new SeqCounter();
  let sent = false;
  const sendPrompt = () => {
    if (sent) return;
    sent = true;
    const envelope = createEnvelope(
      deviceId, "broadcast", sessionId,
      MessageType.PROMPT, prompt, sharedKey, seq.next(),
    );
    console.log("[e2e] 发送 prompt:", prompt);
    socket.emit("message", envelope);
  };

  socket.on("connect", () => {
    console.log("[e2e] 已连接 relay, 等待 agent 上线...");
    // 兜底：3秒后若 agent 已在房间则直接发
    setTimeout(sendPrompt, 3000);
  });

  socket.on("device:online", (info: any) => {
    if (info.role === "agent") {
      console.log("[e2e] agent 已上线");
      sendPrompt();
    }
  });

  // 5. 接收流式回复
  socket.on("message", (envelope: Envelope) => {
    if (envelope.type === MessageType.STREAM_END) {
      console.log("\n[e2e]  完成");
      socket.disconnect();
      process.exit(0);
    }

    if (envelope.type === MessageType.STREAM_CHUNK) {
      const text = openEnvelope(envelope, sharedKey);
      process.stdout.write(text);
    }
  });

  socket.on("connect_error", (err) => {
    console.error("[e2e] 连接错误:", err.message);
    process.exit(1);
  });

  // 超时退出
  setTimeout(() => {
    console.error("\n[e2e]  超时");
    process.exit(1);
  }, 120_000);
}

main().catch((err) => {
  console.error("[e2e] 错误:", err);
  process.exit(1);
});
