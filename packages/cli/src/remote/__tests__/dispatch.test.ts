import { describe, it, expect } from "bun:test";
import { dispatchEvent } from "../dispatch";
import { MessageType } from "@yuanio/shared";
import type { NormalizedEvent } from "../../adapters";
import type { UsageInfo } from "@yuanio/shared";

describe("dispatch", () => {
  it("text 事件应逐条转发为 STREAM_CHUNK（保持顺序）", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    const taskUsageMap = new Map<string, UsageInfo>();
    const events: NormalizedEvent[] = [
      { kind: "text", text: "Hello ", partial: true },
      { kind: "text", text: "stream ", partial: true },
      { kind: "text", text: "world!" },
    ];

    for (const ev of events) {
      await dispatchEvent(ev, "claude", sendEnvelope, 0, "task_1", taskUsageMap);
    }

    expect(sent.map((x) => x.type)).toEqual([
      MessageType.STREAM_CHUNK,
      MessageType.STREAM_CHUNK,
      MessageType.STREAM_CHUNK,
    ]);
    expect(sent.map((x) => x.payload).join("")).toBe("Hello stream world!");
  });

  it("usage 累加并发送报告", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    const taskUsageMap = new Map<string, UsageInfo>();
    const ev: NormalizedEvent = { kind: "usage", inputTokens: 2, outputTokens: 3 };

    await dispatchEvent(ev, "claude", sendEnvelope, 0, "task_1", taskUsageMap);

    expect(taskUsageMap.get("task_1")).toEqual({ inputTokens: 2, outputTokens: 3 });
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe(MessageType.USAGE_REPORT);
    const payload = JSON.parse(sent[0].payload);
    expect(payload.taskId).toBe("task_1");
  });

  it("thinking 事件应转发为 THINKING 并携带 turnId", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    const taskUsageMap = new Map<string, UsageInfo>();
    const ev: NormalizedEvent = { kind: "thinking", thinking: "分析中", turnId: "turn_1" };
    await dispatchEvent(ev, "claude", sendEnvelope, 0, "task_1", taskUsageMap);

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(MessageType.THINKING);
    const payload = JSON.parse(sent[0].payload);
    expect(payload).toMatchObject({ thinking: "分析中", turnId: "turn_1", agent: "claude" });
  });

  it("tool_call/tool_result 应透传 toolUseId", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    const taskUsageMap = new Map<string, UsageInfo>();
    await dispatchEvent(
      { kind: "tool_call", tool: "Read", params: { path: "a.ts" }, status: "running", toolUseId: "tu_1" },
      "claude",
      sendEnvelope,
      0,
      "task_1",
      taskUsageMap,
    );
    await dispatchEvent(
      { kind: "tool_result", tool: "Read", result: "ok", status: "done", toolUseId: "tu_1" },
      "claude",
      sendEnvelope,
      0,
      "task_1",
      taskUsageMap,
    );

    expect(sent).toHaveLength(2);
    const running = JSON.parse(sent[0].payload);
    const done = JSON.parse(sent[1].payload);
    expect(running.toolUseId).toBe("tu_1");
    expect(done.toolUseId).toBe("tu_1");
  });

  it("status 默认不发送到 STREAM_CHUNK，避免污染正文", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    const taskUsageMap = new Map<string, UsageInfo>();
    const ev: NormalizedEvent = { kind: "status", message: "codex thread.started" };

    await dispatchEvent(ev, "codex", sendEnvelope, 0, "task_1", taskUsageMap);

    expect(sent).toHaveLength(0);
  });
});
