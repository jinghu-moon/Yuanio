import type { AdapterFn, NormalizedEvent } from "./types";
import { fileDiffFromToolCall, fileDiffFromToolResult } from "./file-change";

let textBuffer = "";
let hadStreamedText = false;
let lastThinking = "";
const activeToolNames = new Map<string, string>();
const pendingFileDiffByToolUseId = new Map<string, Extract<NormalizedEvent, { kind: "file_diff" }>>();

export function resetGeminiState() {
  textBuffer = "";
  hadStreamedText = false;
  lastThinking = "";
  activeToolNames.clear();
  pendingFileDiffByToolUseId.clear();
}

export const geminiAdapter: AdapterFn = (raw) => {
  const msg = raw as Record<string, any>;
  if (!msg || typeof msg !== "object") return [{ kind: "raw", data: raw }];

  const events: NormalizedEvent[] = [];
  const type = String(msg.type ?? msg.event ?? "");
  const normalizedType = type.toLowerCase();

  switch (normalizedType) {
    case "init":
    case "session": {
      events.push({ kind: "status", message: `gemini ${normalizedType}` });
      break;
    }

    case "thought":
    case "thinking": {
      const thinking = normalizeThinkingText(msg.value ?? msg.thought ?? msg.content);
      const turnId = resolveTurnId(msg);
      if (thinking && thinking !== lastThinking) {
        events.push({ kind: "thinking", thinking, turnId });
        lastThinking = thinking;
      }
      break;
    }

    case "message": {
      const role = String(msg.role ?? msg.message?.role ?? "").toLowerCase();
      if (role !== "model" && role !== "assistant") break;

      const delta = Boolean(msg.delta ?? msg.partial ?? false);
      const text = extractText(msg);
      if (!text) break;

      if (delta) {
        textBuffer += text;
        flushTextBuffer(events, false);
      } else {
        flushTextBuffer(events, true);
        events.push({ kind: "text", text });
        hadStreamedText = true;
      }
      break;
    }

    case "content": {
      const text = typeof msg.value === "string" ? msg.value : "";
      if (!text) break;
      textBuffer += text;
      flushTextBuffer(events, false);
      break;
    }

    case "tool_use":
    case "tool_call":
    case "tool_call_request": {
      const toolCall = parseToolCall(msg);
      const fileDiffPreview = fileDiffFromToolCall(toolCall.tool, toolCall.params);
      if (fileDiffPreview && toolCall.toolUseId) {
        pendingFileDiffByToolUseId.set(toolCall.toolUseId, fileDiffPreview);
      } else if (fileDiffPreview) {
        events.push(fileDiffPreview);
      }
      events.push({
        kind: "tool_call",
        tool: toolCall.tool,
        params: toolCall.params,
        status: "running",
        toolUseId: toolCall.toolUseId,
      });
      if (toolCall.toolUseId) activeToolNames.set(toolCall.toolUseId, toolCall.tool);
      break;
    }

    case "tool_result":
    case "tool_call_response": {
      const toolResult = parseToolResult(msg);
      const fallback = toolResult.toolUseId
        ? pendingFileDiffByToolUseId.get(toolResult.toolUseId)
        : undefined;
      const resolvedDiff = fileDiffFromToolResult(toolResult.tool, msg, fallback);
      if (resolvedDiff && toolResult.status !== "error") {
        events.push(resolvedDiff);
      }
      events.push({
        kind: "tool_result",
        tool: toolResult.tool,
        result: toolResult.result,
        status: toolResult.status,
        toolUseId: toolResult.toolUseId,
      });
      if (toolResult.toolUseId) {
        activeToolNames.delete(toolResult.toolUseId);
        pendingFileDiffByToolUseId.delete(toolResult.toolUseId);
      }
      break;
    }

    case "error": {
      const fatal = msg.severity === "fatal" || msg.fatal === true;
      events.push({
        kind: "error",
        message: extractErrorMessage(msg),
        fatal,
      });
      break;
    }

    case "result":
    case "done":
    case "finished": {
      flushTextBuffer(events, true);

      const text = extractText(msg);
      if (text && !hadStreamedText) {
        events.push({ kind: "text", text });
      }

      const usage = msg.usage ?? msg.usageMetadata ?? msg.stats ?? msg.value?.usageMetadata;
      if (usage && typeof usage === "object") {
        events.push({
          kind: "usage",
          inputTokens: usage.input_tokens ?? usage.promptTokenCount ?? usage.input_tokens_total ?? usage.input_tokens_used ?? usage.input_tokens_count ?? usage.inputTokens ?? 0,
          outputTokens: usage.output_tokens ?? usage.candidatesTokenCount ?? usage.output_tokens_total ?? usage.output_tokens_used ?? usage.output_tokens_count ?? usage.outputTokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? usage.cachedContentTokenCount,
          cacheReadTokens: usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? usage.cached,
        });
      }

      events.push({ kind: "status", message: "gemini done" });

      textBuffer = "";
      hadStreamedText = false;
      lastThinking = "";
      activeToolNames.clear();
      pendingFileDiffByToolUseId.clear();
      break;
    }

    default:
      events.push({ kind: "raw", data: raw });
  }

  return events;
};

function extractText(msg: Record<string, any>): string {
  const direct = msg.text ?? msg.content ?? msg.message?.text;
  return typeof direct === "string" ? direct : "";
}

function resolveTurnId(msg: Record<string, any>): string | undefined {
  const direct = msg.turnId ?? msg.turn_id ?? msg.id ?? msg.traceId ?? msg.trace_id;
  if (typeof direct === "string" && direct.trim().length > 0) return direct;
  const value = toRecord(msg.value);
  if (!value) return undefined;
  const id = value.turnId ?? value.turn_id ?? value.id ?? value.traceId ?? value.trace_id;
  return typeof id === "string" && id.trim().length > 0 ? id : undefined;
}

