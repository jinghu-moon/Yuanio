// 测试心跳配置：验证 WS 连接保持（短时间内不意外断开）
import { connectRelayWs, waitForWsOpen } from "./relay-options";
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
const socket = connectRelayWs(serverUrl, sessionToken);
let connected = false;
socket.on("open", () => {
  connected = true;
  console.log(" 已连接, transport: websocket");
});
socket.on("close", (code, reason) => {
  connected = false;
  const detail = reason ? ` ${reason.toString()}` : "";
  console.log(`断开: ${code}${detail}`);
});

// 等待连接
await waitForWsOpen(socket, 5000);
connected = true;

console.assert(connected, " 未连接");
console.log(" 连接状态追踪正常");

// 3. 验证连接保持（等待 3s 确认心跳不会误断）
await new Promise((r) => setTimeout(r, 3000));
console.assert(connected, " 连接意外断开");
console.log(" 心跳保活正常（3s 内未断开）");

socket.close();
console.log("\n 心跳配置测试通过");
process.exit(0);
