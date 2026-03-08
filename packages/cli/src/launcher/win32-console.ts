import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

export interface Win32ConsoleApi {
  getConsoleCP(): number;
  getConsoleOutputCP(): number;
  setConsoleCP(codePage: number): boolean;
  setConsoleOutputCP(codePage: number): boolean;
  getStdHandle(nStdHandle: number): number | null;
  getConsoleMode(handle: number): number | null;
  setConsoleMode(handle: number, mode: number): boolean;
}

export const STD_OUTPUT_HANDLE = -11;
export const CP_UTF8 = 65001;
export const ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004;

function normalizePointer(value: number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(normalized) || normalized === 0) return null;
  return normalized;
}

export function createNativeWin32Console(): Win32ConsoleApi {
  const kernel32 = dlopen("kernel32.dll", {
    GetConsoleCP: {
      args: [],
      returns: FFIType.u32,
    },
    GetConsoleOutputCP: {
      args: [],
      returns: FFIType.u32,
    },
    SetConsoleCP: {
      args: [FFIType.u32],
      returns: FFIType.i32,
    },
    SetConsoleOutputCP: {
      args: [FFIType.u32],
      returns: FFIType.i32,
    },
    GetStdHandle: {
      args: [FFIType.u32],
      returns: FFIType.ptr,
    },
    GetConsoleMode: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
    SetConsoleMode: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
  });

  return {
    getConsoleCP: () => Number(kernel32.symbols.GetConsoleCP()),
    getConsoleOutputCP: () => Number(kernel32.symbols.GetConsoleOutputCP()),
    setConsoleCP: (codePage) => kernel32.symbols.SetConsoleCP(codePage >>> 0) !== 0,
    setConsoleOutputCP: (codePage) => kernel32.symbols.SetConsoleOutputCP(codePage >>> 0) !== 0,
    getStdHandle: (nStdHandle) => normalizePointer(kernel32.symbols.GetStdHandle(nStdHandle >>> 0) as number | bigint),
    getConsoleMode: (handle) => {
      const modeBuffer = new Uint32Array(1);
      const ok = kernel32.symbols.GetConsoleMode(handle as Pointer, ptr(modeBuffer)) !== 0;
      return ok ? modeBuffer[0] : null;
    },
    setConsoleMode: (handle, mode) => kernel32.symbols.SetConsoleMode(handle as Pointer, mode >>> 0) !== 0,
  };
}

export function createNoopWin32Console(): Win32ConsoleApi {
  return {
    getConsoleCP: () => CP_UTF8,
    getConsoleOutputCP: () => CP_UTF8,
    setConsoleCP: () => true,
    setConsoleOutputCP: () => true,
    getStdHandle: () => null,
    getConsoleMode: () => null,
    setConsoleMode: () => true,
  };
}

export function createWin32Console(platform: NodeJS.Platform = process.platform): Win32ConsoleApi {
  if (platform !== "win32") {
    return createNoopWin32Console();
  }

  try {
    return createNativeWin32Console();
  } catch {
    return createNoopWin32Console();
  }
}

export function getCodePageState(api: Win32ConsoleApi): { inputCP: number; outputCP: number } {
  return {
    inputCP: api.getConsoleCP(),
    outputCP: api.getConsoleOutputCP(),
  };
}

export function setUtf8CodePage(api: Win32ConsoleApi): boolean {
  const inputOk = api.setConsoleCP(CP_UTF8);
  const outputOk = api.setConsoleOutputCP(CP_UTF8);
  const state = getCodePageState(api);
  return inputOk && outputOk && state.inputCP === CP_UTF8 && state.outputCP === CP_UTF8;
}

export function enableVtMode(api: Win32ConsoleApi): boolean {
  const handle = api.getStdHandle(STD_OUTPUT_HANDLE);
  if (handle === null) return false;

  const currentMode = api.getConsoleMode(handle);
  if (currentMode === null) return false;
  if ((currentMode & ENABLE_VIRTUAL_TERMINAL_PROCESSING) === ENABLE_VIRTUAL_TERMINAL_PROCESSING) {
    return true;
  }

  return api.setConsoleMode(handle, currentMode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
}

