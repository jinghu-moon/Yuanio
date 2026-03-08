import type { AgentType } from "../spawn";

/** 所有事件共享的元数据 */
interface EventMeta {
  timestamp?: number;
  seq?: number;
  agent?: AgentType;
  partial?: boolean;
}

export type NormalizedEvent = EventMeta & (
  | { kind: "text"; text: string }
  | { kind: "thinking"; thinking: string; turnId?: string }
  | { kind: "tool_call"; tool: string; params: Record<string, unknown>; status: "running" | "done" | "error"; toolUseId?: string }
  | { kind: "tool_result"; tool: string; result: string; status: "done" | "error"; toolUseId?: string }
  | { kind: "file_diff"; path: string; diff: string; action: "created" | "modified" | "deleted" }
  | { kind: "hook_event"; hook: string; event: string; tool?: string }
  | { kind: "error"; message: string; fatal: boolean }
  | { kind: "status"; message: string }
  | { kind: "usage"; inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number }
  | { kind: "raw"; data: unknown }
);

/** Adapter 接口：一条原始消息 → 零或多个归一化事件 */
export type AdapterFn = (raw: unknown) => NormalizedEvent[];
