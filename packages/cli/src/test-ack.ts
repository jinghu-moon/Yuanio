// 测试 ACK 机制：app 发送 prompt → agent 回 ACK → app 收到确认
import {
  generateKeyPair, deriveSharedKey,
  createEnvelope, MessageType, SeqCounter,
} from "@yuanio/shared";
import type { AckMessage } from "@yuanio/shared";
import {
  connectRelayWs,
  decodeWsData,
  normalizeEnvelopePayload,
  parseWsFrame,
  sendWsFrame,
  toWsAckFrame,
  toWsMessageFrame,
  waitForWsOpen,
} from "./relay-options";

const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 配对
const agentKp = generateKeyPair();
const createRes = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: agentKp.publicKey }),
});
const { pairingCode, sessionToken: agentToken, deviceId: agentDeviceId, sessionId } = await createRes.json();

const appKp = generateKeyPair();
const joinRes = await fetch(`${serverUrl}/api/v1/pair/join`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: pairingCode, publicKey: appKp.publicKey }),
});
const appData = await joinRes.json();
console.log(" 配对完成");

// 2. 双方连接 relay
const sharedKey = deriveSharedKey(appKp.secretKey, agentKp.publicKey);
const agentSharedKey = deriveSharedKey(agentKp.secretKey, appKp.publicKey);

const agentSocket = connectRelayWs(serverUrl, agentToken);
const appSocket = connectRelayWs(serverUrl, appData.sessionToken);

await Promise.all([
  waitForWsOpen(agentSocket, 8000),
  waitForWsOpen(appSocket, 8000),
]);
console.log(" 双方已连接");

// 3. Agent 监听消息并回 ACK
agentSocket.on("message", (data) => {
  const parsed = parseWsFrame(decodeWsData(data));
  if (!parsed.ok) return;
  const frame = parsed.frame as { type: string; data?: any };
  if (frame.type !== "message") return;
  const envelope = normalizeEnvelopePayload(frame.data);
  if (envelope.type === "prompt") {
    console.log("[agent] 收到 prompt, 回 ACK:", envelope.id);
    sendWsFrame(agentSocket, toWsAckFrame({
      messageId: envelope.id,
      source: agentDeviceId,
      sessionId,
    } as AckMessage));
  }
});

// 4. App 发送 prompt 并等待 ACK
const seq = new SeqCounter();
const envelope = createEnvelope(
  appData.deviceId, "broadcast", sessionId,
  MessageType.PROMPT, "测试ACK", sharedKey, seq.next(),
);

const ackReceived = new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("ACK 超时")), 10000);
  appSocket.on("message", (data) => {
    const parsed = parseWsFrame(decodeWsData(data));
    if (!parsed.ok) return;
    const frame = parsed.frame as { type: string; data?: any };
    if (frame.type !== "ack") return;
    const ack = frame.data as AckMessage;
    if (ack.messageId !== envelope.id) return;
    clearTimeout(timer);
    console.log(" App 收到 ACK:", ack.messageId);
    resolve();
  });
});

sendWsFrame(appSocket, toWsMessageFrame(envelope));
console.log("[app] 已发送 prompt:", envelope.id);

await ackReceived;

// 5. 清理
agentSocket.close();
appSocket.close();
console.log("\n ACK 机制测试通过");
process.exit(0);
