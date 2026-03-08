export type CommandSafetyDecision = "allow" | "prompt" | "forbidden";

export interface CommandSafetyRule {
  id: string;
  decision: CommandSafetyDecision;
  pattern: Array<string | string[]>;
  justification?: string;
}

export interface CommandSafetyOptions {
  confirmed?: boolean;
}

export interface CommandSafetyResult {
  decision: CommandSafetyDecision;
  matchedRuleIds: string[];
  justification?: string;
  requiresConfirmation: boolean;
}

const DECISION_ORDER: Record<CommandSafetyDecision, number> = {
  allow: 0,
  prompt: 1,
  forbidden: 2,
};

const DEFAULT_RULES: CommandSafetyRule[] = [
  {
    id: "forbid.git.reset-hard",
    decision: "forbidden",
    pattern: ["git", "reset", "--hard"],
    justification: "危险操作：会直接丢失本地改动。建议改用 `git stash push -u`。",
  },
  {
    id: "forbid.git.push-force",
    decision: "forbidden",
    pattern: ["git", "push", "--force"],
    justification: "危险操作：会改写远端历史。建议新建分支并走评审流程。",
  },
  {
    id: "forbid.rm-rf-root",
    decision: "forbidden",
    pattern: [["rm", "Remove-Item", "del"], "-rf"],
    justification: "危险操作：可能造成不可逆删除。",
  },
  {
    id: "forbid.sudo",
    decision: "forbidden",
    pattern: ["sudo"],
    justification: "危险操作：涉及系统级权限提升。",
  },
  {
    id: "prompt.git.push",
    decision: "prompt",
    pattern: ["git", "push"],
    justification: "该命令会影响远端仓库，请确认后执行。",
  },
  {
    id: "prompt.kubectl.delete",
    decision: "prompt",
    pattern: ["kubectl", "delete"],
    justification: "该命令会删除集群资源，请确认目标环境。",
  },
  {
    id: "prompt.docker.down",
    decision: "prompt",
    pattern: ["docker", "compose", "down"],
    justification: "该命令会停止并移除容器，请确认业务影响。",
  },
  {
    id: "prompt.publish",
    decision: "prompt",
    pattern: [["npm", "pnpm", "bun"], "publish"],
    justification: "该命令会发布包，请确认版本与 registry。",
  },
];

const DANGEROUS_REGEX: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+\/\b/i, reason: "检测到高危删除命令 rm -rf /" },
  { pattern: /\bmkfs\b/i, reason: "检测到文件系统格式化命令 mkfs" },
  { pattern: /\bdd\s+if=/i, reason: "检测到原始磁盘写入命令 dd" },
];

function tokenize(command: string): string[] {
  const matches = command.match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g) || [];
  return matches.map((item) => item.replace(/^["'`]|["'`]$/g, "").trim()).filter(Boolean);
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function tokenMatches(token: string, expected: string | string[]): boolean {
  const value = normalizeToken(token);
  if (Array.isArray(expected)) {
    return expected.some((item) => value === normalizeToken(item));
  }
  return value === normalizeToken(expected);
}

function matchesRule(tokens: string[], rule: CommandSafetyRule): boolean {
  if (tokens.length < rule.pattern.length) return false;
  for (let i = 0; i < rule.pattern.length; i += 1) {
    if (!tokenMatches(tokens[i] || "", rule.pattern[i])) return false;
  }
  return true;
}

function evaluateRegexGuards(command: string): CommandSafetyResult | null {
  for (const guard of DANGEROUS_REGEX) {
    if (guard.pattern.test(command)) {
      return {
        decision: "forbidden",
        matchedRuleIds: ["regex.dangerous"],
        justification: guard.reason,
        requiresConfirmation: false,
      };
    }
  }
  return null;
}

export function evaluateCommandSafety(
  command: string,
  options: CommandSafetyOptions = {},
): CommandSafetyResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      decision: "allow",
      matchedRuleIds: [],
      requiresConfirmation: false,
    };
  }

  const regexResult = evaluateRegexGuards(trimmed);
  if (regexResult) return regexResult;

  const tokens = tokenize(trimmed);
  let finalDecision: CommandSafetyDecision = "allow";
  const matchedRuleIds: string[] = [];
  const justifications: string[] = [];

  for (const rule of DEFAULT_RULES) {
    if (!matchesRule(tokens, rule)) continue;
    matchedRuleIds.push(rule.id);
    if (rule.justification) justifications.push(rule.justification);
    if (DECISION_ORDER[rule.decision] > DECISION_ORDER[finalDecision]) {
      finalDecision = rule.decision;
    }
  }

  return {
    decision: finalDecision,
    matchedRuleIds,
    justification: justifications.length > 0 ? justifications[0] : undefined,
    requiresConfirmation: finalDecision === "prompt" && options.confirmed !== true,
  };
}

