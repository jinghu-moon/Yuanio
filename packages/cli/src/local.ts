import { spawn } from "node:child_process";
import { startHookServer, type HookServer } from "./hook-server";

let _hookServer: HookServer | null = null;
let _onSessionHook: ((sessionId: string, data: any) => void) | null = null;

export function onLocalSessionHook(handler: (sessionId: string, data: any) => void) {
  _onSessionHook = handler;
}

// 本地模式：spawn claude with stdio inherit + Hook 服务器
export async function startLocalMode(): Promise<void> {
  console.log("\n本地模式 — 双空格切换到远程模式\n");

  // 启动 Hook 服务器（如尚未启动）
  if (!_hookServer) {
    try {
      _hookServer = await startHookServer((sessionId, data) => {
        console.log(`[hook] Claude session: ${sessionId}`);
        _onSessionHook?.(sessionId, data);
      });
      console.log(`[hook] 服务器已启动 (port ${_hookServer.port})`);
    } catch (err) {
      console.warn("[hook] 启动失败，继续无 Hook 模式:", err);
    }
  }

  const args: string[] = [];
  if (_hookServer) args.push("--settings", _hookServer.settingsPath);

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      stdio: "inherit",
      env: {
        ...process.env,
        CLAUDE_CODE_GIT_BASH_PATH: process.env.CLAUDE_CODE_GIT_BASH_PATH || "C:\\A_Softwares\\Git\\bin\\bash.exe",
      },
      shell: true,
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`claude exited with code ${code}`));
    });

    proc.on("error", reject);
  });
}

export function stopHookServer() {
  _hookServer?.stop();
  _hookServer = null;
}
