import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type StatuslineConfigFile = {
  version: 1;
  projects: Record<string, { command?: string; enabled?: boolean }>;
};

export interface StatuslineInput {
  cwd: string;
  projectDir: string;
  sessionId: string;
  status: string;
  mode: string;
  runningTasks: number;
  pendingApprovals: number;
  queueSize: number;
  outputStyle: string;
  uptimeMs: number;
  cost: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
  context: {
    usedPercentage: number;
    estimatedUsedTokens: number;
    contextWindowSize: number;
  };
}

const STATUSLINE_CONFIG_FILE = join(homedir(), ".yuanio", "statusline.json");

function projectKey(cwd: string): string {
  return resolve(cwd).toLowerCase();
}

function readConfig(): StatuslineConfigFile {
  if (!existsSync(STATUSLINE_CONFIG_FILE)) return { version: 1, projects: {} };
  try {
    const parsed = JSON.parse(readFileSync(STATUSLINE_CONFIG_FILE, "utf-8")) as Partial<StatuslineConfigFile>;
    return {
      version: 1,
      projects: parsed.projects && typeof parsed.projects === "object"
        ? parsed.projects as Record<string, { command?: string; enabled?: boolean }>
        : {},
    };
  } catch {
    return { version: 1, projects: {} };
  }
}

function writeConfig(data: StatuslineConfigFile): void {
  const parent = dirname(STATUSLINE_CONFIG_FILE);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(STATUSLINE_CONFIG_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

export function getStatuslineConfig(cwd = process.cwd()): { enabled: boolean; command?: string } {
  const config = readConfig();
  const key = projectKey(cwd);
  const item = config.projects[key] || {};
  return {
    enabled: item.enabled !== false,
    command: item.command,
  };
}

export function setStatuslineConfig(
  input: { enabled?: boolean; command?: string },
  cwd = process.cwd(),
): { enabled: boolean; command?: string } {
  const config = readConfig();
  const key = projectKey(cwd);
  const prev = config.projects[key] || {};
  const next = {
    enabled: typeof input.enabled === "boolean" ? input.enabled : (prev.enabled !== false),
    command: typeof input.command === "string" ? input.command.trim() : prev.command,
  };
  if (!next.command) delete next.command;
  config.projects[key] = next;
  writeConfig(config);
  return { enabled: next.enabled !== false, command: next.command };
}

export async function runStatuslineCommand(
  command: string,
  data: StatuslineInput,
  timeoutMs = 1500,
): Promise<string | null> {
  const cmd = command.trim();
  if (!cmd) return null;
  const args = process.platform === "win32"
    ? ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd]
    : ["sh", "-lc", cmd];

  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: data.cwd,
    env: { ...process.env, TERM: "dumb" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch {}
  }, timeoutMs);

  try {
    proc.stdin.write(JSON.stringify(data));
    proc.stdin.end();
    const [stdout, _stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) return null;
    const lines = stdout.split(/\r?\n/).map(normalizeLine).filter(Boolean);
    if (lines.length === 0) return null;
    return lines.slice(0, 3).join("\n");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function buildDefaultStatuslineText(data: StatuslineInput): string {
  return [
    `${data.status.toUpperCase()} · ${data.mode.toUpperCase()} · style=${data.outputStyle}`,
    `tasks ${data.runningTasks} · queue ${data.queueSize} · approvals ${data.pendingApprovals}`,
    `ctx ${data.context.usedPercentage}% (${data.context.estimatedUsedTokens}/${data.context.contextWindowSize})`,
  ].join("\n");
}

