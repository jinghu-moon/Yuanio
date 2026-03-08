import { describe, expect, it } from "bun:test";
import type { HostInfo } from "../host-detect";
import {
  assessCjkReadiness,
  parseWindowsCodePage,
  prepareLauncherConsole,
  resolveLauncherLanguage,
} from "../console-encoding";
import { ENABLE_VIRTUAL_TERMINAL_PROCESSING, type Win32ConsoleApi } from "../win32-console";

function createHostInfo(host: HostInfo["host"], tier: HostInfo["tier"]): HostInfo {
  return { host, tier };
}

function createMockApi(overrides: Partial<Win32ConsoleApi> = {}): Win32ConsoleApi {
  return {
    getConsoleCP: () => 936,
    getConsoleOutputCP: () => 936,
    setConsoleCP: () => true,
    setConsoleOutputCP: () => true,
    getStdHandle: () => 1,
    getConsoleMode: () => 0,
    setConsoleMode: () => true,
    ...overrides,
  };
}

describe("parseWindowsCodePage", () => {
  it("兼容英文 chcp 输出", () => {
    expect(parseWindowsCodePage("Active code page: 65001\r\n")).toBe(65001);
  });

  it("兼容中文 chcp 输出", () => {
    expect(parseWindowsCodePage("活动代码页: 936\r\n")).toBe(936);
  });

  it("无法解析时返回 null", () => {
    expect(parseWindowsCodePage("unknown")).toBeNull();
  });
});

describe("prepareLauncherConsole", () => {
  it("非 Windows 直接返回现代终端就绪状态", () => {
    const state = prepareLauncherConsole("linux");

    expect(state.utf8Active).toBe(true);
    expect(state.originalCodePage).toBeNull();
    expect(state.originalInputCodePage).toBeNull();
    expect(state.hostInfo).toEqual({ host: "unknown", tier: "modern" });
    expect(state.vtModeActive).toBe(true);
  });

  it("Windows 下会切换 UTF-8 并启用 VT", () => {
    let inputCP = 936;
    let outputCP = 936;
    let consoleMode = 0;
    const api = createMockApi({
      getConsoleCP: () => inputCP,
      getConsoleOutputCP: () => outputCP,
      setConsoleCP: (codePage) => {
        inputCP = codePage;
        return true;
      },
      setConsoleOutputCP: (codePage) => {
        outputCP = codePage;
        return true;
      },
      getConsoleMode: () => consoleMode,
      setConsoleMode: (_handle, nextMode) => {
        consoleMode = nextMode;
        return true;
      },
    });
    const hostInfo = createHostInfo("windows-terminal", "modern");

    const state = prepareLauncherConsole("win32", { win32Api: api, hostInfo });

    expect(state.utf8Active).toBe(true);
    expect(state.originalInputCodePage).toBe(936);
    expect(state.originalCodePage).toBe(936);
    expect(state.hostInfo).toEqual(hostInfo);
    expect(state.vtModeActive).toBe(true);
    expect(consoleMode & ENABLE_VIRTUAL_TERMINAL_PROCESSING).toBe(ENABLE_VIRTUAL_TERMINAL_PROCESSING);

    state.restore();
    expect(inputCP).toBe(936);
    expect(outputCP).toBe(936);
  });

  it("UTF-8 切换失败时标记 unavailable", () => {
    let inputCP = 936;
    let outputCP = 936;
    const api = createMockApi({
      getConsoleCP: () => inputCP,
      getConsoleOutputCP: () => outputCP,
      setConsoleCP: () => false,
      setConsoleOutputCP: () => false,
      getStdHandle: () => null,
    });
    const hostInfo = createHostInfo("legacy", "legacy");

    const state = prepareLauncherConsole("win32", { win32Api: api, hostInfo });

    expect(state.utf8Active).toBe(false);
    expect(state.vtModeActive).toBe(false);
    expect(assessCjkReadiness(state)).toBe("unavailable");
  });
});

describe("assessCjkReadiness", () => {
  it("modern + utf8 => full", () => {
    expect(assessCjkReadiness({
      utf8Active: true,
      hostInfo: createHostInfo("windows-terminal", "modern"),
    })).toBe("full");
  });

  it("legacy + utf8 => degraded", () => {
    expect(assessCjkReadiness({
      utf8Active: true,
      hostInfo: createHostInfo("legacy", "legacy"),
    })).toBe("degraded");
  });

  it("非 utf8 => unavailable", () => {
    expect(assessCjkReadiness({
      utf8Active: false,
      hostInfo: createHostInfo("windows-terminal", "modern"),
    })).toBe("unavailable");
  });
});

describe("resolveLauncherLanguage", () => {
  it("Windows 且未启用 UTF-8 时回退到英文", () => {
    expect(resolveLauncherLanguage("zh-CN", {
      platform: "win32",
      utf8Active: false,
      hostInfo: createHostInfo("legacy", "legacy"),
    })).toBe("en");
  });

  it("Windows modern host + UTF-8 保留原语言", () => {
    expect(resolveLauncherLanguage("zh-CN", {
      platform: "win32",
      utf8Active: true,
      hostInfo: createHostInfo("windows-terminal", "modern"),
    })).toBe("zh-CN");
  });

  it("Windows legacy host + UTF-8 走 degraded 但仍保留原语言", () => {
    expect(resolveLauncherLanguage("zh-CN", {
      platform: "win32",
      utf8Active: true,
      hostInfo: createHostInfo("legacy", "legacy"),
    })).toBe("zh-CN");
  });

  it("未传 hostInfo 时保持向后兼容", () => {
    expect(resolveLauncherLanguage("zh-CN", {
      platform: "win32",
      utf8Active: true,
    })).toBe("zh-CN");
  });

  it("非 Windows 保留原语言", () => {
    expect(resolveLauncherLanguage("zh-CN", {
      platform: "linux",
      utf8Active: true,
    })).toBe("zh-CN");
  });
});
