// 测试 JWT session token：签发、认证、吊销
import { io } from "socket.io-client";
import { generateKeyPair } from "@yuanio/shared";

const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 配对获取 JWT token
const agentKp = generateKeyPair();
const createRes = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: agentKp.publicKey }),
});
const { sessionToken, deviceId, sessionId } = await createRes.json();

// 验证 token 是 JWT 格式（三段 base64url）
const parts = sessionToken.split(".");
if (parts.length === 3) {
  const header = JSON.parse(atob(parts[0]));
  const payload = JSON.parse(atob(parts[1]));
  console.log(" JWT 格式正确, alg:", header.alg);
  console.log(" JWT payload:", { deviceId: payload.deviceId, role: payload.role, exp: !!payload.exp });
} else {
  console.log(" 不是 JWT 格式");
  process.exit(1);
}

// 2. 用 JWT 连接 relay — 应成功
const socket1 = io(`${serverUrl}/relay`, { auth: { token: sessionToken } });
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("连接超时")), 5000);
  socket1.on("connect", () => { clearTimeout(timer); resolve(); });
  socket1.on("connect_error", (e) => { clearTimeout(timer); reject(e); });
});
console.log(" JWT 认证连接成功");
socket1.disconnect();

// 3. 用无效 token 连接 — 应被拒绝
const badSocket = io(`${serverUrl}/relay`, {
  auth: { token: "invalid.jwt.token" },
  reconnection: false,
});
await new Promise<void>((resolve) => {
  badSocket.on("connect_error", () => {
    console.log(" 无效 token 被拒绝");
    resolve();
  });
  setTimeout(() => { console.log(" 无效 token 未被拒绝"); process.exit(1); }, 5000);
});
badSocket.disconnect();

// 4. 吊销 token → 重连应失败
const revokeRes = await fetch(`${serverUrl}/api/v1/token/revoke`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: sessionToken }),
});
const revokeData = await revokeRes.json();
if (revokeData.revoked) {
  console.log(" Token 吊销 API 成功");
} else {
  console.log(" Token 吊销失败");
  process.exit(1);
}

const socket2 = io(`${serverUrl}/relay`, {
  auth: { token: sessionToken },
  reconnection: false,
});
await new Promise<void>((resolve) => {
  socket2.on("connect_error", () => {
    console.log(" 吊销后的 token 被拒绝");
    resolve();
  });
  setTimeout(() => { console.log(" 吊销后的 token 未被拒绝"); process.exit(1); }, 5000);
});
socket2.disconnect();

console.log("\n JWT session token 测试全部通过");
process.exit(0);
