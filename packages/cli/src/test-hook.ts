// 测试 Hook 服务器：启动 → 生成 settings → 模拟 Claude 事件 → 验证回调
import { startHookServer } from "./hook-server";
import { readFileSync, existsSync } from "node:fs";

let receivedSessionId: string | null = null;

// 1. 启动 Hook 服务器
const hook = await startHookServer((sessionId, data) => {
  receivedSessionId = sessionId;
  console.log("[hook] 收到事件:", sessionId);
});

console.log(` Hook 服务器已启动 (port ${hook.port})`);

// 2. 验证 settings 文件
if (!existsSync(hook.settingsPath)) {
  console.log(" settings 文件不存在:", hook.settingsPath);
  process.exit(1);
}

const settings = JSON.parse(readFileSync(hook.settingsPath, "utf-8"));
const hookCmd = settings.hooks?.SessionStart?.[0]?.hooks?.[0]?.command;

if (hookCmd && hookCmd.includes("hook_forwarder.cjs") && hookCmd.includes(String(hook.port))) {
  console.log(" settings 文件格式正确");
} else {
  console.log(" settings 内容异常:", hookCmd);
  process.exit(1);
}

// 3. 模拟 Claude 发送 SessionStart 事件
const body = JSON.stringify({ session_id: "test-session-123" });
const res = await fetch(`http://127.0.0.1:${hook.port}/hook/session-start`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

if (res.status === 200) {
  console.log(" Hook 服务器响应 200");
} else {
  console.log(" 响应状态:", res.status);
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 100));

if (receivedSessionId === "test-session-123") {
  console.log(" 回调收到正确 sessionId");
} else {
  console.log(" sessionId 不匹配:", receivedSessionId);
  process.exit(1);
}

// 4. 清理
hook.stop();
console.log("\n Hook 服务器测试通过");
process.exit(0);
