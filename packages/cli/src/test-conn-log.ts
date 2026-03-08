// 测试连接元数据日志
import { io } from "socket.io-client";
import { generateKeyPair, PROTOCOL_VERSION } from "@yuanio/shared";

const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 配对
const kp = generateKeyPair();
const res = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: kp.publicKey }),
});
const { sessionToken, sessionId } = await res.json();
console.log(" 配对完成");

// 2. 连接 → 断开
const socket = io(`${serverUrl}/relay`, { auth: { token: sessionToken, protocolVersion: PROTOCOL_VERSION } });
await new Promise<void>((r) => socket.on("connect", r));
console.log(" 已连接");

socket.disconnect();
await new Promise((r) => setTimeout(r, 500));
console.log(" 已断开");

// 3. 查询连接日志
const logRes = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}/connections`, {
  headers: { Authorization: `Bearer ${sessionToken}` },
});
const { logs, count } = await logRes.json() as any;

console.log(`查询到 ${count} 条日志`);

let pass = true;
if (count < 2) {
  console.log(" 日志数量不足（期望 >= 2）");
  pass = false;
} else {
  // 日志按 id DESC 排序，最新在前
  const disconnect = logs[0];
  const connect = logs[1];

  if (connect.event === "connect" && disconnect.event === "disconnect") {
    console.log(" connect/disconnect 事件已记录");
  } else {
    console.log(" 事件类型不匹配", { connect: connect.event, disconnect: disconnect.event });
    pass = false;
  }

  if (connect.ip) {
    console.log(" IP 已记录:", connect.ip);
  } else {
    console.log(" IP 未记录");
    pass = false;
  }

  if (connect.role === "agent") {
    console.log(" 角色已记录:", connect.role);
  } else {
    console.log(" 角色不匹配");
    pass = false;
  }
}

if (pass) {
  console.log("\n 连接元数据日志测试通过");
} else {
  process.exit(1);
}
process.exit(0);
