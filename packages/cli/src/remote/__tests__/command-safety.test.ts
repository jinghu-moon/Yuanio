import { describe, it, expect } from "bun:test";
import { evaluateCommandSafety } from "../command-safety";

describe("command-safety", () => {
  it("普通读命令默认放行", () => {
    const result = evaluateCommandSafety("git status");
    expect(result.decision).toBe("allow");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("git push 需要确认", () => {
    const result = evaluateCommandSafety("git push origin main");
    expect(result.decision).toBe("prompt");
    expect(result.requiresConfirmation).toBe(true);
  });

  it("确认后可通过 prompt 决策", () => {
    const result = evaluateCommandSafety("git push origin main", { confirmed: true });
    expect(result.decision).toBe("prompt");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("高危命令会被禁止", () => {
    const result = evaluateCommandSafety("git reset --hard HEAD~1");
    expect(result.decision).toBe("forbidden");
  });

  it("regex 高危命令会被禁止", () => {
    const result = evaluateCommandSafety("rm -rf /");
    expect(result.decision).toBe("forbidden");
  });
});

