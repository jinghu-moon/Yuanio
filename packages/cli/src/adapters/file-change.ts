import type { NormalizedEvent } from "./types";

type FileDiffEvent = Extract<NormalizedEvent, { kind: "file_diff" }>;

const MAX_PREVIEW_LINES = 120;
const MAX_PREVIEW_CHARS = 24_000;

const FILE_MUTATION_TOOLS = new Set([
  "write",
  "write_file",
  "edit",
  "replace",
  "edit_file",
  "multiedit",
  "notebookedit",
]);

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function pickString(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function takeLines(text: string, max = MAX_PREVIEW_LINES): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `... (${lines.length - max} lines truncated)`];
}

function capText(text: string, maxChars = MAX_PREVIEW_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (diff truncated)`;
}

function buildPreviewUnifiedDiff(path: string, oldText: string, newText: string): string {
  const oldLines = takeLines(oldText).map((line) => `-${line}`);
  const newLines = takeLines(newText).map((line) => `+${line}`);
  const diff = [
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ preview @@",
    ...oldLines,
    ...newLines,
  ].join("\n");
  return capText(diff);
}

function normalizeToolName(tool: string): string {
  return tool.trim().toLowerCase();
}

function inferActionByTool(tool: string): FileDiffEvent["action"] {
  const normalized = normalizeToolName(tool);
  if (normalized.includes("delete") || normalized.includes("remove")) return "deleted";
  return "modified";
}

function resolvePath(params: Record<string, unknown> | undefined): string | undefined {
  return pickString(params, [
    "file_path",
    "filePath",
    "path",
    "target_file",
    "targetFile",
    "notebook_path",
    "notebookPath",
  ]);
}

function resolveAction(raw: unknown, fallback: FileDiffEvent["action"]): FileDiffEvent["action"] {
  if (typeof raw !== "string") return fallback;
  const value = raw.toLowerCase();
  if (value === "created" || value === "create" || value === "add") return "created";
  if (value === "deleted" || value === "delete" || value === "remove") return "deleted";
  return "modified";
}

function looksLikeUnifiedDiff(text: string): boolean {
  return text.includes("\n@@") || text.startsWith("--- ") || text.startsWith("+++ ");
}

export function isFileMutationTool(tool: string): boolean {
  return FILE_MUTATION_TOOLS.has(normalizeToolName(tool));
}

/**
 * 从 tool_call 参数构造可展示的 file_diff 预览。
 * 注意：这是“意图级”预览，不保证与最终落盘完全一致。
 */
export function fileDiffFromToolCall(
  tool: string,
  params: Record<string, unknown> | undefined,
): FileDiffEvent | null {
  if (!isFileMutationTool(tool)) return null;
  const path = resolvePath(params);
  if (!path) return null;

  const normalized = normalizeToolName(tool);
  const oldString = pickString(params, ["old_string", "oldString", "before"]);
  const newString = pickString(params, ["new_string", "newString", "after"]);
  const content = pickString(params, ["content", "new_content", "newContent"]);
  const previous = pickString(params, ["previous_content", "previousContent"]);

  if (normalized === "edit" || normalized === "replace" || normalized === "edit_file" || normalized === "multiedit") {
    if (oldString || newString) {
      return {
        kind: "file_diff",
        path,
        diff: buildPreviewUnifiedDiff(path, oldString ?? "", newString ?? ""),
        action: "modified",
      };
    }
    return {
      kind: "file_diff",
      path,
      diff: capText(`--- a/${path}\n+++ b/${path}\n@@ preview @@\n+edit applied (no inline diff payload)`),
      action: "modified",
    };
  }

  if (normalized === "write" || normalized === "write_file") {
    if (content !== undefined) {
      const action: FileDiffEvent["action"] = previous === "" ? "created" : "modified";
      return {
        kind: "file_diff",
        path,
        diff: buildPreviewUnifiedDiff(path, previous ?? "", content),
        action,
      };
    }
    return {
      kind: "file_diff",
      path,
      diff: capText(`--- a/${path}\n+++ b/${path}\n@@ preview @@\n+write invoked`),
      action: "modified",
    };
  }

  // NotebookEdit 等结构化修改：退化为概要预览
  return {
    kind: "file_diff",
    path,
    diff: capText(`--- a/${path}\n+++ b/${path}\n@@ preview @@\n+${tool} invoked`),
    action: "modified",
  };
}

function fromStructuredObject(
  tool: string,
  obj: Record<string, unknown>,
  fallback?: FileDiffEvent,
): FileDiffEvent | null {
  const nestedValue = toRecord(obj.value);
  if (nestedValue) {
    const nested = fromStructuredObject(tool, nestedValue, fallback);
    if (nested) return nested;
  }

  const nestedData = toRecord(obj.data);
  if (nestedData) {
    const nested = fromStructuredObject(tool, nestedData, fallback);
    if (nested) return nested;
  }

  const nestedDisplay = toRecord(obj.resultDisplay);
  if (nestedDisplay) {
    const nested = fromStructuredObject(tool, nestedDisplay, fallback);
    if (nested) return nested;
  }

  const path = pickString(obj, ["filePath", "file_path", "path"]) ?? fallback?.path;
  const diff = pickString(obj, ["fileDiff", "file_diff", "diff"]);
  const explicitAction = pickString(obj, ["action", "operation", "kind"]);
  const isNewFile = obj.isNewFile === true;
  const isDeleted = obj.deleted === true;

  if (!path || !diff) return null;

  let action = fallback?.action ?? inferActionByTool(tool);
  if (isNewFile) action = "created";
  else if (isDeleted) action = "deleted";
  else action = resolveAction(explicitAction, action);

  return {
    kind: "file_diff",
    path,
    diff: capText(diff),
    action,
  };
}

/**
 * 从 tool_result 中提取结构化 file_diff；优先真实结果，失败时可回退到 tool_call 预览。
 */
export function fileDiffFromToolResult(
  tool: string,
  result: unknown,
  fallback?: FileDiffEvent,
): FileDiffEvent | null {
  if (result === null || result === undefined) return fallback ?? null;

  if (typeof result === "string") {
    const trimmed = result.trim();
    if (!trimmed) return fallback ?? null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return fileDiffFromToolResult(tool, parsed, fallback);
      } catch {
        // ignore and continue
      }
    }
    if (looksLikeUnifiedDiff(trimmed) && fallback?.path) {
      return {
        kind: "file_diff",
        path: fallback.path,
        diff: capText(trimmed),
        action: fallback.action,
      };
    }
    return fallback ?? null;
  }

  const obj = toRecord(result);
  if (!obj) return fallback ?? null;

  const fromStructured = fromStructuredObject(tool, obj, fallback);
  if (fromStructured) return fromStructured;

  return fallback ?? null;
}
