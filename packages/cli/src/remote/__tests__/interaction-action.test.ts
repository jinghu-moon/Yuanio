import { describe, expect, it } from "bun:test";
import { MessageType } from "@yuanio/shared";
import { executeInteractionAction } from "../interaction-action-executor";

describe("interaction-action-executor", () => {
  it("continue 会转发为 prompt", async () => {
    const prompts: string[] = [];
    const result = await executeInteractionAction({
      action: "continue",
      source: "app",
      prompt: "continue",
    }, {
      runningAgents: new Map(),
      sendStatus: async () => {},
      sendEnvelope: async () => {},
      sendTelegram: () => {},
      settleApproval: async () => true,
      pickPendingApprovalId: () => null,
      dispatchPrompt: async (prompt) => {
        prompts.push(prompt);
      },
    });
    expect(result.ok).toBe(true);
    expect(prompts).toEqual(["continue"]);
  });

  it("approve 会使用待审批 ID", async () => {
    const settled: Array<{ id: string; approved: boolean }> = [];
    const result = await executeInteractionAction({
      action: "approve",
      source: "telegram",
    }, {
      runningAgents: new Map(),
      sendStatus: async () => {},
      sendEnvelope: async () => {},
      sendTelegram: () => {},
      settleApproval: async (id, approved) => {
        settled.push({ id, approved });
        return true;
      },
      pickPendingApprovalId: () => "apr_1",
      dispatchPrompt: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(settled).toEqual([{ id: "apr_1", approved: true }]);
  });

  it("stop 会结束运行任务并发送 stream_end", async () => {
    let killed = false;
    const sentTypes: MessageType[] = [];
    const runningAgents = new Map<string, any>();
    runningAgents.set("task_1", {
      handle: {
        kill: () => {
          killed = true;
        },
      },
      agent: "codex",
    });
    const result = await executeInteractionAction({
      action: "stop",
      source: "app",
    }, {
      runningAgents,
      sendStatus: async () => {},
      sendEnvelope: async (type) => {
        sentTypes.push(type);
      },
      sendTelegram: () => {},
      settleApproval: async () => true,
      pickPendingApprovalId: () => null,
      dispatchPrompt: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(killed).toBe(true);
    expect(sentTypes).toContain(MessageType.STREAM_END);
  });

  it("rollback 缺失 path 应失败", async () => {
    const result = await executeInteractionAction({
      action: "rollback",
      source: "app",
    }, {
      runningAgents: new Map(),
      sendStatus: async () => {},
      sendEnvelope: async () => {},
      sendTelegram: () => {},
      settleApproval: async () => true,
      pickPendingApprovalId: () => null,
      dispatchPrompt: async () => {},
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("path");
  });
});
