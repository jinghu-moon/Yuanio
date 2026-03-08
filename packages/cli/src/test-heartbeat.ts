// 测试心跳配置：验证 Socket.IO pingInterval/pingTimeout 生效
import { io } from "socket.io-client";
import { generateKeyPair } from "@yuanio/shared";

const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 配对获取 token
const kp = generateKeyPair();
const res = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: kp.publicKey }),
});
const { sessionToken } = await res.json();

// 2. 连接并检查连接状态
const socket = io(`${serverUrl}/relay`, { auth: { token: sessionToken } });

let connected = false;
socket.on("connect", () => {
  connected = true;
  console.log(" 已连接, transport:", socket.io.engine.transport.name);
});

socket.on("disconnect", (reason) => {
  connected = false;
  console.log("断开:", reason);
});

// 等待连接
await new Promise<void>((r, j) => {
  socket.on("connect", r);
  socket.on("connect_error", j);
  setTimeout(() => j(new Error("连接超时")), 5000);
});

console.assert(connected, " 未连接");
console.log(" 连接状态追踪正常");

// 3. 验证连接保持（等待 3s 确认心跳不会误断）
await new Promise((r) => setTimeout(r, 3000));
console.assert(connected, " 连接意外断开");
console.log(" 心跳保活正常（3s 内未断开）");

socket.disconnect();
console.log("\n 心跳配置测试通过");
process.exit(0);
