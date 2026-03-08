export interface TelegramCommandValidationResult {
  ok: boolean;
  reason?: string;
}

export interface TelegramCommandPolicy {
  loopMaxIterations: number;
  validateForwardCommand: (name: string) => TelegramCommandValidationResult;
  buildLoopPrompt: (userPrompt: string) => string;
}

const CLAUDE_BUILTIN_TELEGRAM_FORWARD_DEFAULTS = [
  "add-dir",
  "agents",
  "chrome",
  "clear",
  "compact",
  "config",
  "context",
  "copy",
  "cost",
  "desktop",
  "diff",
  "doctor",
  "env",
  "help",
  "ide",
  "init",
  "login",
  "logout",
  "mcp",
  "memory",
  "model",
  "permissions",
  "pr_comments",
  "review",
  "resume",
  "status",
  "terminal-setup",
  "vim",
  "bug",
];

const LOCAL_TELEGRAM_HANDLED_COMMANDS = [
  "start",
  "help",
  "continue",
  "continue_",
  "stop",
  "clear",
  "reset",
  "new",
  "loop",
  "mode",
  "plan",
  "act",
  "tasks",
  "history",
  "task",
  "approvals",
  "checkpoint",
  "cwd",
  "probe",
  "resume",
  "approve",
  "reject",
  "context",
  "compact",
  "rewind",
  "memory",
  "agents",
  "style",
  "output-style",
  "output_style",
  "permissions",
  "allowed-tools",
  "allowed_tools",
  "statusline",
  "skill",
  "skills",
];

function parseCommandSet(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseLoopMaxIterations(raw: string): number {
  const value = Number(raw || "");
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function buildForwardPattern(raw: string): RegExp {
  const fallback = /^[a-z][a-z0-9_:-]{0,31}$/;
  try {
    return new RegExp(raw);
  } catch {
    return fallback;
  }
}

export function createTelegramCommandPolicy(env: NodeJS.ProcessEnv = process.env): TelegramCommandPolicy {
  const forwardAllTelegramCommands = env.YUANIO_TELEGRAM_FORWARD_ALL_COMMANDS === "1";
  const forwardCommandSet = parseCommandSet(
    env.YUANIO_TELEGRAM_FORWARD_COMMANDS || CLAUDE_BUILTIN_TELEGRAM_FORWARD_DEFAULTS.join(","),
  );
  const blockedForwardCommandSet = parseCommandSet(
    env.YUANIO_TELEGRAM_BLOCKED_COMMANDS || LOCAL_TELEGRAM_HANDLED_COMMANDS.join(","),
  );
  const forwardPatternRaw = (env.YUANIO_TELEGRAM_FORWARD_COMMAND_PATTERN || "^[a-z][a-z0-9_:-]{0,31}$").trim();
  const forwardPattern = buildForwardPattern(forwardPatternRaw);
  const loopMaxIterations = parseLoopMaxIterations(env.YUANIO_TELEGRAM_LOOP_MAX_ITERATIONS || "");

  const validateForwardCommand = (name: string): TelegramCommandValidationResult => {
    if (!name) return { ok: false, reason: "空命令" };
    if (!forwardPattern.test(name)) return { ok: false, reason: "命令格式不合法" };
    if (blockedForwardCommandSet.has(name)) return { ok: false, reason: "命令被策略拒绝" };
    if (!forwardAllTelegramCommands && !forwardCommandSet.has(name)) return { ok: false, reason: "命令未放行" };
    return { ok: true };
  };

  const buildLoopPrompt = (userPrompt: string): string => {
    const cleanPrompt = userPrompt.trim();
    return [
      `请进入循环执行模式，最多 ${loopMaxIterations} 轮迭代，目标如下：`,
      cleanPrompt,
      "",
      "执行要求：",
      "1. 每轮都输出：计划、执行、验证结论。",
      "2. 若已完成目标，立即停止迭代。",
      "3. 最后一行输出 DONE。",
    ].join("\n");
  };

  return {
    loopMaxIterations,
    validateForwardCommand,
    buildLoopPrompt,
  };
}
