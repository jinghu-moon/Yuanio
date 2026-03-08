import type { IngressPromptSource } from "@yuanio/shared";
import type { AgentType } from "../spawn";

export interface RouteAgentInput {
  prompt: string;
  defaultAgent: AgentType;
  agentOverride?: AgentType;
  source?: IngressPromptSource;
  triedAgents?: AgentType[];
}

export interface RouteAgentResult {
  agent: AgentType;
  reason: string;
  strategy: "override" | "heuristic" | "default";
  fallbackChain: AgentType[];
  scores: Record<AgentType, number>;
}

const ALL_AGENTS: AgentType[] = ["claude", "codex", "gemini"];

const ROUTING_ENABLED = process.env.YUANIO_AGENT_ROUTING_ENABLED !== "0";
const ROUTING_VERBOSE = process.env.YUANIO_AGENT_ROUTING_VERBOSE === "1";
const MAX_ROUTING_RETRIES_RAW = Number(process.env.YUANIO_AGENT_ROUTING_MAX_RETRIES ?? 2);
export const MAX_ROUTING_RETRIES = Number.isFinite(MAX_ROUTING_RETRIES_RAW)
  ? Math.max(0, Math.floor(MAX_ROUTING_RETRIES_RAW))
  : 2;

const CODING_PATTERNS: RegExp[] = [
  /\bfix\b/i,
  /\bbug\b/i,
  /\brefactor\b/i,
  /\bimplement\b/i,
  /\bcompile\b/i,
  /\bbuild\b/i,
  /\btest\b/i,
  /\bandroid\b/i,
  /\bgradle\b/i,
  /\bkotlin\b/i,
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\bpython\b/i,
  /代码|实现|修复|重构|编译|测试|构建|安卓|开发/i,
];

const REVIEW_PATTERNS: RegExp[] = [
  /\bplan\b/i,
  /\breview\b/i,
  /\brca\b/i,
  /\barchitecture\b/i,
  /\bdesign\b/i,
  /方案|设计|架构|评审|复盘|根因分析|审查/i,
];

const RESEARCH_PATTERNS: RegExp[] = [
  /\bsearch\b/i,
  /\bresearch\b/i,
  /\bbenchmark\b/i,
  /\bcompare\b/i,
  /\bnews\b/i,
  /\bweb\b/i,
  /搜索|网页|调研|资料|对标|竞品|比较|最新/i,
];

function parseFallbackChain(value: string | undefined): AgentType[] {
  const raw = (value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const chain: AgentType[] = [];
  for (const item of raw) {
    if ((item === "claude" || item === "codex" || item === "gemini") && !chain.includes(item)) {
      chain.push(item);
    }
  }
  for (const agent of ALL_AGENTS) {
    if (!chain.includes(agent)) chain.push(agent);
  }
  return chain;
}

const DEFAULT_FALLBACK_CHAIN = parseFallbackChain(process.env.YUANIO_AGENT_FALLBACK_CHAIN);

function scorePrompt(prompt: string): Record<AgentType, number> {
  const text = prompt.trim();
  const scores: Record<AgentType, number> = {
    claude: 0,
    codex: 0,
    gemini: 0,
  };

  for (const pattern of CODING_PATTERNS) {
    if (pattern.test(text)) scores.codex += 2;
  }
  for (const pattern of REVIEW_PATTERNS) {
    if (pattern.test(text)) scores.claude += 2;
  }
  for (const pattern of RESEARCH_PATTERNS) {
    if (pattern.test(text)) scores.gemini += 2;
  }

  if (text.includes("```") || /[{}();]/.test(text)) scores.codex += 1;
  if (/lint|assemble|gradlew|ci|pipeline/i.test(text)) scores.codex += 1;
  if (/summary|总结|归纳|审阅|策略/i.test(text)) scores.claude += 1;
  if (/source|引用|citation|link|链接/i.test(text)) scores.gemini += 1;

  return scores;
}

function chooseByScores(scores: Record<AgentType, number>, defaultAgent: AgentType): AgentType {
  let best: AgentType = defaultAgent;
  let bestScore = scores[defaultAgent];
  for (const agent of ALL_AGENTS) {
    const score = scores[agent];
    if (score > bestScore) {
      best = agent;
      bestScore = score;
    }
  }
  return best;
}

function normalizeTriedAgents(input: AgentType[] | undefined): AgentType[] {
  if (!input || input.length === 0) return [];
  const set = new Set<AgentType>();
  for (const item of input) {
    if (item === "claude" || item === "codex" || item === "gemini") set.add(item);
  }
  return Array.from(set);
}

function resolveCandidateChain(primary: AgentType): AgentType[] {
  const chain: AgentType[] = [primary];
  for (const candidate of DEFAULT_FALLBACK_CHAIN) {
    if (!chain.includes(candidate)) chain.push(candidate);
  }
  for (const candidate of ALL_AGENTS) {
    if (!chain.includes(candidate)) chain.push(candidate);
  }
  return chain;
}

export function routeAgentForPrompt(input: RouteAgentInput): RouteAgentResult {
  const tried = normalizeTriedAgents(input.triedAgents);
  const hasOverride = input.agentOverride === "claude" || input.agentOverride === "codex" || input.agentOverride === "gemini";

  let primary: AgentType;
  let strategy: RouteAgentResult["strategy"];
  let reason: string;
  let scores: Record<AgentType, number> = { claude: 0, codex: 0, gemini: 0 };

  if (hasOverride) {
    primary = input.agentOverride as AgentType;
    strategy = "override";
    reason = `override:${primary}`;
  } else if (!ROUTING_ENABLED) {
    primary = input.defaultAgent;
    strategy = "default";
    reason = `routing_disabled:${input.defaultAgent}`;
  } else {
    scores = scorePrompt(input.prompt);
    primary = chooseByScores(scores, input.defaultAgent);
    strategy = "heuristic";
    reason = `heuristic:${primary}`;
  }

  const fallbackChain = resolveCandidateChain(primary);
  const selected = fallbackChain.find((agent) => !tried.includes(agent)) ?? primary;
  if (selected !== primary) {
    reason += `;retry:${selected}`;
  }

  if (ROUTING_VERBOSE) {
    console.log("[router] decision", {
      strategy,
      reason,
      selected,
      primary,
      tried,
      scores,
      source: input.source || "unknown",
      fallbackChain,
    });
  }

  return {
    agent: selected,
    reason,
    strategy,
    fallbackChain,
    scores,
  };
}

const RETRYABLE_PATTERNS: RegExp[] = [
  /\[spawn\]/i,
  /not found/i,
  /not in path/i,
  /exited with code 127/i,
  /rate limit/i,
  /quota/i,
  /too many requests/i,
  /\b429\b/,
  /\b503\b/,
  /service unavailable/i,
  /temporarily unavailable/i,
  /overloaded/i,
  /connection reset/i,
  /timeout/i,
];

export function isRetryableAgentFailure(errorText: string): boolean {
  const text = (errorText || "").trim();
  if (!text) return false;
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(text));
}

