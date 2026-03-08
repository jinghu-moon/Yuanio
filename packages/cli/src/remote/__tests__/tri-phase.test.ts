import { describe, it, expect } from "bun:test";
import { applyTriPhasePrompt, buildTriPhasePrompt } from "../tri-phase";

describe("tri-phase", () => {
  it("工程任务会自动注入三阶段协议", () => {
    const result = applyTriPhasePrompt("请实现上传进度条并补测试");
    expect(result.applied).toBe(true);
    expect(result.prompt).toContain("Plan -> Execute -> Review");
  });

  it("交互命令不注入三阶段协议", () => {
    const result = applyTriPhasePrompt("/mode plan");
    expect(result.applied).toBe(false);
  });

  it("纯闲聊内容不注入三阶段协议", () => {
    const result = applyTriPhasePrompt("今天天气怎么样");
    expect(result.applied).toBe(false);
  });

  it("buildTriPhasePrompt 生成固定结构", () => {
    const prompt = buildTriPhasePrompt("修复 lint");
    expect(prompt).toContain("PLAN");
    expect(prompt).toContain("EXECUTE");
    expect(prompt).toContain("REVIEW");
  });
});

