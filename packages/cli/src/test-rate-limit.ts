// 测试配对码速率限制：同一 IP 每分钟最多 5 次
import { generateKeyPair } from "@yuanio/shared";

const serverUrl = process.argv[2] || "http://localhost:3000";

const pair = async () => {
  const kp = generateKeyPair();
  const res = await fetch(`${serverUrl}/api/v1/pair/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: kp.publicKey }),
  });
  return res.status;
};

// 发送 6 次请求，前 5 次应成功，第 6 次应被限流
const results: number[] = [];
for (let i = 0; i < 6; i++) {
  results.push(await pair());
}

console.log("响应状态码:", results);

const ok = results.slice(0, 5).every((s) => s === 200);
const limited = results[5] === 429;

if (ok && limited) {
  console.log(" 前 5 次成功, 第 6 次被限流 (429)");
} else {
  console.log(" 速率限制未按预期工作");
  process.exit(1);
}

console.log("\n 速率限制测试通过");
process.exit(0);
