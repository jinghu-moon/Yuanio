import { describe, it, expect } from "bun:test";
import { routeAgentForPrompt, isRetryableAgentFailure } from "../agent-router";

describe("agent-router", () => {
  it("支持 override 直选 agent", () => {
    const result = routeAgentForPrompt({
      prompt: "请修复崩溃",
      defaultAgent: "codex",
      agentOverride: "claude",
    });
    expect(result.agent).toBe("claude");
    expect(result.strategy).toBe("override");
  });

  it("工程任务优先 codex", () => {
    const result = routeAgentForPrompt({
      prompt: "实现 Android Kotlin 功能并修复编译错误",
      defaultAgent: "gemini",
    });
    expect(result.agent).toBe("codex");
    expect(result.strategy).toBe("heuristic");
  });

  it("搜索调研任务优先 gemini", () => {
    const result = routeAgentForPrompt({
      prompt: "搜索网页并对标主流方案，给出参考链接",
      defaultAgent: "codex",
    });
    expect(result.agent).toBe("gemini");
  });

  it("重试时会避开已尝试 agent", () => {
    const result = routeAgentForPrompt({
      prompt: "修复 Kotlin 编译错误",
      defaultAgent: "codex",
      triedAgents: ["codex"],
    });
    expect(result.agent).not.toBe("codex");
  });

  it("识别可重试失败场景", () => {
    expect(isRetryableAgentFailure("rate limit exceeded")).toBe(true);
    expect(isRetryableAgentFailure("[spawn] 未检测到 codex CLI")).toBe(true);
    expect(isRetryableAgentFailure("validation failed")).toBe(false);
  });
});

