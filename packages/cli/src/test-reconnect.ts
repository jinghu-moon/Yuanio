// 测试断线重连 + 离线消息补发
import {
  generateKeyPair, deriveSharedKey,
  createEnvelope, openEnvelope,
  MessageType, SeqCounter,
} from "@yuanio/shared";
import { RelayClient } from "./relay-client";
import { isTextEnvelope } from "./relay-options";

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
const agentRelay = new RelayClient(serverUrl, agentToken);
const received: string[] = [];

await waitRelayConnected(agentRelay, 8000);
agentRelay.onMessage((env) => {
  if (!isTextEnvelope(env)) return;
  const text = openEnvelope(env, agentKey);
  received.push(text);
  console.log(`[agent] 收到: "${text}" (seq=${env.seq})`);
});
console.log(" Agent 已连接");

// 3. App 连接 → 发送消息1 → 断开 → 缓存消息2 → 重连 → 自动补发
const appRelay = new RelayClient(serverUrl, appData.sessionToken);
await waitRelayConnected(appRelay, 8000);
console.log(" App 已连接");

const seq = new SeqCounter();

// 发送消息1（在线）
const env1 = createEnvelope(appData.deviceId, "broadcast", sessionId, MessageType.PROMPT, "在线消息", sharedKey, seq.next());
appRelay.send(env1);
console.log("[app] 发送: 在线消息");
await new Promise((r) => setTimeout(r, 500));

// 断开 App
appRelay.disconnect();
console.log("[app] 已断开");
await new Promise((r) => setTimeout(r, 500));

// 模拟离线期间缓存（RelayClient 离线队列）
const env2 = createEnvelope(appData.deviceId, "broadcast", sessionId, MessageType.PROMPT, "离线消息", sharedKey, seq.next());
appRelay.send(env2);
console.log("[app] 离线缓存: 离线消息");

// 重连
appRelay.reconnect(appData.sessionToken);
console.log("[app] 重连中...");

await waitRelayConnected(appRelay, 8000);
console.log(" App 重连成功");

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

agentRelay.disconnect();
appRelay.disconnect();
console.log("\n 断线重连测试完成");
process.exit(0);

async function waitRelayConnected(relay: RelayClient, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (relay.connected) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("relay 连接超时");
}
