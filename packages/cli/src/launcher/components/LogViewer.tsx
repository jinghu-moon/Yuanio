import React from "react";
import { Box, Text } from "ink";
import type { LauncherI18n } from "../i18n/index.ts";
import { createUniqueRenderKeys } from "../render-keys.ts";

export interface LogEntry {
  ts: number;
  source: "relay" | "tunnel" | "daemon" | "ops";
  level: "info" | "warn" | "error";
  text: string;
}

const SOURCE_COLOR: Record<LogEntry["source"], string> = {
  relay: "blue",
  tunnel: "magenta",
  daemon: "cyan",
  ops: "yellow",
};

const LEVEL_COLOR: Record<LogEntry["level"], string> = {
  info: "white",
  warn: "yellow",
  error: "red",
};

interface LogViewerProps {
  entries: LogEntry[];
  maxLines?: number;
  i18n: LauncherI18n;
}

export function LogViewer({ entries, maxLines = 100, i18n }: LogViewerProps) {
  const visible = entries.slice(-maxLines);
  const entryKeys = createUniqueRenderKeys(
    visible,
    (entry) => `${entry.ts}:${entry.source}:${entry.level}:${entry.text}`,
    "log-viewer",
  );

  if (visible.length === 0) {
    return <Text dimColor>{i18n.t("logs.empty")}</Text>;
  }

  return (
    <Box flexDirection="column">
      {visible.map((entry, i) => {
        const time = new Date(entry.ts).toLocaleTimeString(i18n.locale);
        return (
          <Text key={entryKeys[i]} wrap="truncate">
            <Text dimColor>{time}</Text>
            {" "}
            <Text color={SOURCE_COLOR[entry.source]} bold>[{entry.source}]</Text>
            {" "}
            <Text color={LEVEL_COLOR[entry.level]}>{entry.text}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
