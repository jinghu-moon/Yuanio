export const INGRESS_PROTOCOL_VERSION = "1.0.0";

export type IngressNetworkMode = "lan" | "cloudflare" | "public" | "unknown";
export type IngressPromptSource =
  | "relay"
  | "queue"
  | "telegram"
  | "mobile_lan"
  | "mobile_cloudflare"
  | "mobile_public"
  | "unknown";

export interface ParsedSlashCommand {
  command: string;
  args: string[];
}

export interface ParseSlashCommandOptions {
  prefix?: string;
  mentionSeparator?: string;
  normalizeCommand?: (value: string) => string;
}

function defaultNormalizeCommand(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 通用 slash 命令解析器，供 Telegram/Web/App 入口复用。
 */
export function parseSlashCommand(
  text: string,
  options: ParseSlashCommandOptions = {},
): ParsedSlashCommand | null {
  const prefix = options.prefix ?? "/";
  const mentionSeparator = options.mentionSeparator;
  const normalizeCommand = options.normalizeCommand ?? defaultNormalizeCommand;

  const trimmed = text.trim();
  if (!trimmed.startsWith(prefix)) return null;

  const [head, ...args] = trimmed.split(/\s+/);
  let commandRaw = head.slice(prefix.length);
  if (!commandRaw) return null;

  if (mentionSeparator) {
    const at = commandRaw.indexOf(mentionSeparator);
    if (at > 0) {
      commandRaw = commandRaw.slice(0, at);
    }
  }

  const command = normalizeCommand(commandRaw);
  if (!command) return null;
  return { command, args };
}

export function normalizeIngressNetworkMode(value?: string | null): IngressNetworkMode {
  const raw = (value || "").trim().toLowerCase();
  if (!raw || raw === "auto") return "unknown";
  if (raw === "lan" || raw === "local") return "lan";
  if (raw === "cloudflare" || raw === "cf" || raw === "tunnel" || raw === "cloudflare-tunnel") return "cloudflare";
  if (raw === "public" || raw === "internet" || raw === "remote") return "public";
  return "unknown";
}

export function resolveIngressNetworkMode(
  ...candidates: Array<string | null | undefined>
): IngressNetworkMode {
  for (const item of candidates) {
    const mode = normalizeIngressNetworkMode(item);
    if (mode !== "unknown") return mode;
  }
  return "unknown";
}

export function isPublicIngressNetworkMode(mode: IngressNetworkMode): boolean {
  return mode === "public" || mode === "cloudflare";
}

export function resolveMobilePromptSource(input: {
  transportHint?: string | null;
  networkMode?: string | IngressNetworkMode | null;
}): IngressPromptSource {
  const transportHint = (input.transportHint || "").trim().toLowerCase();
  if (transportHint === "local" || transportHint === "local_ws" || transportHint === "lan") {
    return "mobile_lan";
  }

  const mode = typeof input.networkMode === "string"
    ? normalizeIngressNetworkMode(input.networkMode)
    : (input.networkMode || "unknown");

  if (mode === "cloudflare") return "mobile_cloudflare";
  if (mode === "public") return "mobile_public";
  return "relay";
}
