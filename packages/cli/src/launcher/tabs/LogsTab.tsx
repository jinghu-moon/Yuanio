import React from "react";
import { Box, Text, useInput } from "ink";
import { LogViewer, type LogEntry } from "../components/LogViewer.tsx";
import type { LauncherI18n } from "../i18n/index.ts";

interface LogsTabProps {
  entries: LogEntry[];
  onClear: () => void;
  i18n: LauncherI18n;
}

export function LogsTab({ entries, onClear, i18n }: LogsTabProps) {
  useInput((input) => {
    if (input === "c") onClear();
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between">
        <Text bold underline>{i18n.t("logs.title")}</Text>
        <Text dimColor>{i18n.t("logs.meta", { count: entries.length })}</Text>
      </Box>
      <LogViewer entries={entries} maxLines={30} i18n={i18n} />
    </Box>
  );
}
