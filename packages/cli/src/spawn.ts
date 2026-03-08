import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

export type AgentType = "claude" | "codex" | "gemini";

const AGENT_COMMANDS: Record<AgentType, (prompt: string) => { cmd: string; args: string[] }> = {
  claude: (prompt) => ({
    cmd: "claude",
    args: ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages"],
  }),
  codex: (prompt) => ({
    cmd: "codex",
    // 官方 Rust CLI: JSON 事件流仅在 `codex exec --json` 可用
    // 使用 `-` 从 stdin 读取 prompt，避免 Windows shell=true 下的参数拆分问题
    args: ["exec", "--skip-git-repo-check", "--json", "-"],
  }),
  gemini: (prompt) => ({
    cmd: "gemini",
    args: ["--prompt", prompt, "--output-format", "stream-json"],
  }),
};

const AGENT_ENV_VARS: Record<AgentType, string> = {
  claude: "YUANIO_CLAUDE_CMD",
  codex: "YUANIO_CODEX_CMD",
  gemini: "YUANIO_GEMINI_CMD",
};

export interface AgentHandle {
  promise: Promise<void>;
  kill: () => void;
  pid?: number;
}

export interface SpawnOptions {
  agent?: AgentType;
  approvalPort?: number;  // 审批服务器端口，传入后设置 YUANIO_APPROVAL_PORT 环境变量
  resumeSessionId?: string;  // Phase 10: 会话恢复
}

type ResolvedCommand = {
  cmd: string;
  argsPrefix: string[];
  display: string;
};

function isPathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\") || isAbsolute(value);
}

function getPathExts(): string[] {
  if (process.platform !== "win32") return [""];
  const raw = process.env.PATHEXT;
  if (raw) {
    return ["", ...raw.split(";").map((ext) => ext.toLowerCase())];
  }
  return ["", ".exe", ".cmd", ".bat", ".ps1"];
}

function isBrokenClaudeShim(executable: string): boolean {
  const normalized = executable.toLowerCase();
  if (!/[\\/]node_modules[\\/]\\.bin[\\/]/i.test(normalized)) return false;
  const cliPath = join(dirname(executable), "..", "@anthropic-ai", "claude-code", "cli.js");
  return !existsSync(cliPath);
}

function resolveOnPath(cmd: string, agent: AgentType, allowSkipBroken: boolean): string | null {
  const envPath = process.env.PATH || "";
  const exts = getPathExts();
  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, cmd + (cmd.toLowerCase().endsWith(ext) ? "" : ext));
      if (!existsSync(full)) continue;
      if (agent === "claude" && isBrokenClaudeShim(full)) {
        if (!allowSkipBroken) {
          throw new Error(`[spawn] 本地 claude shim 指向的 @anthropic-ai/claude-code 不存在: ${full}`);
        }
        continue;
      }
      return full;
    }
  }
  return null;
}

function wrapCommand(executable: string): ResolvedCommand {
  if (process.platform === "win32" && executable.toLowerCase().endsWith(".ps1")) {
    return {
      cmd: "powershell.exe",
      argsPrefix: ["-ExecutionPolicy", "Bypass", "-File", executable],
      display: `powershell.exe -File ${executable}`,
    };
  }
  return { cmd: executable, argsPrefix: [], display: executable };
}

function resolveAgentCommand(agent: AgentType, baseCmd: string): ResolvedCommand {
  const envVar = AGENT_ENV_VARS[agent];
  const override = process.env[envVar];
  const candidates = override ? [override, baseCmd] : [baseCmd];
  let lastError: string | null = null;

  for (const candidate of candidates) {
    const allowSkipBroken = candidate !== override;
    if (isPathLike(candidate)) {
      if (existsSync(candidate)) {
        if (agent === "claude" && isBrokenClaudeShim(candidate)) {
          if (!allowSkipBroken) {
            throw new Error(`[spawn] 本地 claude shim 指向的 @anthropic-ai/claude-code 不存在: ${candidate}`);
          }
        } else {
          return wrapCommand(candidate);
        }
      }
      lastError = `${candidate} 不存在`;
      continue;
    }
    const found = resolveOnPath(candidate, agent, allowSkipBroken);
    if (found) return wrapCommand(found);
    lastError = `${candidate} 未在 PATH 中找到`;
  }

  const hint = override
    ? `请检查环境变量 ${envVar} 指向的可执行文件，或安装对应 CLI`
    : `请安装对应 CLI，或设置环境变量 ${envVar} 指向可执行文件`;
  throw new Error(`[spawn] 未检测到 ${agent} CLI（${lastError ?? "unknown"}）。${hint}`);
}

