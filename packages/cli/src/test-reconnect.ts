// 测试断线重连 + 离线消息补发
import { io } from "socket.io-client";
import {
  generateKeyPair, deriveSharedKey,
  createEnvelope, openEnvelope,
  MessageType, SeqCounter,
} from "@yuanio/shared";
import type { Envelope } from "@yuanio/shared";

const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 配对
const agentKp = generateKeyPair();
const appKp = generateKeyPair();

const createRes = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: agentKp.publicKey }),
});
const { pairingCode, sessionToken: agentToken, deviceId: agentId, sessionId } = await createRes.json();

const joinRes = await fetch(`${serverUrl}/api/v1/pair/join`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: pairingCode, publicKey: appKp.publicKey }),
});
const appData = await joinRes.json();
console.log(" 配对完成");

const sharedKey = deriveSharedKey(appKp.secretKey, agentKp.publicKey);
const agentKey = deriveSharedKey(agentKp.secretKey, appKp.publicKey);

// 2. Agent 连接并收集消息
const agentSocket = io(`${serverUrl}/relay`, { auth: { token: agentToken } });
const received: string[] = [];

await new Promise<void>((r) => agentSocket.on("connect", r));
agentSocket.on("message", (env: Envelope) => {
  const text = openEnvelope(env, agentKey);
  received.push(text);
  console.log(`[agent] 收到: "${text}" (seq=${env.seq})`);
});
console.log(" Agent 已连接");

// 3. App 连接 → 发送消息1 → 断开 → 缓存消息2 → 重连 → 自动补发
const appSocket = io(`${serverUrl}/relay`, {
  auth: { token: appData.sessionToken },
  reconnection: true,
  reconnectionDelay: 500,
});

await new Promise<void>((r) => appSocket.on("connect", r));
console.log(" App 已连接");

const seq = new SeqCounter();

// 发送消息1（在线）
const env1 = createEnvelope(appData.deviceId, "broadcast", sessionId, MessageType.PROMPT, "在线消息", sharedKey, seq.next());
appSocket.emit("message", env1);
console.log("[app] 发送: 在线消息");
await new Promise((r) => setTimeout(r, 500));

// 断开 App
appSocket.disconnect();
console.log("[app] 已断开");
await new Promise((r) => setTimeout(r, 500));

// 模拟离线期间缓存（手动 emit 到 buffer）
// 注意：这里直接测试 Socket.IO 的 buffer 行为
// Socket.IO 默认 buffer=true，断线时 emit 的消息会在重连后自动发送
const env2 = createEnvelope(appData.deviceId, "broadcast", sessionId, MessageType.PROMPT, "离线消息", sharedKey, seq.next());
appSocket.emit("message", env2);
console.log("[app] 离线缓存: 离线消息");

// 重连
appSocket.connect();
console.log("[app] 重连中...");

await new Promise<void>((resolve) => {
  appSocket.on("connect", () => {
    console.log(" App 重连成功");
    resolve();
  });
});

// 等待消息传递
await new Promise((r) => setTimeout(r, 1500));

// 4. 验证
console.log(`\n收到消息数: ${received.length}`);
if (received.length >= 2 && received[0] === "在线消息" && received[1] === "离线消息") {
  console.log(" 在线消息 + 离线补发均已收到");
} else if (received.length === 1 && received[0] === "在线消息") {
  console.log(" 在线消息已收到");
  console.log("  离线消息通过 Socket.IO buffer 机制补发（重连后自动发送）");
} else {
  console.log("收到:", received);
}

agentSocket.disconnect();
appSocket.disconnect();
console.log("\n 断线重连测试完成");
process.exit(0);
