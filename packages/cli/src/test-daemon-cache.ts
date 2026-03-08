// 测试 daemon 消息缓存：配对 → 启动 daemon → app 发消息 → 验证缓存
import { generateKeyPair, deriveSharedKey, createEnvelope, MessageType, SeqCounter } from "@yuanio/shared";
import { saveKeys } from "./keystore";
import { daemonStart, daemonStop, readState } from "./daemon";
import { io } from "socket.io-client";

const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 配对
const agentKp = generateKeyPair();
const createRes = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: agentKp.publicKey }),
});
const { pairingCode, sessionToken, deviceId, sessionId } = await createRes.json();

const appKp = generateKeyPair();
const joinRes = await fetch(`${serverUrl}/api/v1/pair/join`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: pairingCode, publicKey: appKp.publicKey }),
});
const appData = await joinRes.json();

// 保存 agent 密钥供 daemon 使用
saveKeys({
  publicKey: agentKp.publicKey,
  secretKey: agentKp.secretKey,
  deviceId, sessionId, sessionToken,
  peerPublicKey: appKp.publicKey,
  serverUrl,
});
console.log(" 配对完成");

// 2. 启动 daemon
await daemonStart(serverUrl);
await new Promise((r) => setTimeout(r, 2000)); // 等待 relay 连接

// 3. App 连接并发送消息
const sharedKey = deriveSharedKey(appKp.secretKey, agentKp.publicKey);
const appSocket = io(`${serverUrl}/relay`, { auth: { token: appData.sessionToken } });

await new Promise<void>((resolve, reject) => {
  appSocket.on("connect", () => {
    console.log(" App 已连接 relay");
    // 发送 2 条测试消息
    const seq = new SeqCounter();
    const env1 = createEnvelope(appData.deviceId, "broadcast", sessionId, MessageType.PROMPT, "测试消息1", sharedKey, seq.next());
    const env2 = createEnvelope(appData.deviceId, "broadcast", sessionId, MessageType.PROMPT, "测试消息2", sharedKey, seq.next());
    appSocket.emit("message", env1);
    appSocket.emit("message", env2);
    console.log(" 已发送 2 条消息");
    setTimeout(resolve, 1000); // 等待 daemon 接收
  });
  appSocket.on("connect_error", (err) => reject(err));
  setTimeout(() => reject(new Error("连接超时")), 10000);
});

// 4. 验证 daemon 缓存
const state = readState();
if (!state) { console.error(" daemon 状态文件不存在"); process.exit(1); }

const healthRes = await fetch(`http://localhost:${state.port}/health`);
const health = await healthRes.json();
console.log(`健康检查: cachedMessages=${health.cachedMessages}`);

const msgRes = await fetch(`http://localhost:${state.port}/messages`);
const msgData = await msgRes.json();
console.log(`缓存消息数: ${msgData.messages.length}`);

if (msgData.messages.length === 2) {
  console.log(" 消息缓存验证通过");
} else {
  console.error(` 期望 2 条消息，实际 ${msgData.messages.length}`);
  process.exit(1);
}

// 5. 测试清理接口
const clearRes = await fetch(`http://localhost:${state.port}/messages/clear`, { method: "POST" });
const clearData = await clearRes.json();
console.log(`清理: cleared=${clearData.cleared}`);

if (clearData.cleared === 2) {
  console.log(" 缓存清理验证通过");
} else {
  console.error(" 清理数量不匹配");
  process.exit(1);
}

// 6. 清理
appSocket.disconnect();
daemonStop();
console.log("\n 全部测试通过");
process.exit(0);