export function spawnAgent(
  prompt: string,
  onMessage: (msg: any) => void,
  agentOrOpts: AgentType | SpawnOptions = "claude",
): AgentHandle {
  const opts: SpawnOptions = typeof agentOrOpts === "string"
    ? { agent: agentOrOpts }
    : agentOrOpts;
  const agent = opts.agent ?? "claude";
  // shell=true 在 Windows 下传递多行参数时容易破坏参数边界，这里统一压成单行。
  const promptForCli = prompt.replace(/\r\n/g, "\n").replace(/\n+/g, " ").trim();
  const { cmd: baseCmd, args: baseArgs } = AGENT_COMMANDS[agent](promptForCli);

  // Phase 10: 会话恢复 — 注入 resume 参数
  if (opts.resumeSessionId) {
    if (agent === "claude") {
      baseArgs.push("--resume", opts.resumeSessionId);
    } else if (agent === "codex") {
      // 官方 Rust CLI: `codex exec resume [SESSION_ID] [PROMPT] --json`
      baseArgs.splice(
        0,
        baseArgs.length,
        "exec",
        "resume",
        "--skip-git-repo-check",
        "--json",
        opts.resumeSessionId,
        "-",
      );
    }
    // gemini: 暂不支持 resume，忽略
  }

  let resolved: ResolvedCommand | null = null;
  try {
    resolved = resolveAgentCommand(agent, baseCmd);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      promise: Promise.reject(new Error(message)),
      kill: () => {},
    };
  }
  const cmd = resolved.cmd;
  const args = [...resolved.argsPrefix, ...baseArgs];
  let killFn: () => void = () => {};
  let childPid: number | undefined;

  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_GIT_BASH_PATH: process.env.CLAUDE_CODE_GIT_BASH_PATH || "C:\\A_Softwares\\Git\\bin\\bash.exe",
  };
  // 传递审批端口给 hook 脚本
  if (opts.approvalPort) {
    env.YUANIO_APPROVAL_PORT = String(opts.approvalPort);
  }

  const promise = new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: true,
    });
    childPid = proc.pid ?? undefined;

    killFn = () => { try { proc.kill("SIGTERM"); } catch {} };

    if (agent === "codex") {
      try {
        proc.stdin?.write(`${promptForCli}\n`);
      } finally {
        proc.stdin?.end();
      }
    } else {
      proc.stdin?.end();
    }

    const rl = createInterface({ input: proc.stdout! });
    let parseWarnCount = 0;
    const debugParse = process.env.YUANIO_DEBUG_SPAWN_PARSE === "1";
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        onMessage(JSON.parse(line));
      } catch {
        if (debugParse && parseWarnCount < 20) {
          parseWarnCount += 1;
          console.warn(`[spawn:${agent}] stdout 非 JSON 行 #${parseWarnCount}: ${line.slice(0, 240)}`);
        }
      }
    });

    proc.stderr!.on("data", (chunk) => {
      console.error(`[${agent} stderr]`, chunk.toString());
    });

    proc.on("close", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`${agent} exited with code ${code}`));
    });
    proc.on("error", reject);
  });

  return { promise, kill: () => killFn(), pid: childPid };
}

/** 向后兼容别名 */
export const spawnClaude = (prompt: string, onMessage: (msg: any) => void) =>
  spawnAgent(prompt, onMessage, "claude").promise;
