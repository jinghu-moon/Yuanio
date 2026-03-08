// 测试 ACK 机制：app 发送 prompt → agent 回 ACK → app 收到确认
import { io } from "socket.io-client";
import {
  generateKeyPair, deriveSharedKey,
  createEnvelope, MessageType, SeqCounter,
} from "@yuanio/shared";
import type { AckMessage } from "@yuanio/shared";

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

const agentSocket = io(`${serverUrl}/relay`, { auth: { token: agentToken } });
const appSocket = io(`${serverUrl}/relay`, { auth: { token: appData.sessionToken } });

await Promise.all([
  new Promise<void>((r) => agentSocket.on("connect", r)),
  new Promise<void>((r) => appSocket.on("connect", r)),
]);
console.log(" 双方已连接");

// 3. Agent 监听消息并回 ACK
agentSocket.on("message", (envelope: any) => {
  if (envelope.type === "prompt") {
    console.log("[agent] 收到 prompt, 回 ACK:", envelope.id);
    agentSocket.emit("ack", {
      messageId: envelope.id,
      source: agentDeviceId,
      sessionId,
    } as AckMessage);
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
  appSocket.on("ack", (ack: AckMessage) => {
    if (ack.messageId === envelope.id) {
      clearTimeout(timer);
      console.log(" App 收到 ACK:", ack.messageId);
      resolve();
    }
  });
});

appSocket.emit("message", envelope);
console.log("[app] 已发送 prompt:", envelope.id);

await ackReceived;

// 5. 清理
agentSocket.disconnect();
appSocket.disconnect();
console.log("\n ACK 机制测试通过");
process.exit(0);
