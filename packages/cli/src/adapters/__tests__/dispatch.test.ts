import { describe, it, expect, beforeEach } from "bun:test";
import { getAdapter, resetAdapters } from "../index";

describe("getAdapter registry", () => {
  beforeEach(() => resetAdapters());

  it("should return a function for claude", () => {
    const adapter = getAdapter("claude");
    expect(typeof adapter).toBe("function");
  });

  it("should return a function for codex", () => {
    const adapter = getAdapter("codex");
    expect(typeof adapter).toBe("function");
  });

  it("should return a function for gemini", () => {
    const adapter = getAdapter("gemini");
    expect(typeof adapter).toBe("function");
  });
});

describe("adapter → NormalizedEvent pipeline", () => {
  beforeEach(() => resetAdapters());

  it("claude adapter should produce correct events for a full conversation turn", () => {
    const adapter = getAdapter("claude");

    // 1. Assistant text
    const textEvents = adapter({
      type: "assistant",
      message: { content: [{ type: "text", text: "I'll read the file" }] },
    });
    expect(textEvents.some(e => e.kind === "text")).toBe(true);

    // 2. Tool use
    const toolEvents = adapter({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll read the file" },
          { type: "tool_use", name: "Read", input: { path: "a.ts" } },
        ],
      },
    });
    expect(toolEvents.some(e => e.kind === "tool_call")).toBe(true);

    // 3. Tool result
    const resultEvents = adapter({
      type: "result",
      subtype: "tool_result",
      tool_name: "Read",
      content: "file content",
    });
    expect(resultEvents.some(e => e.kind === "tool_result")).toBe(true);
  });

  it("codex adapter should produce correct events for command execution", () => {
    const adapter = getAdapter("codex");

    const started = adapter({
      type: "item.started",
      item: {
        id: "cmd_1", type: "command_execution",
        command: "echo hello",
      },
      item_type: "command_execution",
      item_id: "cmd_1",
    });

    const completed = adapter({
      type: "item.completed",
      item: {
        id: "cmd_1", type: "command_execution",
        command: "echo hello", exit_code: 0, output: "hello",
      },
      item_type: "command_execution",
      item_id: "cmd_1",
    });

    const kinds = [...started, ...completed].map(e => e.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
  });

  it("gemini adapter should produce correct events for streaming text", () => {
    const adapter = getAdapter("gemini");

    // Init
    const initEvents = adapter({ type: "init" });
    expect(initEvents[0].kind).toBe("status");

    // Streaming delta
    const deltaEvents = adapter({
      type: "message", role: "model", delta: true, text: "Here is the answer",
    });
    expect(deltaEvents[0]).toMatchObject({ kind: "text", partial: true });

    // Done
    const doneEvents = adapter({ type: "result" });
    expect(doneEvents.some(e => e.kind === "status")).toBe(true);
  });

  it("all adapters should handle malformed input without throwing", () => {
    for (const agent of ["claude", "codex", "gemini"] as const) {
      const adapter = getAdapter(agent);
      // Should not throw
      expect(() => adapter(null)).not.toThrow();
      expect(() => adapter(undefined)).not.toThrow();
      expect(() => adapter("not an object")).not.toThrow();
      expect(() => adapter(42)).not.toThrow();
      expect(() => adapter({})).not.toThrow();
    }
  });

  it("resetAdapters should clear internal state for all adapters", () => {
    const claude = getAdapter("claude");

    // Build up state
    claude({
      type: "assistant",
      message: { content: [{ type: "text", text: "partial text" }] },
    });

    // Reset
    resetAdapters();

    // After reset, same text should emit fully (not as empty delta)
    const events = claude({
      type: "assistant",
      message: { content: [{ type: "text", text: "partial text" }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "text", text: "partial text" });
  });
});
