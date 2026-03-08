import React from "react";
import { Box, Text, useInput } from "ink";
import type { RemoteMonitorState } from "../hooks/useRemoteMonitor.ts";
import type { LauncherI18n } from "../i18n/index.ts";
import { createUniqueRenderKeys } from "../render-keys.ts";

interface MonitorTabProps {
  monitor: RemoteMonitorState;
  i18n: LauncherI18n;
}

function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export function MonitorTab({ monitor, i18n }: MonitorTabProps) {
  const selectedIndex = monitor.selectedSessionId
    ? monitor.sessions.findIndex((s) => s.sessionId === monitor.selectedSessionId)
    : -1;

  useInput((input, key) => {
    if (key.upArrow && monitor.sessions.length > 0) {
      const idx = selectedIndex <= 0 ? monitor.sessions.length - 1 : selectedIndex - 1;
      monitor.setSelectedSessionId(monitor.sessions[idx].sessionId);
      return;
    }
    if (key.downArrow && monitor.sessions.length > 0) {
      const idx = selectedIndex < 0 || selectedIndex >= monitor.sessions.length - 1 ? 0 : selectedIndex + 1;
      monitor.setSelectedSessionId(monitor.sessions[idx].sessionId);
      return;
    }
    if (input === "c") {
      monitor.clearSelectedLines();
      return;
    }
    if (input === "r") {
      void monitor.refreshNow();
    }
  });

  const maxRows = Math.max(8, (process.stdout.rows >> 24) - 14);
  const visibleLines = monitor.lines.slice(-maxRows);
  const sessionKeys = createUniqueRenderKeys(monitor.sessions, (session) => session.sessionId, "monitor-session");
  const lineKeys = createUniqueRenderKeys(visibleLines, (line) => line.id, "monitor-line");

  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between">
        <Text bold underline>{i18n.t("monitor.title")}</Text>
        <Text dimColor>{i18n.t("monitor.hotkeys")}</Text>
      </Box>

      {!monitor.ready && (
        <Box flexDirection="column" marginLeft={1}>
          <Text color="yellow">{monitor.status}</Text>
          {monitor.error && <Text color="red">{monitor.error}</Text>}
        </Box>
      )}

      {monitor.ready && (
        <Box flexDirection="column" gap={1}>
          <Box gap={2}>
          <Box flexDirection="column" width={36}>
            <Text bold>{i18n.t("monitor.session_list", { count: monitor.sessions.length })}</Text>
            <Box flexDirection="column" marginTop={1}>
              {monitor.sessions.length === 0 && <Text dimColor>{i18n.t("monitor.no_sessions")}</Text>}
              {monitor.sessions.map((session, i) => {
                const selected = monitor.selectedSessionId === session.sessionId;
                const current = monitor.currentSessionId === session.sessionId;
                const role = session.role.padEnd(5);
                const online = `online:${session.onlineCount}`;
                return (
                  <Text key={sessionKeys[i]} color={selected ? "cyan" : "white"} wrap="truncate">
                    {selected ? ">" : " "}
                    {current ? "*" : " "}
                    {" "}
                    {shortId(session.sessionId)}
                    {" "}
                    {role}
                    {" "}
                    {online}
                    {" "}
                    {session.hasAgentOnline ? "A" : "-"}
                    {session.hasAppOnline ? "M" : "-"}
                    {i === selectedIndex ? "  <-" : ""}
                  </Text>
                );
              })}
            </Box>
          </Box>

          <Box flexDirection="column" flexGrow={1}>
            <Box justifyContent="space-between">
              <Text bold>
                {i18n.t("monitor.output", {
                  session: monitor.selectedSessionId ? `(${shortId(monitor.selectedSessionId)})` : "",
                })}
              </Text>
              <Text dimColor>{i18n.t("monitor.total_lines", { count: monitor.lines.length })}</Text>
            </Box>

            <Box flexDirection="column" marginTop={1}>
              {monitor.readonlySelection && (
                <Text color="yellow">
                  {i18n.t("monitor.readonly_selection_hint")}
                </Text>
              )}
              {visibleLines.length === 0 && <Text dimColor>{i18n.t("monitor.no_messages")}</Text>}
              {visibleLines.map((line, i) => (
                <Text key={lineKeys[i]} wrap="truncate">
                  <Text dimColor>{new Date(line.ts).toLocaleTimeString(i18n.locale)}</Text>
                  {" "}
                  <Text color="blue">[{line.type}]</Text>
                  {" "}
                  {line.text}
                </Text>
              ))}
            </Box>
          </Box>
          </Box>
          <Box>
            <Text dimColor>{i18n.t("monitor.readonly_input_hint")}</Text>
          </Box>
        </Box>
      )}

      <Box>
        <Text dimColor>{monitor.error ? i18n.t("monitor.error_prefix", { error: monitor.error }) : monitor.status}</Text>
      </Box>
    </Box>
  );
}
