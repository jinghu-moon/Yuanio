// 模拟配对流程，生成 keys.json 供 daemon 测试
import { generateKeyPair, deriveSharedKey } from "@yuanio/shared";
import { saveKeys } from "./keystore";

const serverUrl = process.argv[2] || "http://localhost:3000";

// Agent 侧：生成密钥 + 创建配对
const agentKp = generateKeyPair();
const createRes = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: agentKp.publicKey }),
});
const { pairingCode, sessionToken, deviceId, sessionId } = await createRes.json();
console.log(`配对码: ${pairingCode}`);

// App 侧：生成密钥 + 加入配对
const appKp = generateKeyPair();
const joinRes = await fetch(`${serverUrl}/api/v1/pair/join`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: pairingCode, publicKey: appKp.publicKey }),
});
const joinData = await joinRes.json();
console.log(`加入成功: sessionId=${joinData.sessionId}`);

// Agent 侧：DH + 持久化
const sharedKey = deriveSharedKey(agentKp.secretKey, appKp.publicKey);
saveKeys({
  publicKey: agentKp.publicKey,
  secretKey: agentKp.secretKey,
  deviceId,
  sessionId,
  sessionToken,
  peerPublicKey: appKp.publicKey,
  serverUrl,
});

console.log(" 密钥已保存到 ~/.yuanio/keys.json");
