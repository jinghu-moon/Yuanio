// 测试消息密文持久化到 SQLite
import {
  generateKeyPair, deriveSharedKey,
  createEnvelope, openEnvelope,
  MessageType, SeqCounter,
} from "@yuanio/shared";
import type { Envelope } from "@yuanio/shared";
import { connectRelayWs, sendWsFrame, toWsMessageFrame, waitForWsOpen } from "./relay-options";

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
const agentKey = deriveSharedKey(agentKp.secretKey, appKp.publicKey);
const appKey = deriveSharedKey(appKp.secretKey, agentKp.publicKey);
console.log(" 配对完成");

// 2. 连接并发送消息
const agentSocket = connectRelayWs(serverUrl, agentToken);
const appSocket = connectRelayWs(serverUrl, appData.sessionToken);
await Promise.all([
  waitForWsOpen(agentSocket, 8000),
  waitForWsOpen(appSocket, 8000),
]);

const seq = new SeqCounter();
const sentIds: string[] = [];

// 发送 3 条消息（间隔确保不同时间戳）
for (let i = 0; i < 3; i++) {
  if (i > 0) await new Promise((r) => setTimeout(r, 50));
  const env = createEnvelope(
    agentId, appData.deviceId, sessionId,
    MessageType.STREAM_CHUNK, `消息${i + 1}`, agentKey, seq.next(),
  );
  sentIds.push(env.id);
  sendWsFrame(agentSocket, toWsMessageFrame(env));
}
console.log(" 已发送 3 条消息");

await new Promise((r) => setTimeout(r, 1000));

// 3. 通过 API 查询持久化的消息
const msgRes = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}/messages`, {
  headers: { Authorization: `Bearer ${appData.sessionToken}` },
});
const { messages, count } = await msgRes.json() as any;

console.log(`查询到 ${count} 条消息`);

let pass = true;
if (count < 3) {
  console.log(" 消息数量不足");
  pass = false;
} else {
  // 验证消息 ID 匹配
  for (let i = 0; i < 3; i++) {
    if (messages[i].id !== sentIds[i]) {
      console.log(` 消息 ${i} ID 不匹配`);
      pass = false;
    }
  }
  if (pass) console.log(" 消息 ID 全部匹配");

  // 验证密文可解密
  for (const msg of messages.slice(0, 3)) {
    const env: Envelope = {
      id: msg.id, seq: msg.seq, source: msg.source,
      target: msg.target, sessionId: msg.session_id,
      type: msg.type, ts: msg.ts, payload: msg.payload,
    };
    const text = openEnvelope(env, appKey);
    if (!text.startsWith("消息")) {
      console.log(" 密文解密失败:", text);
      pass = false;
    }
  }
  if (pass) console.log(" 密文解密验证通过");

  // 验证 after 参数过滤
  const afterTs = messages[1].ts;
  const filtered = await fetch(
    `${serverUrl}/api/v1/sessions/${sessionId}/messages?after=${afterTs}`,
    { headers: { Authorization: `Bearer ${appData.sessionToken}` } },
  ).then((r) => r.json()) as any;
  if (filtered.count >= 1 && filtered.messages[0].ts > afterTs) {
    console.log(" after 时间戳过滤正常");
  } else {
    console.log(" after 过滤异常");
    pass = false;
  }
}

agentSocket.close();
appSocket.close();

if (pass) {
  console.log("\n 消息密文持久化测试全部通过");
} else {
  console.log("\n 部分测试失败");
  process.exit(1);
}
process.exit(0);
