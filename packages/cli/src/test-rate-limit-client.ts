// 测试 CLI 端配对码速率限制提示
import { startPairing } from "./pair";
import { generateKeyPair } from "@yuanio/shared";

const SERVER = process.argv[2] || "http://localhost:3000";

// 1. 先用原始请求耗尽配额（5次）
for (let i = 0; i < 5; i++) {
  const kp = generateKeyPair();
  await fetch(`${SERVER}/api/v1/pair/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: kp.publicKey }),
  });
}
console.log(" 已发送 5 次请求耗尽配额");

// 2. 调用 startPairing，应抛出友好错误
try {
  await startPairing(SERVER);
  console.log(" 应该抛出错误但没有");
  process.exit(1);
} catch (err: any) {
  if (err.message.includes("配对请求过于频繁")) {
    console.log(" 收到友好提示:", err.message);
  } else {
    console.log(" 错误信息不符预期:", err.message);
    process.exit(1);
  }
}

console.log("\n 速率限制客户端提示测试通过");
process.exit(0);
