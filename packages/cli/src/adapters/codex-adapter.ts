import type { AdapterFn, NormalizedEvent } from "./types";
import { existsSync, readFileSync } from "node:fs";

/**
 * Codex adapter
 *
 * 同时兼容两类事件风格：
 * 1) exec --json 线程事件: thread.started / item.started / item.completed ...
 * 2) app-server 事件: agent_reasoning(_delta) / reasoning_content_delta / item_started ...
 */

const messageBuffers = new Map<string, string>();
const reasoningBuffers = new Map<string, string>();
const activeToolNames = new Map<string, string>();
const fileContentCache = new Map<string, string>();

const MAX_FALLBACK_DIFF_LINES = 120;
const MAX_FALLBACK_DIFF_CHARS = 24_000;

export function resetCodexState() {
  messageBuffers.clear();
  reasoningBuffers.clear();
  activeToolNames.clear();
  fileContentCache.clear();
}

export const codexAdapter: AdapterFn = (raw) => {
  const msg = raw as Record<string, any>;
  if (!msg || typeof msg !== "object") return [{ kind: "raw", data: raw }];

  const events: NormalizedEvent[] = [];
  const type = String(msg.type ?? msg.event ?? "");
  const item = resolveItem(msg);
  const itemType = resolveItemType(msg, item);
  const itemId = resolveItemId(msg, item);

  switch (type) {
    case "thread.started":
    case "thread_started":
    case "turn.started":
    case "turn_started":
    case "task_started": {
      fileContentCache.clear();
      events.push({ kind: "status", message: `codex ${type}` });
      break;
    }

    case "agent_reasoning":
    case "agent_reasoning_raw_content": {
      const turnId = (resolveReasoningTurnId(msg) ?? itemId) || "codex_reasoning";
      const full = extractReasoningText(msg);
      if (full) {
        reasoningBuffers.set(turnId, full);
        events.push({ kind: "thinking", thinking: full, turnId });
      }
      break;
    }

    case "agent_reasoning_delta":
    case "agent_reasoning_raw_content_delta":
    case "reasoning_content_delta": {
      const turnId = (resolveReasoningTurnId(msg) ?? itemId) || "codex_reasoning";
      const delta = extractReasoningDelta(msg);
      if (delta) {
        const prev = reasoningBuffers.get(turnId) ?? "";
        const next = prev + delta;
        reasoningBuffers.set(turnId, next);
        events.push({ kind: "thinking", thinking: next, turnId });
      }
      break;
    }

    case "item.started":
    case "item_started": {
      handleItemStarted(itemType, itemId, item, events);
      break;
    }

    case "item.updated":
    case "item_updated": {
      handleItemUpdated(itemType, itemId, item, events);
      break;
    }

    case "item.completed":
    case "item_completed": {
      handleItemCompleted(itemType, itemId, item, msg, events);
      messageBuffers.delete(itemId);
      reasoningBuffers.delete(itemId);
      activeToolNames.delete(itemId);
      break;
    }

    case "exec_command_begin": {
      const toolUseId = String(msg.call_id ?? msg.id ?? "");
      const command = extractCommandFromUnknown(msg.command)
        || extractCommandFromUnknown(msg.value)
        || extractCommandFromUnknown(msg)
        || "unknown";
      events.push({
        kind: "tool_call",
        tool: "command_execution",
        params: { command },
        status: "running",
        toolUseId: toolUseId || undefined,
      });
      if (toolUseId) activeToolNames.set(toolUseId, "command_execution");
      break;
    }

    case "exec_command_end": {
      const toolUseId = String(msg.call_id ?? msg.id ?? "");
      const exitCode = msg.exit_code ?? msg.value?.exit_code;
      const output = msg.output ?? msg.stdout ?? msg.value?.output ?? "";
      const isError = typeof exitCode === "number" && exitCode !== 0;
      events.push({
        kind: "tool_result",
        tool: activeToolNames.get(toolUseId) ?? "command_execution",
        result: typeof output === "string" ? output : JSON.stringify(output),
        status: isError ? "error" : "done",
        toolUseId: toolUseId || undefined,
      });
      if (toolUseId) activeToolNames.delete(toolUseId);
      break;
    }

    case "turn.completed":
    case "turn_completed":
    case "task_complete": {
      messageBuffers.clear();
      reasoningBuffers.clear();
      activeToolNames.clear();
      fileContentCache.clear();
      events.push({ kind: "status", message: "codex turn completed" });
      const usage = msg.usage ?? msg.value?.usage;
      if (usage) {
        events.push({
          kind: "usage",
          inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0,
          outputTokens: usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? usage.cacheCreationTokens,
          cacheReadTokens: usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? usage.cacheReadTokens,
        });
      }
      break;
    }

    case "turn.failed":
    case "turn_failed":
    case "turn_aborted": {
      messageBuffers.clear();
      reasoningBuffers.clear();
      activeToolNames.clear();
      fileContentCache.clear();
      events.push({
        kind: "error",
        message: extractErrorMessage(msg),
        fatal: true,
      });
      break;
    }

    case "error":
    case "stream_error": {
      messageBuffers.clear();
      reasoningBuffers.clear();
      activeToolNames.clear();
      fileContentCache.clear();
      events.push({
        kind: "error",
        message: extractErrorMessage(msg),
        fatal: true,
      });
      break;
    }

    default:
      events.push({ kind: "raw", data: raw });
  }

  return events;
};