function normalizeThinkingText(value: unknown): string {
  if (typeof value === "string") return value;
  const obj = toRecord(value);
  if (!obj) return "";
  if (typeof obj.text === "string") return obj.text;

  const subject = typeof obj.subject === "string" ? obj.subject.trim() : "";
  const description = typeof obj.description === "string" ? obj.description.trim() : "";
  if (subject && description) return `${subject}\n${description}`;
  if (description) return description;
  if (subject) return subject;
  return "";
}

function parseToolCall(msg: Record<string, any>): {
  tool: string;
  params: Record<string, unknown>;
  toolUseId?: string;
} {
  const value = toRecord(msg.value);
  const tool = firstString(
    value?.name,
    msg.name,
    msg.tool_name,
    msg.tool,
  ) ?? "unknown";
  const paramsRaw = value?.args ?? msg.args ?? msg.input ?? msg.params ?? msg.parameters;
  const params = toRecord(paramsRaw) ?? {};
  const toolUseId = firstString(
    value?.callId,
    value?.call_id,
    msg.callId,
    msg.call_id,
    msg.tool_id,
  );
  return { tool, params, toolUseId };
}

function parseToolResult(msg: Record<string, any>): {
  tool: string;
  result: string;
  status: "done" | "error";
  toolUseId?: string;
} {
  const value = toRecord(msg.value);
  const toolUseId = firstString(
    value?.callId,
    value?.call_id,
    msg.callId,
    msg.call_id,
    msg.tool_id,
  );

  const explicitTool = firstString(
    value?.name,
    msg.name,
    msg.tool_name,
    msg.tool,
  );
  const tool = explicitTool ?? (toolUseId ? activeToolNames.get(toolUseId) : undefined) ?? "unknown";

  const errorValue = value?.error ?? msg.error;
  const hasError = msg.status === "error"
    || msg.status === "failed"
    || errorValue !== undefined;
  const status: "done" | "error" = hasError ? "error" : "done";

  const display = value?.resultDisplay ?? value?.output ?? msg.output ?? msg.result ?? msg.content;
  let result = "";
  if (typeof display === "string") {
    result = display;
  } else if (display !== undefined) {
    result = JSON.stringify(display);
  } else if (typeof errorValue === "string") {
    result = errorValue;
  } else if (errorValue && typeof errorValue === "object" && "message" in errorValue) {
    const errMsg = (errorValue as Record<string, unknown>).message;
    result = typeof errMsg === "string" ? errMsg : JSON.stringify(errorValue);
  }

  return { tool, result, status, toolUseId };
}

function extractErrorMessage(msg: Record<string, any>): string {
  if (typeof msg.message === "string" && msg.message.trim().length > 0) return msg.message;
  if (typeof msg.error === "string" && msg.error.trim().length > 0) return msg.error;
  const value = toRecord(msg.value);
  const nested = value?.error;
  if (typeof nested === "string" && nested.trim().length > 0) return nested;
  if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).message === "string") {
    return (nested as Record<string, unknown>).message as string;
  }
  return "unknown error";
}

function toRecord(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, any>;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function flushTextBuffer(events: NormalizedEvent[], force: boolean) {
  while (textBuffer.length > 0) {
    const splitPoint = findLastSafeSplitPoint(textBuffer);
    if (splitPoint === 0) {
      if (force) {
        events.push({ kind: "text", text: textBuffer, partial: true });
        hadStreamedText = true;
        textBuffer = "";
      }
      return;
    }

    const emitText = splitPoint >= textBuffer.length
      ? textBuffer
      : textBuffer.slice(0, splitPoint);
    if (emitText.length > 0) {
      events.push({ kind: "text", text: emitText, partial: true });
      hadStreamedText = true;
    }

    if (splitPoint >= textBuffer.length) {
      textBuffer = "";
      return;
    }
    textBuffer = textBuffer.slice(splitPoint);
  }
}

function findLastSafeSplitPoint(content: string): number {
  const enclosingBlockStart = findEnclosingCodeBlockStart(content, content.length);
  if (enclosingBlockStart !== -1) {
    return enclosingBlockStart;
  }

  let searchStartIndex = content.length;
  while (searchStartIndex >= 0) {
    const dnlIndex = content.lastIndexOf("\n\n", searchStartIndex);
    if (dnlIndex === -1) break;
    const splitPoint = dnlIndex + 2;
    if (!isIndexInsideCodeBlock(content, splitPoint)) {
      return splitPoint;
    }
    searchStartIndex = dnlIndex - 1;
  }

  return content.length;
}

function findEnclosingCodeBlockStart(content: string, index: number): number {
  if (!isIndexInsideCodeBlock(content, index)) return -1;
  let currentSearchPos = 0;
  while (currentSearchPos < index) {
    const blockStart = content.indexOf("```", currentSearchPos);
    if (blockStart === -1 || blockStart >= index) break;
    const blockEnd = content.indexOf("```", blockStart + 3);
    if (blockStart < index && (blockEnd === -1 || index < blockEnd + 3)) {
      return blockStart;
    }
    if (blockEnd === -1) break;
    currentSearchPos = blockEnd + 3;
  }
  return -1;
}

function isIndexInsideCodeBlock(content: string, indexToTest: number): boolean {
  let fenceCount = 0;
  let searchPos = 0;
  while (searchPos < content.length) {
    const nextFence = content.indexOf("```", searchPos);
    if (nextFence === -1 || nextFence >= indexToTest) break;
    fenceCount += 1;
    searchPos = nextFence + 3;
  }
  return fenceCount % 2 === 1;
}
