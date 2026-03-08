import { beforeEach, describe, expect, it } from "bun:test";
import { MessageType } from "@yuanio/shared";
import type { UsageInfo } from "@yuanio/shared";
import { getAdapter, resetAdapters } from "../../adapters";
import type { AgentType } from "../../spawn";
import { dispatchEvent } from "../dispatch";

type Sent = { type: MessageType; payload: string };

async function replay(agent: AgentType, frames: unknown[]): Promise<{
  sent: Sent[];
  chunkText: string;
  usage?: UsageInfo;
}> {
  const sent: Sent[] = [];
  const usageMap = new Map<string, UsageInfo>();
  let statusCount = 0;

  const sendEnvelope = async (type: MessageType, plaintext: string) => {
    sent.push({ type, payload: plaintext });
  };

  const adapter = getAdapter(agent);
  for (const raw of frames) {
    const events = adapter(raw);
    for (const ev of events) {
      await dispatchEvent(ev, agent, sendEnvelope, statusCount, "task_replay", usageMap);
      if (ev.kind === "status") statusCount++;
    }
  }

  const chunkText = sent
    .filter((x) => x.type === MessageType.STREAM_CHUNK)
    .map((x) => x.payload)
    .join("");

  return {
    sent,
    chunkText,
    usage: usageMap.get("task_replay"),
  };
}

describe("stream replay (adapter + dispatch)", () => {
  beforeEach(() => resetAdapters());

  it("Claude 回放应保持增量顺序并输出完整文本", async () => {
    const frames = [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello world" }] },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello world!" },
            { type: "tool_use", name: "Read", input: { path: "README.md" } },
          ],
        },
      },
      {
        type: "result",
        subtype: "tool_result",
        tool_name: "Read",
        content: "ok",
      },
      {
        type: "result",
        usage: { input_tokens: 10, output_tokens: 3 },
      },
    ];

    const res = await replay("claude", frames);
    expect(res.chunkText).toBe("Hello world!");
    expect(res.sent.some((x) => x.type === MessageType.TOOL_CALL)).toBe(true);
    expect(res.sent.some((x) => x.type === MessageType.USAGE_REPORT)).toBe(true);
  });

  it("Codex 回放应在 status 过滤下只输出正文 chunk", async () => {
    const frames = [
      { type: "thread.started", thread_id: "t1" },
      { type: "turn.started" },
      {
        type: "item.started",
        item: { id: "item_1", type: "agent_message" },
      },
      {
        type: "item.updated",
        item: { id: "item_1", type: "agent_message", output_text: "Hello" },
      },
      {
        type: "item.updated",
        item: { id: "item_1", type: "agent_message", output_text: "Hello world" },
      },
      {
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", output_text: "Hello world!" },
      },
      {
        type: "turn.completed",
        usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: 1 },
      },
    ];

    const res = await replay("codex", frames);
    expect(res.chunkText).toBe("Hello world!");
    expect(res.chunkText.includes("thread.started")).toBe(false);
    expect(res.sent.some((x) => x.type === MessageType.USAGE_REPORT)).toBe(true);
  });

  it("Gemini 回放应正确拼接 delta 并收敛为完整正文", async () => {
    const frames = [
      { type: "init" },
      { type: "message", role: "user", content: "Q" },
      { type: "message", role: "model", delta: true, text: "Hello " },
      { type: "message", role: "model", delta: true, text: "world" },
      { type: "result", status: "success", usage: { input_tokens: 5, output_tokens: 2 } },
    ];

    const res = await replay("gemini", frames);
    expect(res.chunkText).toBe("Hello world");
    expect(res.chunkText.includes("gemini init")).toBe(false);
    expect(res.sent.some((x) => x.type === MessageType.USAGE_REPORT)).toBe(true);
  });
});
