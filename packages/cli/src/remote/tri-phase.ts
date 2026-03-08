export interface TriPhaseResult {
  prompt: string;
  applied: boolean;
  reason: string;
}

const TRI_PHASE_ENABLED = process.env.YUANIO_TRI_PHASE_ENABLED !== "0";

const TRI_PHASE_KEYWORDS: RegExp[] = [
  /\bfix\b/i,
  /\bbug\b/i,
  /\brefactor\b/i,
  /\bimplement\b/i,
  /\bcode\b/i,
  /\bcompile\b/i,
  /\btest\b/i,
  /\bandroid\b/i,
  /\bkotlin\b/i,
  /代码|实现|修复|重构|编译|测试|构建|安卓|功能/i,
];

function isInteractiveCommand(prompt: string): boolean {
  const text = prompt.trim();
  return text.startsWith("/")
    || text === "continue"
    || text === "CONTINUE"
    || text.startsWith("@");
}

function looksLikeEngineeringTask(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  return TRI_PHASE_KEYWORDS.some((pattern) => pattern.test(text));
}

export function buildTriPhasePrompt(userPrompt: string): string {
  return [
    "执行协议：Plan -> Execute -> Review（三阶段必须按顺序完成）",
    "1) PLAN：先给最小可执行计划（含风险点与验证命令）。",
    "2) EXECUTE：再执行变更，禁止无关重构，保持业务契约不变。",
    "3) REVIEW：最后给出验证结果、残留风险和下一步建议。",
    "输出要求：每个阶段都要有可审计证据，不得跳阶段。",
    "",
    "用户任务：",
    userPrompt,
  ].join("\n");
}

export function applyTriPhasePrompt(rawPrompt: string): TriPhaseResult {
  const prompt = rawPrompt.trim();
  if (!TRI_PHASE_ENABLED) {
    return { prompt: rawPrompt, applied: false, reason: "tri_phase_disabled" };
  }
  if (!prompt) {
    return { prompt: rawPrompt, applied: false, reason: "empty_prompt" };
  }
  if (isInteractiveCommand(prompt)) {
    return { prompt: rawPrompt, applied: false, reason: "interactive_command" };
  }
  if (!looksLikeEngineeringTask(prompt)) {
    return { prompt: rawPrompt, applied: false, reason: "non_engineering_task" };
  }
  if (/Plan\s*->\s*Execute\s*->\s*Review/i.test(prompt)) {
    return { prompt: rawPrompt, applied: false, reason: "already_wrapped" };
  }

  return {
    prompt: buildTriPhasePrompt(rawPrompt),
    applied: true,
    reason: "tri_phase_applied",
  };
}

