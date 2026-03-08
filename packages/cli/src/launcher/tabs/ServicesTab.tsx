import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { useServices } from "../hooks/useServices.ts";
import type { LauncherI18n } from "../i18n/index.ts";

type Services = ReturnType<typeof useServices>;

interface ServicesTabProps {
  services: Services;
  autoStart: boolean;
  connectionProfile: "lan" | "tunnel";
  i18n: LauncherI18n;
}

const ITEMS = ["relay", "tunnel", "daemon"] as const;
type ServiceKey = (typeof ITEMS)[number];

const LABELS: Record<ServiceKey, string> = {
  relay: "Relay Server",
  tunnel: "Cloudflare Tunnel",
  daemon: "Daemon",
};

const STATUS_COLOR: Record<string, string> = {
  stopped: "gray",
  starting: "yellow",
  running: "green",
  error: "red",
};

export function ServicesTab({ services, autoStart, connectionProfile, i18n }: ServicesTabProps) {
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [installConfirm, setInstallConfirm] = useState(false);
  const lanActive = services.state.relay.status === "running"
    && services.state.daemon.status === "running"
    && services.state.tunnel.status !== "running"
    && services.state.tunnel.status !== "starting";
  const tunnelActive = services.state.relay.status === "running"
    && services.state.daemon.status === "running"
    && services.state.tunnel.status === "running";

  // 自动启动（仅首次）
  const startedRef = React.useRef(false);
  React.useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      const action = connectionProfile === "lan"
        ? services.startLanConnection()
        : services.startTunnelConnection();
      void action;
    }
  }, [autoStart, connectionProfile, services]);

  useInput((input, key) => {
    if (busy) return;

    if (installConfirm && input !== "i") {
      setInstallConfirm(false);
    }

    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(ITEMS.length - 1, c + 1));

    if (key.return) {
      const svc = ITEMS[cursor];
      const status = services.state[svc].status;
      setBusy(true);
      const action = status === "running" ? stopService(svc) : startService(svc);
      action.finally(() => setBusy(false));
    }

    if (input === "a") {
      setBusy(true);
      services.startAll().finally(() => setBusy(false));
    }
    if (input === "x") {
      setBusy(true);
      services.stopAll().finally(() => setBusy(false));
    }
    if (input === "l") {
      setBusy(true);
      const action = lanActive ? services.stopLanConnection() : services.startLanConnection();
      action.finally(() => setBusy(false));
    }
    if (input === "t") {
      setBusy(true);
      const action = tunnelActive ? services.stopTunnelConnection() : services.startTunnelConnection();
      action.finally(() => setBusy(false));
    }
    if (input === "r" || input === "f") {
      setBusy(true);
      services.refreshCloudflaredService().finally(() => setBusy(false));
    }
    if (input === "R") {
      const svc = ITEMS[cursor];
      setBusy(true);
      restartService(svc).finally(() => setBusy(false));
    }
    if (input === "i") {
      if (!installConfirm) {
        setInstallConfirm(true);
        return;
      }
      setInstallConfirm(false);
      setBusy(true);
      services.installCloudflaredService().finally(() => setBusy(false));
    }
  });

  function startService(svc: ServiceKey) {
    switch (svc) {
      case "relay": return services.startRelay();
      case "tunnel": return services.startTunnel();
      case "daemon": return services.startDaemon();
    }
  }

  function stopService(svc: ServiceKey) {
    switch (svc) {
      case "relay": return services.stopRelay();
      case "tunnel": return services.stopTunnel();
      case "daemon": return services.stopDaemon();
    }
  }

  async function restartService(svc: ServiceKey) {
    const status = services.state[svc].status;
    if (status === "starting") return;
    if (status === "running") {
      await stopService(svc);
    }
    await startService(svc);
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold underline>{i18n.t("services.title")}</Text>
      <Box flexDirection="column" marginLeft={1}>
        {ITEMS.map((svc, i) => {
          const info = services.state[svc];
          const selected = i === cursor;
          const actionHint = info.status === "running"
            ? i18n.t("services.action.enter_stop_restart")
            : i18n.t("services.action.enter_start");
          return (
            <Box key={svc} gap={1}>
              <Text color={selected ? "cyan" : "white"}>{selected ? ">" : " "}</Text>
              <Text color={STATUS_COLOR[info.status]}>*</Text>
              <Text bold={selected}>{LABELS[svc].padEnd(22)}</Text>
              <Text color={STATUS_COLOR[info.status]}>{i18n.statusLabel(info.status).padEnd(10)}</Text>
              <Text dimColor>{info.pid ? `PID:${info.pid}` : ""}</Text>
              {selected && <Text dimColor> [{actionHint}]</Text>}
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>{i18n.t("services.profile.title")}</Text>
        <Box flexDirection="column" marginLeft={1}>
          <Box gap={1}>
            <Text color={lanActive ? "green" : "gray"}>*</Text>
            <Text>{i18n.t("services.profile.lan")}</Text>
            <Text dimColor>{lanActive ? i18n.t("services.profile.active") : i18n.t("services.profile.inactive")}</Text>
          </Box>
          <Box gap={1}>
            <Text color={tunnelActive ? "green" : "gray"}>*</Text>
            <Text>{i18n.t("services.profile.tunnel")}</Text>
            <Text dimColor>{tunnelActive ? i18n.t("services.profile.active") : i18n.t("services.profile.inactive")}</Text>
          </Box>
          <Text dimColor>{i18n.t("services.profile.hotkeys")}</Text>
          {lanActive && services.cloudflaredService.running ? (
            <Text color="yellow">{i18n.t("services.profile.lan_cloudflared_running")}</Text>
          ) : null}
        </Box>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>{i18n.t("services.cf.title")}</Text>
        {!services.cloudflaredService.supported ? (
          <Text dimColor>{i18n.t("services.cf.windows_only")}</Text>
        ) : (
          <Box flexDirection="column" marginLeft={1}>
            <Text>
              <Text color={services.cloudflaredService.running ? "green" : "yellow"}>*</Text>
              {" "}
              {i18n.t("services.cf.status", { detail: services.cloudflaredService.detail || i18n.t("common.unknown") })}
            </Text>
            <Text dimColor>
              {i18n.t("services.cf.meta", {
                installed: services.cloudflaredService.installed ? i18n.t("common.yes") : i18n.t("common.no"),
                running: services.cloudflaredService.running ? i18n.t("common.yes") : i18n.t("common.no"),
              })}
            </Text>
            <Text dimColor wrap="truncate">{i18n.t("services.cf.bin_path", { path: services.cloudflaredService.binPath || i18n.t("common.none") })}</Text>
            {services.cloudflaredService.lastBackupDir ? (
              <Text dimColor wrap="truncate">{i18n.t("services.cf.last_backup", { path: services.cloudflaredService.lastBackupDir })}</Text>
            ) : null}
            {services.cloudflaredService.installing ? (
              <Text color="yellow">{i18n.t("services.cf.installing")}</Text>
            ) : null}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{i18n.t("services.hotkeys")}</Text>
      </Box>
      {installConfirm ? (
        <Box>
          <Text color="yellow">{i18n.t("services.install_confirm")}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