function resolveItem(msg: Record<string, any>): Record<string, any> {
  const value = msg.item;
  return value && typeof value === "object" ? value : msg;
}

function resolveItemType(msg: Record<string, any>, item: Record<string, any>): string {
  return String(msg.item_type ?? item.type ?? item.item_type ?? "");
}

function resolveItemId(msg: Record<string, any>, item: Record<string, any>): string {
  return String(msg.item_id ?? item.id ?? msg.id ?? "");
}

function resolveReasoningTurnId(msg: Record<string, any>): string | undefined {
  const value = msg.value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const id = obj.id ?? obj.itemId ?? obj.item_id ?? obj.turnId ?? obj.turn_id;
    if (typeof id === "string" && id.trim().length > 0) return id;
  }
  for (const key of ["id", "item_id", "turn_id"] as const) {
    const raw = msg[key];
    if (typeof raw === "string" && raw.trim().length > 0) return raw;
  }
  return undefined;
}

function extractErrorMessage(msg: Record<string, any>): string {
  if (typeof msg.message === "string" && msg.message.trim().length > 0) return msg.message;
  if (typeof msg.error === "string" && msg.error.trim().length > 0) return msg.error;
  if (msg.error && typeof msg.error === "object" && typeof msg.error.message === "string") {
    return msg.error.message;
  }
  if (msg.value && typeof msg.value === "object" && typeof msg.value.message === "string") {
    return msg.value.message;
  }
  return "turn failed";
}

function extractText(item: Record<string, any>): string {
  if (typeof item.output_text === "string") return item.output_text;
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.content)) {
    return item.content
      .filter((b: any) => b.type === "output_text" || b.type === "text")
      .map((b: any) => b.text ?? "")
      .join("");
  }
  return "";
}

function extractReasoningText(msg: Record<string, any>): string {
  const value = msg.value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    const subject = typeof obj.subject === "string" ? obj.subject.trim() : "";
    const description = typeof obj.description === "string" ? obj.description.trim() : "";
    if (subject && description) return `${subject}\n${description}`;
    if (description) return description;
    if (subject) return subject;
  }
  const item = resolveItem(msg);
  if (typeof item.text === "string") return item.text;
  return "";
}

function extractReasoningDelta(msg: Record<string, any>): string {
  const value = msg.value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.delta === "string") return obj.delta;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
  }
  if (typeof msg.delta === "string") return msg.delta;
  if (typeof msg.text === "string") return msg.text;
  if (typeof msg.content === "string") return msg.content;
  return "";
}

function normalizeCommandValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeCommandValue(item))
      .filter((item) => item.length > 0);
    return parts.join(" ").trim();
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.program === "string") {
      const program = obj.program.trim();
      const args = normalizeCommandValue(obj.args);
      return args ? `${program} ${args}`.trim() : program;
    }
    const keys = ["command", "cmd", "shell_command", "input", "args", "argv", "script", "text"];
    for (const key of keys) {
      const next = normalizeCommandValue(obj[key]);
      if (next) return next;
    }
  }
  return "";
}

function extractCommandFromUnknown(value: unknown): string {
  const direct = normalizeCommandValue(value);
  if (direct) return direct;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("value" in obj) {
      const nested = normalizeCommandValue(obj.value);
      if (nested) return nested;
    }
  }
  return "";
}

function isToolItem(itemType: string): boolean {
  return itemType === "command_execution"
    || itemType === "mcp_tool_call"
    || itemType === "collab_tool_call"
    || itemType === "web_search";
}

