import { describe, it, expect } from "bun:test";
import { collectTaskSummary } from "../task-summary";
import type { UsageInfo } from "@yuanio/shared";

describe("task-summary", () => {
  it("返回基本字段", async () => {
    const taskStartMap = new Map<string, number>();
    const taskUsageMap = new Map<string, UsageInfo>();
    taskStartMap.set("t1", Date.now() - 50);
    taskUsageMap.set("t1", { inputTokens: 1, outputTokens: 2 });

    const summary = await collectTaskSummary("t1", taskStartMap, taskUsageMap);

    expect(summary.taskId).toBe("t1");
    expect(summary.duration).toBeGreaterThanOrEqual(0);
    expect(summary.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
  });
});
