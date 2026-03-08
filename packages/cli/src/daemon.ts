import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const DIR = join(homedir(), ".yuanio");
const STATE_FILE = process.env.YUANIO_DAEMON_STATE || join(DIR, "daemon.json");

export interface DaemonState {
  pid: number;
  port: number;
  version: string;
  startedAt: string;
  sessions: string[];
}

function getCliVersion(): string {
  try {
    const pkgPath = join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// --- 状态文件读写 ---

export function readState(): DaemonState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function writeState(state: DaemonState) {
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function removeState() {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}

// --- 进程存活检测 ---

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = 仅检测，不发送信号
    return true;
  } catch {
    return false;
  }
}

// --- 子命令实现 ---

export interface DaemonStartOptions {
  warmAgent?: "claude" | "codex" | "gemini";
  warmIntervalMin?: number;
}

export async function daemonStart(serverUrl: string, options: DaemonStartOptions = {}) {
  const currentVersion = getCliVersion();
  const existing = readState();
  if (existing && isProcessAlive(existing.pid)) {
    if (existing.version === currentVersion) {
      console.log(`Daemon 已在运行 (PID: ${existing.pid}, 端口: ${existing.port}, 版本: ${existing.version})`);
      return;
    }
    console.log(`检测到旧版本 Daemon: ${existing.version} → ${currentVersion}，正在滚动重启...`);
    try { process.kill(existing.pid); } catch {}
    removeState();
  }

  // 清理残留状态
  removeState();

  // spawn detached 子进程
  const daemonScript = join(import.meta.dir, "daemon-process.ts");
  const args = ["run", daemonScript, "--server", serverUrl];
  if (options.warmAgent) {
    args.push("--warm-agent", options.warmAgent);
  }
  if (options.warmIntervalMin && options.warmIntervalMin > 0) {
    args.push("--warm-interval", String(options.warmIntervalMin));
  }

  const child = spawn("bun", args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, YUANIO_CLI_VERSION: currentVersion },
  });

  child.unref();

  // 等待 daemon 写入状态文件（最多 5 秒）
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const state = readState();
    if (state && isProcessAlive(state.pid)) {
      console.log(`Daemon 已启动 (PID: ${state.pid}, 端口: ${state.port}, 版本: ${state.version})`);
      return;
    }
  }

  console.error("Daemon 启动超时，请检查日志");
  process.exit(1);
}

export function daemonStop() {
  const state = readState();
  if (!state) {
    console.log("Daemon 未运行");
    return;
  }

  if (isProcessAlive(state.pid)) {
    try {
      process.kill(state.pid);
      console.log(`Daemon 已停止 (PID: ${state.pid})`);
    } catch (err) {
      console.error(`无法停止进程 ${state.pid}:`, err);
    }
  } else {
    console.log("Daemon 进程已不存在，清理状态文件");
  }

  removeState();
}

export function daemonStatus() {
  const state = readState();
  if (!state) {
    console.log("● Daemon: 未运行");
    return;
  }

  const alive = isProcessAlive(state.pid);
  if (alive) {
    console.log(`● Daemon: 运行中`);
    console.log(`  PID:     ${state.pid}`);
    console.log(`  端口:    ${state.port}`);
    console.log(`  版本:    ${state.version}`);
    console.log(`  启动于:  ${state.startedAt}`);
    console.log(`  会话数:  ${state.sessions?.length ?? 0}`);
    if (state.sessions?.length) {
      state.sessions.forEach((s) => console.log(`    - ${s}`));
    }
  } else {
    console.log("● Daemon: 已停止（残留状态文件已清理）");
    removeState();
  }
}
