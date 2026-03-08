import type { AdapterFn, NormalizedEvent } from "./types";
import { fileDiffFromToolCall, fileDiffFromToolResult } from "./file-change";

/**
 * Claude Code adapter — 解析 `--output-format stream-json --verbose --include-partial-messages` 输出
 *
 * 关键消息类型：
 *  - assistant (含 text / tool_use blocks)
 *  - result (subtype: tool_result)
 *  - system (subtype: hook)
 */

let lastText = "";
let hadStreamedText = false;
let lastThinking = "";
const seenToolUseIds = new Set<string>();
const pendingFileDiffByToolUseId = new Map<string, Extract<NormalizedEvent, { kind: "file_diff" }>>();

export function resetClaudeState() {
  lastText = "";
  hadStreamedText = false;
  lastThinking = "";
  seenToolUseIds.clear();
  pendingFileDiffByToolUseId.clear();
}

export const claudeAdapter: AdapterFn = (raw) => {
  const msg = raw as Record<string, any>;
  if (!msg || typeof msg !== "object") return [{ kind: "raw", data: raw }];

  const events: NormalizedEvent[] = [];

  if (msg.type === "assistant") {
    const content: any[] = msg.message?.content ?? [];
    const turnId: string | undefined = msg.message?.id;

    // 提取 thinking blocks（full replace 语义）
    const thinkings = content.filter((b) => b.type === "thinking");
    const fullThinking = thinkings.map((b) => b.thinking ?? "").join("");
    if (fullThinking && fullThinking !== lastThinking) {
      events.push({ kind: "thinking", thinking: fullThinking, turnId });
      lastThinking = fullThinking;
    }

    // 提取 text blocks — 支持 partial message 增量去重
    const texts = content.filter((b) => b.type === "text");
    const fullText = texts.map((b) => b.text).join("");

    if (fullText && fullText !== lastText) {
      // 仅发送增量部分（如果启用了 --include-partial-messages）
      const delta = fullText.startsWith(lastText)
        ? fullText.slice(lastText.length)
        : fullText;

      if (delta) {
        events.push({ kind: "text", text: delta, partial: true });
        hadStreamedText = true;
      }
      lastText = fullText;
    }

    // 提取 tool_use blocks（按 tool_use.id 去重）
    const tools = content.filter((b) => b.type === "tool_use");
    for (const t of tools) {
      const toolUseId: string | undefined = t.id;
      if (toolUseId && seenToolUseIds.has(toolUseId)) continue;
      if (toolUseId) seenToolUseIds.add(toolUseId);

      const fileDiffPreview = fileDiffFromToolCall(t.name ?? "unknown", t.input ?? {});
      if (fileDiffPreview && toolUseId) {
        pendingFileDiffByToolUseId.set(toolUseId, fileDiffPreview);
      } else if (fileDiffPreview) {
        // 无 toolUseId 时无法与 result 关联，退化为即时预览
        events.push(fileDiffPreview);
      }

      events.push({
        kind: "tool_call",
        tool: t.name ?? "unknown",
        params: t.input ?? {},
        status: "running",
        toolUseId,
      });
    }
  } else if (msg.type === "result") {
    const isToolResult = msg.subtype === "tool_result";
    if (isToolResult) {
      const toolUseId = typeof msg.tool_use_id === "string" ? msg.tool_use_id : undefined;
      const fallback = toolUseId ? pendingFileDiffByToolUseId.get(toolUseId) : undefined;
      const resolvedDiff = fileDiffFromToolResult(msg.tool_name ?? "unknown", msg.content, fallback);
      if (resolvedDiff) events.push(resolvedDiff);
      if (toolUseId) pendingFileDiffByToolUseId.delete(toolUseId);

      const result = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
      events.push({
        kind: "tool_result",
        tool: msg.tool_name ?? "unknown",
        result,
        status: "done",
        toolUseId,
      });
    }

    // 仅在 turn 结束时清理去重状态；tool_result 期间不清理
    if (!isToolResult) {
      const wasStreamed = hadStreamedText;
      lastText = "";
      hadStreamedText = false;
      lastThinking = "";
      seenToolUseIds.clear();
      pendingFileDiffByToolUseId.clear();

      // 提取 usage 信息
      if (msg.usage) {
        events.push({
          kind: "usage",
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens ?? 0,
          cacheCreationTokens: msg.usage.cache_creation_input_tokens,
          cacheReadTokens: msg.usage.cache_read_input_tokens,
        });
      }

      // 仅在没有流式传输过文本时才发送 result（避免重复）
      if (msg.result && !wasStreamed) {
        events.push({ kind: "text", text: String(msg.result) });
      }
    }
  } else if (msg.type === "system" && msg.subtype === "hook") {
    events.push({
      kind: "hook_event",
      hook: msg.hook ?? "unknown",
      event: msg.message ?? "",
      tool: msg.tool,
    });
  } else {
    // 未知消息类型 → raw 兜底
    events.push({ kind: "raw", data: raw });
  }

  return events;
};
