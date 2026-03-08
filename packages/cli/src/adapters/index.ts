import type { AgentType } from "../spawn";
import type { AdapterFn } from "./types";
import { claudeAdapter, resetClaudeState } from "./claude-adapter";
import { codexAdapter, resetCodexState } from "./codex-adapter";
import { geminiAdapter, resetGeminiState } from "./gemini-adapter";

export type { NormalizedEvent, AdapterFn } from "./types";

const adapters: Record<AgentType, AdapterFn> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

/** 获取指定 Agent 的输出解析适配器 */
export function getAdapter(agent: AgentType): AdapterFn {
  return adapters[agent] ?? adapters.claude;
}

/** 重置所有 adapter 内部状态（新会话时调用） */
export function resetAdapters() {
  resetClaudeState();
  resetCodexState();
  resetGeminiState();
}
