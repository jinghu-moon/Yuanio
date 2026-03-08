import { describe, expect, it } from "bun:test";
import {
  InteractionActionPayloadSchema,
  InteractionStatePayloadSchema,
} from "./schemas";
import { createInteractionStatePayload, resolveInteractionActions } from "./interaction";

describe("interaction protocol", () => {
  it("running 状态应包含 continue + stop", () => {
    const actions = resolveInteractionActions({
      state: "running",
      runningTasks: 2,
      pendingApprovals: 0,
    });
    expect(actions).toContain("continue");
    expect(actions).toContain("stop");
  });

  it("waiting_approval 状态应包含 approve + reject", () => {
    const actions = resolveInteractionActions({
      state: "waiting_approval",
      runningTasks: 0,
      pendingApprovals: 1,
    });
    expect(actions).toEqual(["approve", "reject"]);
  });

  it("error 状态无 lastError 时不暴露 rollback", () => {
    const actions = resolveInteractionActions({
      state: "error",
      runningTasks: 0,
      pendingApprovals: 0,
    });
    expect(actions).toEqual(["retry"]);
  });

  it("createInteractionStatePayload 应通过 schema", () => {
    const payload = createInteractionStatePayload({
      state: "waiting_approval",
      sessionId: "sess_1",
      version: 3,
      reason: "approval_requested",
      updatedAt: Date.now(),
      runningTasks: 1,
      pendingApprovals: 2,
      activeApprovalId: "apr_1",
      riskLevel: "high",
      riskSummary: "写操作涉及多个关键文件，请先确认 diff 片段。",
      diffHighlights: ["+ rm -rf ./dist", "+ chmod -R 777 ."],
      lastError: "previous step failed",
    });
    const parsed = InteractionStatePayloadSchema.parse(payload);
    expect(parsed.state).toBe("waiting_approval");
    expect(parsed.availableActions).toContain("approve");
    expect(parsed.availableActions).toContain("reject");
  });

  it("interaction_action schema 允许 rollback with path", () => {
    const parsed = InteractionActionPayloadSchema.parse({
      action: "rollback",
      source: "app",
      path: "src/index.ts",
    });
    expect(parsed.path).toBe("src/index.ts");
  });
});
