import React from "react";
import { render } from "ink";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { App } from "./App.tsx";
import { loadConfig, type LauncherConfig } from "./config.ts";
import { normalizeLocale } from "./i18n/index.ts";
import { prepareLauncherConsole, resolveLauncherLanguage } from "./console-encoding.ts";
import { paths } from "@/paths.ts";
import type { LogEntry } from "./components/LogViewer.tsx";

function applyCliOverrides(config: LauncherConfig, args: string[]) {
  const serverUrlIdx = args.indexOf("--server");
  if (serverUrlIdx !== -1 && args[serverUrlIdx + 1]) config.serverUrl = args[serverUrlIdx + 1];
  const namespaceIdx = args.indexOf("--namespace");
  if (namespaceIdx !== -1 && args[namespaceIdx + 1]) config.namespace = args[namespaceIdx + 1];
  const langIdx = args.indexOf("--lang");
  if (langIdx !== -1 && args[langIdx + 1]) config.language = normalizeLocale(args[langIdx + 1], config.language);
  if (args.includes("--auto-start")) config.autoStart = true;
}

export async function startLauncher(args: string[]) {
  const consoleState = prepareLauncherConsole();
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[?25l");
  const stdin = process.stdin;
  if (typeof stdin.setEncoding === "function") stdin.setEncoding("utf8");
  const canRawMode = stdin.isTTY && typeof stdin.setRawMode === "function";
  const initialRawMode = canRawMode ? stdin.isRaw : false;

  const ensureInputReady = () => {
    if (canRawMode && !stdin.isRaw) stdin.setRawMode(true);
    if (stdin.readable && stdin.isPaused()) stdin.resume();
  };

  const restore = () => {
    if (canRawMode && stdin.isRaw !== initialRawMode) stdin.setRawMode(initialRawMode);
    process.stdout.write("\x1b[?25h");
    process.stdout.write("\x1b[?1049l");
    consoleState.restore();
  };

  process.on("SIGINT", () => { restore(); process.exit(0); });
  process.on("SIGTERM", () => { restore(); process.exit(0); });

  try {
    let restartRequested = false;
    do {
      restartRequested = false;
      const config = loadConfig();
      applyCliOverrides(config, args);
      config.language = resolveLauncherLanguage(config.language, {
        utf8Active: consoleState.utf8Active,
        hostInfo: consoleState.hostInfo,
      });

      const logFilePath = createLauncherLogFilePath();
      const logStream = createWriteStream(logFilePath, { flags: "a", encoding: "utf8" });
      const smokeLabel = process.env.YUANIO_LAUNCHER_SMOKE_LABEL?.trim();
      const smokeLabelSuffix = smokeLabel ? ` label=${smokeLabel}` : "";
      logStream.write(
        `${formatLogTime(Date.now())} [ops] [info] launcher started host=${consoleState.hostInfo.host} tier=${consoleState.hostInfo.tier} utf8=${consoleState.utf8Active} vt=${consoleState.vtModeActive}${smokeLabelSuffix}\n`,
      );
      if (!consoleState.utf8Active) {
        logStream.write(`${formatLogTime(Date.now())} [ops] [warn] console UTF-8 init failed, fallback to English-safe TUI\n`);
      } else if (consoleState.hostInfo.tier === "legacy") {
        logStream.write(`${formatLogTime(Date.now())} [ops] [info] legacy console detected, CJK may render with reduced fidelity\n`);
      }
      if (!consoleState.vtModeActive && process.platform === "win32") {
        logStream.write(`${formatLogTime(Date.now())} [ops] [warn] VT mode enablement failed, TUI rendering may be impaired\n`);
      }

      ensureInputReady();
      try {
        const { waitUntilExit } = render(
          <App
            config={config}
            onRestart={() => { restartRequested = true; }}
            onLogEntry={(entry) => writeLogLine(logStream, entry)}
          />,
        );
        await waitUntilExit();
      } finally {
        logStream.write(`${formatLogTime(Date.now())} [ops] [info] launcher stopped\n`);
        logStream.end();
      }
    } while (restartRequested);
  } finally {
    restore();
  }
}

function createLauncherLogFilePath(): string {
  const logsDir = join(paths.repoRoot, "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  const stamp = formatFileTime(new Date());
  return join(logsDir, `log-${stamp}.txt`);
}

function formatFileTime(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function formatLogTime(ts: number): string {
  const date = new Date(ts);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${hour}:${minute}:${second}`;
}

function writeLogLine(
  stream: ReturnType<typeof createWriteStream>,
  entry: LogEntry,
) {
  const safeText = entry.text.replace(/\r?\n/g, " ");
  stream.write(`${formatLogTime(entry.ts)} [${entry.source}] [${entry.level}] ${safeText}\n`);
}


