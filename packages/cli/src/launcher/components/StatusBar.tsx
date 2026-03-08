import React from "react";
import { Box, Text } from "ink";
import type { ServiceState } from "../hooks/useServices.ts";
import type { LauncherI18n } from "../i18n/index.ts";

type Status = ServiceState[keyof ServiceState]["status"];

const STATUS_COLOR: Record<Status, string> = {
  stopped: "gray",
  starting: "yellow",
  running: "green",
  error: "red",
};

const STATUS_ICON: Record<Status, string> = {
  stopped: "o",
  starting: "~",
  running: "*",
  error: "x",
};

function Indicator({
  label,
  status,
  i18n,
}: {
  label: string;
  status: Status;
  i18n: LauncherI18n;
}) {
  return (
    <Text>
      <Text color={STATUS_COLOR[status]}>{STATUS_ICON[status]}</Text>
      {" "}
      <Text dimColor>{label}:</Text>
      {" "}
      <Text color={STATUS_COLOR[status]}>{i18n.statusLabel(status)}</Text>
    </Text>
  );
}

interface StatusBarProps {
  state: ServiceState;
  i18n: LauncherI18n;
}

export function StatusBar({ state, i18n }: StatusBarProps) {
  return (
    <Box paddingX={1} gap={3}>
      <Indicator label="Relay" status={state.relay.status} i18n={i18n} />
      <Indicator label="Tunnel" status={state.tunnel.status} i18n={i18n} />
      <Indicator label="Daemon" status={state.daemon.status} i18n={i18n} />
      <Box flexGrow={1} />
      <Text dimColor>{i18n.t("statusbar.hotkeys")}</Text>
    </Box>
  );
}