function resolveToolFromItem(itemType: string, item: Record<string, any>): {
  tool: string;
  params: Record<string, unknown>;
} {
  switch (itemType) {
    case "command_execution":
      return {
        tool: "command_execution",
        params: { command: extractCommandFromUnknown(item) || "unknown" },
      };
    case "mcp_tool_call":
      return {
        tool: String(item.tool ?? "mcp_tool_call"),
        params: {
          server: item.server,
          arguments: item.arguments ?? {},
        },
      };
    case "collab_tool_call":
      return {
        tool: String(item.tool ?? "collab_tool_call"),
        params: {
          senderThreadId: item.sender_thread_id,
          receiverThreadIds: item.receiver_thread_ids,
          prompt: item.prompt,
        },
      };
    case "web_search":
      return {
        tool: "web_search",
        params: { query: item.query, action: item.action },
      };
    default:
      return { tool: "unknown", params: {} };
  }
}

function resolveToolResult(itemType: string, item: Record<string, any>, itemId: string): {
  tool: string;
  result: string;
  status: "done" | "error";
} {
  switch (itemType) {
    case "command_execution": {
      const exitCode = item.exit_code ?? item.exitCode;
      const status = item.status;
      const isError = status === "failed"
        || status === "declined"
        || (typeof exitCode === "number" && exitCode !== 0);
      const output = item.aggregated_output ?? item.output ?? item.stdout ?? "";
      return {
        tool: activeToolNames.get(itemId) ?? "command_execution",
        result: typeof output === "string" ? output : JSON.stringify(output),
        status: isError ? "error" : "done",
      };
    }
    case "mcp_tool_call": {
      const statusRaw = String(item.status ?? "");
      const isError = statusRaw === "failed";
      const resultPayload = item.error ?? item.result ?? "";
      return {
        tool: activeToolNames.get(itemId) ?? String(item.tool ?? "mcp_tool_call"),
        result: typeof resultPayload === "string"
          ? resultPayload
          : JSON.stringify(resultPayload),
        status: isError ? "error" : "done",
      };
    }
    case "collab_tool_call":
    case "web_search": {
      const statusRaw = String(item.status ?? "");
      const isError = statusRaw === "failed" || statusRaw === "errored";
      const resultPayload = item.result ?? item.error ?? item;
      return {
        tool: activeToolNames.get(itemId) ?? resolveToolFromItem(itemType, item).tool,
        result: typeof resultPayload === "string"
          ? resultPayload
          : JSON.stringify(resultPayload),
        status: isError ? "error" : "done",
      };
    }
    default:
      return {
        tool: activeToolNames.get(itemId) ?? "unknown",
        result: "",
        status: "done",
      };
  }
}

function handleItemStarted(
  itemType: string,
  itemId: string,
  item: Record<string, any>,
  events: NormalizedEvent[],
) {
  if (itemType === "agent_message") {
    messageBuffers.set(itemId, "");
    return;
  }
  if (itemType === "reasoning") {
    const text = extractReasoningText(item);
    if (text) {
      reasoningBuffers.set(itemId, text);
      events.push({ kind: "thinking", thinking: text, turnId: itemId || undefined });
    } else {
      reasoningBuffers.set(itemId, "");
    }
    return;
  }
  if (!isToolItem(itemType)) return;

  const { tool, params } = resolveToolFromItem(itemType, item);
  events.push({
    kind: "tool_call",
    tool,
    params,
    status: "running",
    toolUseId: itemId || undefined,
  });
  if (itemId) activeToolNames.set(itemId, tool);
}

function handleItemUpdated(
  itemType: string,
  itemId: string,
  item: Record<string, any>,
  events: NormalizedEvent[],
) {
  if (itemType === "agent_message") {
    const text = extractText(item);
    const prev = messageBuffers.get(itemId) ?? "";
    const delta = text.startsWith(prev) ? text.slice(prev.length) : text;
    if (delta.length > 5) {
      events.push({ kind: "text", text: delta, partial: true });
      messageBuffers.set(itemId, text);
    }
    return;
  }

  if (itemType === "reasoning") {
    const text = extractReasoningText(item);
    if (text) {
      const prev = reasoningBuffers.get(itemId) ?? "";
      if (text !== prev) {
        reasoningBuffers.set(itemId, text);
        events.push({ kind: "thinking", thinking: text, turnId: itemId || undefined });
      }
    }
  }
}

