import { describe, it, expect, beforeEach } from "bun:test";
import { claudeAdapter, resetClaudeState } from "../claude-adapter";

describe("claudeAdapter", () => {
  beforeEach(() => resetClaudeState());

  it("should parse assistant text blocks", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    };
    const events = claudeAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "text", text: "Hello world", partial: true });
  });

  it("should deduplicate partial text messages", () => {
    const msg1 = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    };
    const msg2 = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    };

    const ev1 = claudeAdapter(msg1);
    expect(ev1).toHaveLength(1);
    expect(ev1[0]).toMatchObject({ kind: "text", text: "Hello" });

    const ev2 = claudeAdapter(msg2);
    expect(ev2).toHaveLength(1);
    // Only the delta " world" should be emitted
    expect(ev2[0]).toMatchObject({ kind: "text", text: " world", partial: true });
  });

  it("should parse tool_use blocks", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { path: "/tmp/a.ts" } },
        ],
      },
    };
    const events = claudeAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_call",
      tool: "Read",
      params: { path: "/tmp/a.ts" },
      status: "running",
    });
  });

  it("should parse mixed text + tool_use in one message", () => {
    const msg = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me read that file" },
          { type: "tool_use", name: "Read", input: { path: "x.ts" } },
        ],
      },
    };
    const events = claudeAdapter(msg);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe("text");
    expect(events[1].kind).toBe("tool_call");
  });

  it("should emit thinking with turnId", () => {
    const msg = {
      type: "assistant",
      message: {
        id: "msg_turn_1",
        content: [{ type: "thinking", thinking: "先检查文件结构" }],
      },
    };
    const events = claudeAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "thinking",
      thinking: "先检查文件结构",
      turnId: "msg_turn_1",
    });
  });

  it("should deduplicate tool_use by id across partial assistant messages", () => {
    const msg1 = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "Read", input: { path: "a.ts" } }],
      },
    };
    const msg2 = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "Read", input: { path: "a.ts" } }],
      },
    };

    const ev1 = claudeAdapter(msg1);
    const ev2 = claudeAdapter(msg2);
    expect(ev1).toHaveLength(1);
    expect(ev1[0]).toMatchObject({ kind: "tool_call", toolUseId: "tu_1" });
    expect(ev2).toHaveLength(0);
  });

  it("should keep dedupe state after tool_result and clear only on turn-end result", () => {
    claudeAdapter({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_2", name: "Read", input: { path: "a.ts" } }],
      },
    });
    // tool_result 不应清理 seenToolUseIds
    claudeAdapter({
      type: "result",
      subtype: "tool_result",
      tool_name: "Read",
      content: "ok",
      tool_use_id: "tu_2",
    });
    const replayBeforeTurnEnd = claudeAdapter({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_2", name: "Read", input: { path: "a.ts" } }],
      },
    });
    expect(replayBeforeTurnEnd).toHaveLength(0);

    // turn-end result 后应清理，允许新一轮相同 id 重新发出
    claudeAdapter({ type: "result", result: "done" });
    const replayAfterTurnEnd = claudeAdapter({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_2", name: "Read", input: { path: "a.ts" } }],
      },
    });
    expect(replayAfterTurnEnd).toHaveLength(1);
    expect(replayAfterTurnEnd[0]).toMatchObject({ kind: "tool_call", toolUseId: "tu_2" });
  });

  it("should parse tool_result", () => {
    const msg = {
      type: "result",
      subtype: "tool_result",
      tool_name: "Read",
      content: "file contents here",
    };
    const events = claudeAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_result",
      tool: "Read",
      result: "file contents here",
      status: "done",
    });
  });

  it("should emit file_diff after Edit tool_result using tool_use context", () => {
    const callEvents = claudeAdapter({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tu_edit_1",
            name: "Edit",
            input: {
              file_path: "src/app.ts",
              old_string: "const a = 1;",
              new_string: "const a = 2;",
            },
          },
        ],
      },
    });
    expect(callEvents).toHaveLength(1);
    expect(callEvents[0]).toMatchObject({
      kind: "tool_call",
      tool: "Edit",
      toolUseId: "tu_edit_1",
    });

    const resultEvents = claudeAdapter({
      type: "result",
      subtype: "tool_result",
      tool_name: "Edit",
      content: "ok",
      tool_use_id: "tu_edit_1",
    });
    expect(resultEvents).toHaveLength(2);
    expect(resultEvents[0]).toMatchObject({
      kind: "file_diff",
      path: "src/app.ts",
      action: "modified",
    });
    expect(resultEvents[1]).toMatchObject({
      kind: "tool_result",
      tool: "Edit",
      toolUseId: "tu_edit_1",
    });
  });

  it("should parse hook events", () => {
    const msg = {
      type: "system",
      subtype: "hook",
      hook: "PreToolUse",
      message: "checking permissions",
      tool: "Write",
    };
    const events = claudeAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "hook_event",
      hook: "PreToolUse",
      event: "checking permissions",
      tool: "Write",
    });
  });

  it("should return raw for unknown message types", () => {
    const msg = { type: "unknown_type", data: 123 };
    const events = claudeAdapter(msg);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raw");
  });

  it("should handle null/undefined input gracefully", () => {
    expect(claudeAdapter(null)).toEqual([{ kind: "raw", data: null }]);
    expect(claudeAdapter(undefined)).toEqual([{ kind: "raw", data: undefined }]);
  });

  it("should reset partial buffer on non-tool result message", () => {
    // Build up partial text
    claudeAdapter({
      type: "assistant",
      message: { content: [{ type: "text", text: "partial" }] },
    });

    // turn-end result resets buffer
    claudeAdapter({ type: "result", result: "done" });

    // New text should emit fully (not as delta from "partial")
    const events = claudeAdapter({
      type: "assistant",
      message: { content: [{ type: "text", text: "fresh start" }] },
    });
    expect(events[0]).toMatchObject({ kind: "text", text: "fresh start" });
  });
});
