import { describe, expect, it } from "bun:test";
import {
  CP_UTF8,
  ENABLE_VIRTUAL_TERMINAL_PROCESSING,
  createWin32Console,
  enableVtMode,
  getCodePageState,
  setUtf8CodePage,
  type Win32ConsoleApi,
} from "../win32-console";

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

describe("createWin32Console", () => {
  it("非 win32 返回 noop 实现", () => {
    const api = createWin32Console("linux");
    expect(api.getConsoleCP()).toBe(CP_UTF8);
    expect(api.getConsoleOutputCP()).toBe(CP_UTF8);
    expect(api.getStdHandle(-11)).toBeNull();
    expect(api.getConsoleMode(1)).toBeNull();
    expect(api.setConsoleCP(936)).toBe(true);
    expect(api.setConsoleOutputCP(936)).toBe(true);
    expect(api.setConsoleMode(1, 0)).toBe(true);
  });
});

describe("getCodePageState", () => {
  it("返回 input/output 代码页状态", () => {
    const api = createMockApi({
      getConsoleCP: () => 936,
      getConsoleOutputCP: () => 65001,
    });

    expect(getCodePageState(api)).toEqual({
      inputCP: 936,
      outputCP: 65001,
    });
  });
});

describe("setUtf8CodePage", () => {
  it("同时设置 input/output 为 UTF-8", () => {
    let inputCP = 936;
    let outputCP = 936;
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
    });

    expect(setUtf8CodePage(api)).toBe(true);
    expect(inputCP).toBe(CP_UTF8);
    expect(outputCP).toBe(CP_UTF8);
  });

  it("任一设置失败时返回 false", () => {
    const api = createMockApi({
      setConsoleCP: () => false,
      setConsoleOutputCP: () => true,
      getConsoleCP: () => 936,
      getConsoleOutputCP: () => CP_UTF8,
    });

    expect(setUtf8CodePage(api)).toBe(false);
  });
});

describe("enableVtMode", () => {
  it("已启用 VT 时直接返回 true", () => {
    const api = createMockApi({
      getConsoleMode: () => ENABLE_VIRTUAL_TERMINAL_PROCESSING,
    });

    expect(enableVtMode(api)).toBe(true);
  });

  it("未启用 VT 时会补开开关", () => {
    let consoleMode = 0;
    const api = createMockApi({
      getConsoleMode: () => consoleMode,
      setConsoleMode: (_handle, nextMode) => {
        consoleMode = nextMode;
        return true;
      },
    });

    expect(enableVtMode(api)).toBe(true);
    expect(consoleMode & ENABLE_VIRTUAL_TERMINAL_PROCESSING).toBe(ENABLE_VIRTUAL_TERMINAL_PROCESSING);
  });

  it("拿不到输出句柄时返回 false", () => {
    const api = createMockApi({
      getStdHandle: () => null,
    });

    expect(enableVtMode(api)).toBe(false);
  });
});
