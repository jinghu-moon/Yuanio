import type { LauncherLocale } from "./i18n/index.ts";
import { detectTerminalHost, type HostInfo } from "./host-detect.ts";
import {
  CP_UTF8,
  createWin32Console,
  enableVtMode,
  getCodePageState,
  setUtf8CodePage,
  type Win32ConsoleApi,
} from "./win32-console.ts";

export interface LauncherConsoleState {
  utf8Active: boolean;
  originalCodePage: number | null;
  originalInputCodePage: number | null;
  hostInfo: HostInfo;
  vtModeActive: boolean;
  restore: () => void;
}

export interface ConsoleDeps {
  win32Api: Win32ConsoleApi;
  hostInfo: HostInfo;
}

export type CjkReadiness = "full" | "degraded" | "unavailable";

const LEGACY_HOST_INFO: HostInfo = {
  host: "legacy",
  tier: "legacy",
};

/** @deprecated 仅为兼容旧测试与兼容层保留。 */
export function parseWindowsCodePage(output: string): number | null {
  const match = output.match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const codePage = Number(match[1]);
  return Number.isInteger(codePage) ? codePage : null;
}

export function prepareLauncherConsole(
  platform: NodeJS.Platform = process.platform,
  deps: Partial<ConsoleDeps> = {},
): LauncherConsoleState {
  const hostInfo = deps.hostInfo ?? detectTerminalHost(platform);

  if (platform !== "win32") {
    return {
      utf8Active: true,
      originalCodePage: null,
      originalInputCodePage: null,
      hostInfo,
      vtModeActive: true,
      restore: () => {},
    };
  }

  const win32Api = deps.win32Api ?? createWin32Console(platform);
  const originalCodePages = getCodePageState(win32Api);
  let currentCodePages = originalCodePages;
  let utf8Active = currentCodePages.inputCP === CP_UTF8 && currentCodePages.outputCP === CP_UTF8;

  if (!utf8Active) {
    utf8Active = setUtf8CodePage(win32Api);
    currentCodePages = getCodePageState(win32Api);
    utf8Active = utf8Active && currentCodePages.inputCP === CP_UTF8 && currentCodePages.outputCP === CP_UTF8;
  }

  const vtModeActive = enableVtMode(win32Api);

  return {
    utf8Active,
    originalCodePage: originalCodePages.outputCP,
    originalInputCodePage: originalCodePages.inputCP,
    hostInfo,
    vtModeActive,
    restore: () => {
      if (originalCodePages.inputCP !== CP_UTF8) {
        win32Api.setConsoleCP(originalCodePages.inputCP);
      }
      if (originalCodePages.outputCP !== CP_UTF8) {
        win32Api.setConsoleOutputCP(originalCodePages.outputCP);
      }
    },
  };
}

export function assessCjkReadiness(
  state: Pick<LauncherConsoleState, "utf8Active" | "hostInfo">,
): CjkReadiness {
  if (!state.utf8Active) return "unavailable";
  return state.hostInfo.tier === "modern" ? "full" : "degraded";
}

export function resolveLauncherLanguage(
  preferredLanguage: LauncherLocale,
  options: { platform?: NodeJS.Platform; utf8Active: boolean; hostInfo?: HostInfo },
): LauncherLocale {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return preferredLanguage;
  }

  const readiness = assessCjkReadiness({
    utf8Active: options.utf8Active,
    hostInfo: options.hostInfo ?? LEGACY_HOST_INFO,
  });

  return readiness === "unavailable" ? "en" : preferredLanguage;
}
