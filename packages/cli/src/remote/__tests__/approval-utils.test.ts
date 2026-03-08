import { describe, it, expect } from "bun:test";
import {
  assessRisk,
  buildContext,
  buildDiffHighlights,
  buildFilePreview,
  buildRiskSummary,
  resolveApprovalLevel,
  shouldAutoApprove,
} from "../approval-utils";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("approval-utils", () => {
  it("assessRisk 分类", () => {
    expect(assessRisk("bash", { command: "rm -rf /" })).toBe("critical");
    expect(assessRisk("bash", { command: "ls" })).toBe("high");
    expect(assessRisk("write_file", { file_path: "a.txt" })).toBe("medium");
    expect(assessRisk("read_file", { file_path: "a.txt" })).toBe("low");
  });

  it("buildContext 输出必要字段", () => {
    const text = buildContext("write_file", {
      file_path: "demo.txt",
      command: "echo hi",
      content: "hello",
      old_string: "old",
    });
    expect(text).toContain("工具: write_file");
    expect(text).toContain("文件: demo.txt");
    expect(text).toContain("命令: echo hi");
    expect(text).toContain("内容长度: 5 字符");
    expect(text).toContain("替换: \"old...");
    expect(text).toContain("工作目录:");
  });

  it("buildFilePreview 生成预览", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yuanio-preview-"));
    const filePath = join(dir, "sample.txt");
    writeFileSync(filePath, "hello world");
    try {
      const preview = await buildFilePreview([filePath]);
      expect(preview).toContain("---");
      expect(preview).toContain("hello world");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("approval level 控制自动放行", () => {
    expect(resolveApprovalLevel("high")).toBe("high");
    expect(resolveApprovalLevel("none")).toBe("none");
    expect(resolveApprovalLevel("unknown")).toBe("all");

    expect(shouldAutoApprove("low", "medium")).toBe(true);
    expect(shouldAutoApprove("medium", "medium")).toBe(false);
    expect(shouldAutoApprove("high", "high")).toBe(false);
    expect(shouldAutoApprove("medium", "high")).toBe(true);
    expect(shouldAutoApprove("critical", "none")).toBe(true);
  });

  it("risk summary 与 diff highlights 输出可读摘要", () => {
    const summary = buildRiskSummary("bash", "high", { command: "rm -rf ./dist" });
    expect(summary).toContain("高风险");
    const highlights = buildDiffHighlights({
      command: "git checkout -- src/index.ts",
      old_string: "const a = 1",
      new_string: "const a = 2",
      content: "line1\nline2\nline3",
    });
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[0]).toContain("$");
  });
});
