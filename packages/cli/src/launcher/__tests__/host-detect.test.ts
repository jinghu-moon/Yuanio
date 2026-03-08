import { describe, expect, it } from "bun:test";
import { detectTerminalHost } from "../host-detect";

describe("detectTerminalHost", () => {
  it("非 Windows 返回 unknown/modern", () => {
    expect(detectTerminalHost("linux", {})).toEqual({ host: "unknown", tier: "modern" });
  });

  it("WT_SESSION 优先识别为 Windows Terminal", () => {
    expect(
      detectTerminalHost("win32", {
        WT_SESSION: "1",
        TERM_PROGRAM: "vscode",
        ConEmuPID: "123",
      }),
    ).toEqual({ host: "windows-terminal", tier: "modern" });
  });

  it("VS Code 终端排在 ConEmu 前", () => {
    expect(
      detectTerminalHost("win32", {
        TERM_PROGRAM: "vscode",
        ConEmuPID: "123",
      }),
    ).toEqual({ host: "vscode", tier: "modern" });
  });

  it("ConEmu 可被识别", () => {
    expect(detectTerminalHost("win32", { ConEmuPID: "123" })).toEqual({ host: "conemu", tier: "modern" });
  });

  it("MSYSTEM 可识别为 mintty", () => {
    expect(detectTerminalHost("win32", { MSYSTEM: "UCRT64" })).toEqual({ host: "mintty", tier: "modern" });
  });

  it("无已知标记时降级为 legacy", () => {
    expect(detectTerminalHost("win32", {})).toEqual({ host: "legacy", tier: "legacy" });
  });
});
