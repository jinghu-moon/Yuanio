import { describe, it, expect, beforeEach } from "bun:test";
import { geminiAdapter, resetGeminiState } from "../gemini-adapter";

describe("geminiAdapter", () => {
  beforeEach(() => resetGeminiState());

  it("should parse init as status", () => {
    const events = geminiAdapter({ type: "init" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", message: "gemini init" });
  });

  it("should parse session as status", () => {
    const events = geminiAdapter({ type: "session" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status" });
  });

  it("should parse model message delta as partial text", () => {
    const msg = { type: "message", role: "model", delta: true, text: "Hello" };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "text", text: "Hello", partial: true });
  });

  it("should parse non-delta model message as full text", () => {
    const msg = { type: "message", role: "model", delta: false, text: "Complete response" };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "text", text: "Complete response" });
    expect((events[0] as any).partial).toBeUndefined();
  });

  it("should parse tool_use as tool_call running", () => {
    const msg = { type: "tool_use", name: "search", args: { query: "test" } };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_call",
      tool: "search",
      params: { query: "test" },
      status: "running",
    });
  });

  it("should parse thought as thinking", () => {
    const msg = {
      type: "thought",
      value: { subject: "分析", description: "先读取关键文件" },
      traceId: "turn_1",
    };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "thinking",
      thinking: "分析\n先读取关键文件",
      turnId: "turn_1",
    });
  });

  it("should parse tool_call_request with callId", () => {
    const msg = {
      type: "tool_call_request",
      value: {
        callId: "call_1",
        name: "read_file",
        args: { path: "README.md" },
      },
    };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_call",
      tool: "read_file",
      params: { path: "README.md" },
      status: "running",
      toolUseId: "call_1",
    });
  });

  it("should parse tool_result as done", () => {
    const msg = { type: "tool_result", name: "search", output: "found 3 results" };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_result",
      tool: "search",
      result: "found 3 results",
      status: "done",
    });
  });

  it("should parse tool_call_response and preserve callId mapping", () => {
    // 先发 request 建立 callId -> tool 映射
    geminiAdapter({
      type: "tool_call_request",
      value: { callId: "call_2", name: "search", args: { q: "test" } },
    });

    const msg = {
      type: "tool_call_response",
      value: {
        callId: "call_2",
        resultDisplay: "found 2 results",
      },
    };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_result",
      tool: "search",
      result: "found 2 results",
      status: "done",
      toolUseId: "call_2",
    });
  });

  it("should emit file_diff from tool_call_response resultDisplay", () => {
    geminiAdapter({
      type: "tool_call_request",
      value: {
        callId: "call_write_1",
        name: "write_file",
        args: {
          file_path: "src/new.ts",
          content: "export const x = 1;",
        },
      },
    });

    const events = geminiAdapter({
      type: "tool_call_response",
      value: {
        callId: "call_write_1",
        resultDisplay: {
          filePath: "src/new.ts",
          fileDiff: "--- a/src/new.ts\n+++ b/src/new.ts\n@@\n+export const x = 1;",
          isNewFile: true,
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "file_diff",
      path: "src/new.ts",
      action: "created",
    });
    expect(events[1]).toMatchObject({
      kind: "tool_result",
      tool: "write_file",
      toolUseId: "call_write_1",
      status: "done",
    });
  });

  it("should parse tool_result with error", () => {
    const msg = { type: "tool_result", name: "search", output: "fail", error: true };
    const events = geminiAdapter(msg);
    expect(events[0]).toMatchObject({ kind: "tool_result", status: "error" });
  });

  it("should parse fatal error", () => {
    const msg = { type: "error", severity: "fatal", message: "API key invalid" };
    const events = geminiAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error", message: "API key invalid", fatal: true });
  });

  it("should parse non-fatal error", () => {
    const msg = { type: "error", severity: "warning", message: "rate limited" };
    const events = geminiAdapter(msg);
    expect(events[0]).toMatchObject({ kind: "error", fatal: false });
  });

  it("should parse result/done as status", () => {
    const events = geminiAdapter({ type: "result" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", message: "gemini done" });
  });

  it("should parse result stats usage fields", () => {
    const events = geminiAdapter({
      type: "result",
      stats: { input_tokens: 12, output_tokens: 7, cached: 3 },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: "usage",
      inputTokens: 12,
      outputTokens: 7,
      cacheReadTokens: 3,
    });
    expect(events[1]).toMatchObject({ kind: "status", message: "gemini done" });
  });

  it("should return raw for unknown types", () => {
    const events = geminiAdapter({ type: "mystery", data: 42 });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raw");
  });

  it("should handle null input", () => {
    expect(geminiAdapter(null)).toEqual([{ kind: "raw", data: null }]);
  });
});
