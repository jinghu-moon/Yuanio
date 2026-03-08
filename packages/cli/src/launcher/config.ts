import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { detectLocaleFromEnv, normalizeLocale, type LauncherLocale } from "./i18n/index.ts";

const YUANIO_DIR = join(homedir(), ".yuanio");
const CONFIG_FILE = join(YUANIO_DIR, "config.json");

export interface LauncherConfig {
  serverUrl: string;
  namespace: string;
  relayPort: number;
  autoStart: boolean;
  connectionProfile: "lan" | "tunnel";
  tunnelMode: "quick" | "named";
  tunnelName: string;
  tunnelHostname: string;
  language: LauncherLocale;
}

const DEFAULTS: LauncherConfig = {
  serverUrl: "https://seeyuer-yuanio.us.ci",
  namespace: "default",
  relayPort: 3000,
  autoStart: false,
  connectionProfile: "tunnel",
  tunnelMode: "named",
  tunnelName: "yuanio",
  tunnelHostname: "seeyuer-yuanio.us.ci",
  language: detectLocaleFromEnv(),
};

function normalizeLoadedConfig(raw: Partial<LauncherConfig>): LauncherConfig {
  const merged = { ...DEFAULTS, ...raw };
  const relayPortNum = Number(merged.relayPort);
  const relayPort = Number.isFinite(relayPortNum)
    ? Math.max(1, Math.min(65535, relayPortNum))
    : DEFAULTS.relayPort;

  return {
    serverUrl: String(merged.serverUrl || DEFAULTS.serverUrl),
    namespace: String(merged.namespace || DEFAULTS.namespace),
    relayPort,
    autoStart: Boolean(merged.autoStart),
    connectionProfile: merged.connectionProfile === "lan" ? "lan" : "tunnel",
    tunnelMode: merged.tunnelMode === "quick" ? "quick" : "named",
    tunnelName: String(merged.tunnelName || DEFAULTS.tunnelName),
    tunnelHostname: String(merged.tunnelHostname || DEFAULTS.tunnelHostname),
    language: normalizeLocale(merged.language, DEFAULTS.language),
  };
}

export function loadConfig(): LauncherConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Partial<LauncherConfig>;
    return normalizeLoadedConfig(raw);
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: Partial<LauncherConfig>): void {
  const current = loadConfig();
  const merged = normalizeLoadedConfig({ ...current, ...config });
  if (!existsSync(YUANIO_DIR)) mkdirSync(YUANIO_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}
