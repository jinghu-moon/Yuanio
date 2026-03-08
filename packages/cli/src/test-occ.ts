// 测试乐观并发控制
export {};
const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 创建会话并获取 token
const pairRes = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: "occ-test-public-key" }),
});
const pair = await pairRes.json() as any;
const sessionId = pair.sessionId as string;
const token = pair.sessionToken as string;
console.log(" 会话已创建:", sessionId);

const authHeaders = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

// 2. 获取初始版本
const v1 = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}/version`, {
  headers: authHeaders,
}).then(r => r.json()) as any;
console.log("初始版本:", v1.version);
if (v1.version !== 1) { console.log(" 初始版本应为 1"); process.exit(1); }
console.log(" 初始版本正确");

// 3. 正确版本更新 — 应成功
const u1 = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}/update`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ expectedVersion: 1 }),
}).then(r => r.json()) as any;

if (u1.success && u1.newVersion === 2) {
  console.log(" 版本 1→2 更新成功");
} else {
  console.log(" 更新失败:", u1); process.exit(1);
}

// 4. 过期版本更新 — 应冲突 (409)
const u2Res = await fetch(`${serverUrl}/api/v1/sessions/${sessionId}/update`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({ expectedVersion: 1 }),
});
const u2 = await u2Res.json() as any;

if (u2Res.status === 409 && u2.currentVersion === 2) {
  console.log(" 过期版本被拒绝 (409), 当前版本:", u2.currentVersion);
} else {
  console.log(" 应返回 409:", u2Res.status, u2); process.exit(1);
}

// 5. 并发竞争：两个请求同时用版本 2 更新，只有一个成功
const [r1, r2] = await Promise.all([
  fetch(`${serverUrl}/api/v1/sessions/${sessionId}/update`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ expectedVersion: 2 }),
  }),
  fetch(`${serverUrl}/api/v1/sessions/${sessionId}/update`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ expectedVersion: 2 }),
  }),
]);

const statuses = [r1.status, r2.status].sort();
if (statuses[0] === 200 && statuses[1] === 409) {
  console.log(" 并发竞争：一个成功 (200)，一个冲突 (409)");
} else {
  console.log(" 并发竞争结果异常:", statuses); process.exit(1);
}

console.log("\n 乐观并发控制测试全部通过");
process.exit(0);
