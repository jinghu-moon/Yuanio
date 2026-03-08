import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { codexAdapter, resetCodexState } from "../codex-adapter";

describe("codexAdapter", () => {
  beforeEach(() => resetCodexState());

  it("should parse thread.started as status", () => {
    const events = codexAdapter({ type: "thread.started" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", message: "codex thread.started" });
  });

  it("should parse turn.started as status", () => {
    const events = codexAdapter({ type: "turn.started" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status" });
  });

  it("should handle item.started for agent_message (no emit)", () => {
    const events = codexAdapter({
      type: "item.started",
      item: { id: "msg_1", type: "agent_message" },
      item_type: "agent_message",
    });
    // item.started 只初始化 buffer，不产生事件
    expect(events).toHaveLength(0);
  });

  it("should emit partial text on item.updated when delta > 5 chars", () => {
    // 先 started 初始化 buffer
    codexAdapter({
      type: "item.started",
      item: { id: "msg_1", type: "agent_message" },
      item_type: "agent_message",
    });

    const events = codexAdapter({
      type: "item.updated",
      item: { id: "msg_1", type: "agent_message", output_text: "Hello World!" },
      item_type: "agent_message",
      item_id: "msg_1",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "text", text: "Hello World!", partial: true });
  });

  it("should suppress small deltas (< 5 chars) on item.updated", () => {
    codexAdapter({
      type: "item.started",
      item: { id: "msg_2", type: "agent_message" },
      item_type: "agent_message",
    });
    // First update with enough text
    codexAdapter({
      type: "item.updated",
      item: { id: "msg_2", type: "agent_message", output_text: "Hello World" },
      item_type: "agent_message",
      item_id: "msg_2",
    });
    // Second update with only 1 char delta
    const events = codexAdapter({
      type: "item.updated",
      item: { id: "msg_2", type: "agent_message", output_text: "Hello World!" },
      item_type: "agent_message",
      item_id: "msg_2",
    });
    expect(events).toHaveLength(0); // delta "!" is only 1 char
  });

  it("should emit remaining text on item.completed (agent_message)", () => {
    codexAdapter({
      type: "item.started",
      item: { id: "msg_3", type: "agent_message" },
      item_type: "agent_message",
    });
    // Partial update
    codexAdapter({
      type: "item.updated",
      item: { id: "msg_3", type: "agent_message", output_text: "Hello World" },
      item_type: "agent_message",
      item_id: "msg_3",
    });
    // Completed with final text
    const events = codexAdapter({
      type: "item.completed",
      item: { id: "msg_3", type: "agent_message", output_text: "Hello World! Done." },
      item_type: "agent_message",
      item_id: "msg_3",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "text", text: "! Done." });
  });

  it("should parse item.completed (command_execution, success)", () => {
    const events = codexAdapter({
      type: "item.completed",
      item: {
        id: "cmd_1",
        type: "command_execution",
        command: "ls -la",
        status: "completed",
        exit_code: 0,
        aggregated_output: "total 42\ndrwxr-xr-x ...",
      },
      item_type: "command_execution",
      item_id: "cmd_1",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_result",
      tool: "command_execution",
      result: "total 42\ndrwxr-xr-x ...",
      status: "done",
      toolUseId: "cmd_1",
    });
  });

  it("should parse item.completed (command_execution, error)", () => {
    const events = codexAdapter({
      type: "item.completed",
      item: {
        id: "cmd_2", type: "command_execution",
        command: "rm -rf /nope", status: "failed", exit_code: 1, aggregated_output: "permission denied",
      },
      item_type: "command_execution",
      item_id: "cmd_2",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_result",
      status: "error",
      toolUseId: "cmd_2",
    });
  });

  it("should map command_execution lifecycle to running + result with toolUseId", () => {
    const started = codexAdapter({
      type: "item.started",
      item: {
        id: "cmd_3",
        type: "command_execution",
        command: "npm test",
      },
      item_type: "command_execution",
      item_id: "cmd_3",
    });

    const completed = codexAdapter({
      type: "item.completed",
      item: {
        id: "cmd_3",
        type: "command_execution",
        command: "npm test",
        status: "completed",
        exit_code: 0,
        aggregated_output: "ok",
      },
      item_type: "command_execution",
      item_id: "cmd_3",
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      kind: "tool_call",
      tool: "command_execution",
      status: "running",
      toolUseId: "cmd_3",
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      kind: "tool_result",
      status: "done",
      toolUseId: "cmd_3",
    });
  });

  it("should normalize command_execution params from nested arrays", () => {
    const started = codexAdapter({
      type: "item.started",
      item: {
        id: "cmd_4",
        type: "command_execution",
        input: {
          command: ["rg", "--line-number", "TODO", "src"],
        },
      },
      item_type: "command_execution",
      item_id: "cmd_4",
    });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      kind: "tool_call",
      tool: "command_execution",
      params: { command: "rg --line-number TODO src" },
      toolUseId: "cmd_4",
    });
  });

  it("should normalize exec_command_begin command from value payload", () => {
    const started = codexAdapter({
      type: "exec_command_begin",
      id: "call_1",
      value: {
        command: ["powershell", "-NoProfile", "-Command", "Get-ChildItem"],
      },
    });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      kind: "tool_call",
      tool: "command_execution",
      params: { command: "powershell -NoProfile -Command Get-ChildItem" },
      toolUseId: "call_1",
    });
  });

  it("should map reasoning item to thinking event", () => {
    const events = codexAdapter({
      type: "item.updated",
      item: {
        id: "rs_1",
        type: "reasoning",
        text: "正在分析代码依赖",
      },
      item_type: "reasoning",
      item_id: "rs_1",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "thinking",
      thinking: "正在分析代码依赖",
      turnId: "rs_1",
    });
  });

  it("should parse item.completed (file_change, create)", () => {
    const events = codexAdapter({
      type: "item.completed",
      item: {
        id: "fc_1", type: "file_change",
        operation: "create", path: "src/new.ts",
        diff: "+export const x = 1;",
      },
      item_type: "file_change",
      item_id: "fc_1",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "file_diff",
      path: "src/new.ts",
      action: "created",
    });
  });

  it("should map file_change overwrite → modified", () => {
    const events = codexAdapter({
      type: "item.completed",
      item: { id: "fc_2", type: "file_change", operation: "overwrite", path: "a.ts", diff: "..." },
      item_type: "file_change",
      item_id: "fc_2",
    });
    expect(events[0]).toMatchObject({ kind: "file_diff", action: "modified" });
  });

  it("should map file_change delete → deleted", () => {
    const events = codexAdapter({
      type: "item.completed",
      item: { id: "fc_3", type: "file_change", operation: "delete", path: "old.ts", diff: "" },
      item_type: "file_change",
      item_id: "fc_3",
    });
    expect(events[0]).toMatchObject({ kind: "file_diff", action: "deleted" });
  });

  it("should parse file_change with official changes[] format", () => {
    const events = codexAdapter({
      type: "item.completed",
      item: {
        id: "fc_4",
        type: "file_change",
        status: "completed",
        changes: [
          { path: "src/new.ts", kind: "add" },
          { path: "src/app.ts", kind: "update" },
          { path: "src/old.ts", kind: "delete" },
        ],
      },
      item_type: "file_change",
      item_id: "fc_4",
    });
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: "file_diff", path: "src/new.ts", action: "created" });
    expect(events[1]).toMatchObject({ kind: "file_diff", path: "src/app.ts", action: "modified" });
    expect(events[2]).toMatchObject({ kind: "file_diff", path: "src/old.ts", action: "deleted" });
  });

  it("should prefer change.diff when official changes[] includes per-change diff", () => {
    const events = codexAdapter({
      type: "item.completed",
      item: {
        id: "fc_5",
        type: "file_change",
        status: "completed",
        changes: [
          { path: "src/a.ts", kind: "add", diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@\n+export const a = 1;" },
          { path: "src/b.ts", kind: "update", diff: "--- a/src/b.ts\n+++ b/src/b.ts\n@@\n-old\n+new" },
        ],
      },
      item_type: "file_change",
      item_id: "fc_5",
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "file_diff", path: "src/a.ts", action: "created" });
    expect(events[1]).toMatchObject({ kind: "file_diff", path: "src/b.ts", action: "modified" });
    expect(events[0]).toMatchObject({ diff: expect.stringContaining("+++ b/src/a.ts") });
    expect(events[1]).toMatchObject({ diff: expect.stringContaining("+new") });
  });

  it("should build fallback diff from local snapshot when change.diff is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "yuanio-codex-adapter-"));
    try {
      const filePath = join(dir, "snapshot.txt");
      writeFileSync(filePath, "alpha\nbeta\n", "utf8");

      const created = codexAdapter({
        type: "item.completed",
        item: {
          id: "fc_6_create",
          type: "file_change",
          status: "completed",
          changes: [{ path: filePath, kind: "add" }],
        },
        item_type: "file_change",
        item_id: "fc_6_create",
      });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        kind: "file_diff",
        action: "created",
        diff: expect.stringContaining("+alpha"),
      });

      writeFileSync(filePath, "alpha\nbeta-updated\n", "utf8");
      const updated = codexAdapter({
        type: "item.completed",
        item: {
          id: "fc_6_update",
          type: "file_change",
          status: "completed",
          changes: [{ path: filePath, kind: "update" }],
        },
        item_type: "file_change",
        item_id: "fc_6_update",
      });
      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({
        kind: "file_diff",
        action: "modified",
      });
      const updatedDiff = (updated[0] as { diff: string }).diff;
      expect(updatedDiff.includes("-beta")).toBe(true);
      expect(updatedDiff.includes("+beta-updated")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should parse turn.completed as status and clear buffers", () => {
    const events = codexAdapter({ type: "turn.completed" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", message: "codex turn completed" });
  });

  it("should parse turn.completed usage with cached_input_tokens", () => {
    const events = codexAdapter({
      type: "turn.completed",
      usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 80 },
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      kind: "usage",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
    });
  });

  it("should parse turn.failed as fatal error", () => {
    const events = codexAdapter({ type: "turn.failed", message: "context too long" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "error",
      message: "context too long",
      fatal: true,
    });
  });

  it("should parse turn.failed error object message", () => {
    const events = codexAdapter({ type: "turn.failed", error: { message: "network timeout" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "error",
      message: "network timeout",
      fatal: true,
    });
  });

  it("should parse top-level error event", () => {
    const events = codexAdapter({ type: "error", message: "stream aborted" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "error",
      message: "stream aborted",
      fatal: true,
    });
  });

  it("should return raw for unknown types", () => {
    const events = codexAdapter({ type: "unknown.event", foo: "bar" });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raw");
  });

  it("should handle null input", () => {
    expect(codexAdapter(null)).toEqual([{ kind: "raw", data: null }]);
  });
});
