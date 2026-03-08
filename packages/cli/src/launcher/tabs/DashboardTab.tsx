import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { useServices } from "../hooks/useServices.ts";
import type { useDaemon } from "../hooks/useDaemon.ts";
import type { LogEntry } from "../components/LogViewer.tsx";
import type { LauncherConfig } from "../config.ts";
import type { LauncherI18n } from "../i18n/index.ts";
import { createUniqueRenderKeys } from "../render-keys.ts";

type Services = ReturnType<typeof useServices>;
type Daemon = ReturnType<typeof useDaemon>;

interface DashboardTabProps {
  services: Services;
  daemon: Daemon;
  logs: LogEntry[];
  config: LauncherConfig;
  i18n: LauncherI18n;
}

const STATUS_ICON: Record<string, string> = {
  stopped: "o",
  starting: "~",
  running: "*",
  error: "x",
};

const STATUS_COLOR: Record<string, string> = {
  stopped: "gray",
  starting: "yellow",
  running: "green",
  error: "red",
};

interface KeyValueItem {
  label: string;
  value: string;
  truncate?: boolean;
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100
    && (
      codePoint <= 0x115f
      || codePoint === 0x2329
      || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x1f300 && codePoint <= 0x1f64f)
      || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  );
}

function stringDisplayWidth(input: string): number {
  let width = 0;
  for (const ch of input) {
    const codePoint = ch.codePointAt(0);
    if (!codePoint) continue;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) continue;
    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function getLabelColumnWidth(items: KeyValueItem[], min: number, max: number): number {
  const widest = items.reduce((acc, item) => Math.max(acc, stringDisplayWidth(item.label)), 0);
  return Math.max(min, Math.min(max, widest + 1));
}

function KeyValueList({
  items,
  minLabelWidth,
  maxLabelWidth,
}: {
  items: KeyValueItem[];
  minLabelWidth: number;
  maxLabelWidth: number;
}) {
  const labelWidth = getLabelColumnWidth(items, minLabelWidth, maxLabelWidth);

  return (
    <Box flexDirection="column">
      {items.map((item, idx) => (
        <Box key={`${item.label}-${idx}`} gap={1}>
          <Box width={labelWidth}>
            <Text dimColor>{item.label}</Text>
          </Box>
          <Text wrap={item.truncate ? "truncate" : undefined}>{item.value}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function DashboardTab({ services, daemon, logs, config, i18n }: DashboardTabProps) {
  const { relay, tunnel, daemon: daemonState } = services.state;
  const [uptime, setUptime] = useState(0);

  const configItems: KeyValueItem[] = [
    { label: i18n.t("dashboard.config.namespace"), value: config.namespace },
    { label: i18n.t("dashboard.config.server"), value: config.serverUrl, truncate: true },
    { label: i18n.t("dashboard.config.relay_port"), value: String(config.relayPort) },
    { label: i18n.t("dashboard.config.tunnel"), value: config.tunnelMode },
  ];

  useEffect(() => {
    const t = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <Box gap={3}>
      {/* 左栏：服务 + 会话 + 快捷键 */}
      <Box flexDirection="column" gap={1} width="50%">
        <Box flexDirection="column">
          <Text bold underline>{i18n.t("dashboard.section.service_status")}</Text>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            <ServiceRow label={i18n.t("dashboard.service.relay")} status={relay.status} detail={i18n.t("dashboard.detail.port", { port: relay.port })} i18n={i18n} />
            <ServiceRow label={i18n.t("dashboard.service.tunnel")} status={tunnel.status} detail={tunnel.publicUrl || i18n.t("common.none")} i18n={i18n} />
            <ServiceRow label={i18n.t("dashboard.service.daemon")} status={daemonState.status} detail={daemonState.port ? i18n.t("dashboard.detail.port", { port: daemonState.port }) : i18n.t("common.none")} i18n={i18n} />
          </Box>
        </Box>

        {tunnel.publicUrl && (
          <Box flexDirection="column">
            <Text bold underline>{i18n.t("dashboard.section.public_url")}</Text>
            <Box marginTop={1} marginLeft={2}>
              <Text color="cyan">{tunnel.publicUrl}</Text>
            </Box>
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold underline>{i18n.t("dashboard.section.sessions")}</Text>
          <Box marginTop={1} marginLeft={2}>
            <Text>{i18n.t("dashboard.active_sessions", { count: daemon.sessions.length })}</Text>
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text bold underline>{i18n.t("dashboard.section.current_config")}</Text>
          <Box marginTop={1} marginLeft={2}>
            <KeyValueList items={configItems} minLabelWidth={10} maxLabelWidth={20} />
          </Box>
        </Box>

        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>{i18n.t("dashboard.section.shortcuts")}</Text>
          <Box marginTop={1} marginLeft={2} flexDirection="column">
            <Text dimColor>{i18n.t("dashboard.shortcuts.line")}</Text>
          </Box>
        </Box>
      </Box>

      {/* 右栏：系统信息 + 最近日志 */}
      <Box flexDirection="column" gap={1} width="50%">
        <SystemInfo uptime={uptime} i18n={i18n} />
        <RecentLogs logs={logs} i18n={i18n} />
      </Box>
    </Box>
  );
}

function ServiceRow({
  label,
  status,
  detail,
  i18n,
}: {
  label: string;
  status: string;
  detail: string;
  i18n: LauncherI18n;
}) {
  return (
    <Box gap={1}>
      <Text color={STATUS_COLOR[status]}>{STATUS_ICON[status]}</Text>
      <Box width={20}>
        <Text>{label}</Text>
      </Box>
      <Box width={10}>
        <Text color={STATUS_COLOR[status]}>{i18n.statusLabel(status)}</Text>
      </Box>
      <Text dimColor wrap="truncate">{detail}</Text>
    </Box>
  );
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function SystemInfo({ uptime, i18n }: { uptime: number; i18n: LauncherI18n }) {
  const items: KeyValueItem[] = [
    { label: i18n.t("dashboard.system.uptime"), value: formatUptime(uptime) },
    { label: i18n.t("dashboard.system.runtime"), value: `Bun ${typeof Bun !== "undefined" ? Bun.version : "?"}` },
    { label: i18n.t("dashboard.system.platform"), value: `${process.platform} ${process.arch}` },
    { label: i18n.t("dashboard.system.node"), value: process.version },
    { label: i18n.t("dashboard.system.pid"), value: String(process.pid) },
  ];

  return (
    <Box flexDirection="column">
      <Text bold underline>{i18n.t("dashboard.section.system_info")}</Text>
      <Box marginTop={1} marginLeft={2}>
        <KeyValueList items={items} minLabelWidth={8} maxLabelWidth={14} />
      </Box>
    </Box>
  );
}

const SOURCE_COLOR: Record<string, string> = {
  relay: "blue",
  tunnel: "magenta",
  daemon: "cyan",
  ops: "yellow",
};

function RecentLogs({ logs, i18n }: { logs: LogEntry[]; i18n: LauncherI18n }) {
  const recent = logs.slice(-8);
  const recentKeys = createUniqueRenderKeys(
    recent,
    (entry) => `${entry.ts}:${entry.source}:${entry.level}:${entry.text}`,
    "dashboard-log",
  );

  return (
    <Box flexDirection="column">
      <Text bold underline>{i18n.t("dashboard.section.recent_logs")}</Text>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {recent.length === 0 ? (
          <Text dimColor>{i18n.t("dashboard.logs.empty")}</Text>
        ) : (
          recent.map((entry, i) => {
            const time = new Date(entry.ts).toLocaleTimeString(i18n.locale);
            return (
              <Text key={recentKeys[i]} wrap="truncate">
                <Text dimColor>{time} </Text>
                <Text color={SOURCE_COLOR[entry.source] || "white"}>[{entry.source}]</Text>
                {" "}
                <Text>{entry.text}</Text>
              </Text>
            );
          })
        )}
      </Box>
    </Box>
  );
}
