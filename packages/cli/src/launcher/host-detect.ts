export type TerminalHost = "windows-terminal" | "vscode" | "conemu" | "mintty" | "legacy" | "unknown";
export type TerminalTier = "modern" | "legacy";

export interface HostInfo {
  host: TerminalHost;
  tier: TerminalTier;
}

export function detectTerminalHost(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): HostInfo {
  if (platform !== "win32") {
    return { host: "unknown", tier: "modern" };
  }

  if (env.WT_SESSION) {
    return { host: "windows-terminal", tier: "modern" };
  }

  if ((env.TERM_PROGRAM || "").toLowerCase() === "vscode") {
    return { host: "vscode", tier: "modern" };
  }

  if (env.ConEmuPID) {
    return { host: "conemu", tier: "modern" };
  }

  if (env.MSYSTEM) {
    return { host: "mintty", tier: "modern" };
  }

  return { host: "legacy", tier: "legacy" };
}