function handleItemCompleted(
  itemType: string,
  itemId: string,
  item: Record<string, any>,
  msg: Record<string, any>,
  events: NormalizedEvent[],
) {
  if (itemType === "agent_message") {
    const text = extractText(item);
    const prev = messageBuffers.get(itemId) ?? "";
    const remaining = text.startsWith(prev) ? text.slice(prev.length) : text;
    if (remaining) events.push({ kind: "text", text: remaining });
    return;
  }

  if (itemType === "reasoning") {
    const text = extractReasoningText(item);
    if (text) {
      const prev = reasoningBuffers.get(itemId) ?? "";
      if (text !== prev) {
        events.push({ kind: "thinking", thinking: text, turnId: itemId || undefined });
      }
    }
    return;
  }

  if (isToolItem(itemType)) {
    const toolResult = resolveToolResult(itemType, item, itemId);
    events.push({
      kind: "tool_result",
      tool: toolResult.tool,
      result: toolResult.result,
      status: toolResult.status,
      toolUseId: itemId || undefined,
    });
    return;
  }

  if (itemType === "file_change") {
    if (Array.isArray(item.changes) && item.changes.length > 0) {
      for (const change of item.changes) {
        const path = resolveChangePath(change) ?? "unknown";
        const action = resolveAction(change?.kind);
        const before = resolveBeforeContent(path, action);
        const after = resolveAfterContent(path, action);
        const diff = resolveDiffText(path, action, change?.diff ?? item.diff ?? item.content, before, after);
        events.push({
          kind: "file_diff",
          path,
          diff,
          action,
        });
        commitAfterContent(path, action, after);
      }
      return;
    }

    const op = item.operation ?? item.action ?? "modified";
    const action = resolveAction(op);
    const path = item.path ?? item.file ?? "unknown";
    const before = resolveBeforeContent(path, action);
    const after = resolveAfterContent(path, action);
    const diff = resolveDiffText(path, action, item.diff ?? item.content, before, after);
    events.push({
      kind: "file_diff",
      path,
      diff,
      action,
    });
    commitAfterContent(path, action, after);
    return;
  }

  events.push({ kind: "raw", data: msg });
}

function resolveChangePath(change: unknown): string | undefined {
  if (!change || typeof change !== "object") return undefined;
  const obj = change as Record<string, unknown>;
  if (typeof obj.path === "string" && obj.path.length > 0) return obj.path;
  return undefined;
}

function resolveAction(raw: unknown): "created" | "modified" | "deleted" {
  if (typeof raw === "string") {
    const value = raw.toLowerCase();
    if (value === "create" || value === "created" || value === "add") return "created";
    if (value === "delete" || value === "deleted" || value === "remove") return "deleted";
    return "modified";
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.type === "string") return resolveAction(obj.type);
    if (typeof obj.kind === "string") return resolveAction(obj.kind);
  }
  return "modified";
}

function resolveBeforeContent(
  path: string,
  action: "created" | "modified" | "deleted",
): string | undefined {
  if (fileContentCache.has(path)) return fileContentCache.get(path);
  if (action === "created") return "";
  return undefined;
}

function resolveAfterContent(
  path: string,
  action: "created" | "modified" | "deleted",
): string | undefined {
  if (action === "deleted") return "";
  return readTextSafe(path);
}

function commitAfterContent(
  path: string,
  action: "created" | "modified" | "deleted",
  after: string | undefined,
) {
  if (action === "deleted") {
    fileContentCache.delete(path);
    return;
  }
  if (typeof after === "string") {
    fileContentCache.set(path, after);
  }
}

function resolveDiffText(
  path: string,
  action: "created" | "modified" | "deleted",
  rawDiff: unknown,
  before: string | undefined,
  after: string | undefined,
): string {
  if (typeof rawDiff === "string" && rawDiff.trim().length > 0) return capText(rawDiff);

  if (action === "modified" && before === undefined) {
    return capText(`--- a/${path}\n+++ b/${path}\n@@ preview @@\n~modified (previous snapshot unavailable)`);
  }
  if (action === "deleted" && before === undefined) {
    return capText(`--- a/${path}\n+++ /dev/null\n@@ preview @@\n-deleted (content unavailable)`);
  }

  return buildPreviewUnifiedDiff(path, before ?? "", after ?? "");
}

function buildPreviewUnifiedDiff(path: string, oldText: string, newText: string): string {
  const oldLines = takeLines(oldText).map((line) => `-${line}`);
  const newLines = takeLines(newText).map((line) => `+${line}`);
  return capText([
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ preview @@",
    ...oldLines,
    ...newLines,
  ].join("\n"));
}

function takeLines(text: string, max = MAX_FALLBACK_DIFF_LINES): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `... (${lines.length - max} lines truncated)`];
}

function capText(text: string, maxChars = MAX_FALLBACK_DIFF_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (diff truncated)`;
}

function readTextSafe(path: string): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
