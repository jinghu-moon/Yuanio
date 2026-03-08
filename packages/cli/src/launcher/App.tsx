import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { TabBar, type TabId } from "./components/TabBar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { DashboardTab } from "./tabs/DashboardTab.tsx";
import { ServicesTab } from "./tabs/ServicesTab.tsx";
import { PairTab } from "./tabs/PairTab.tsx";
import { MonitorTab } from "./tabs/MonitorTab.tsx";
import { LogsTab } from "./tabs/LogsTab.tsx";
import { SkillsTab } from "./tabs/SkillsTab.tsx";
import { ConfigTab } from "./tabs/ConfigTab.tsx";
import { useServices } from "./hooks/useServices.ts";
import { useDaemon } from "./hooks/useDaemon.ts";
import { useRemoteMonitor } from "./hooks/useRemoteMonitor.ts";
import type { LogEntry } from "./components/LogViewer.tsx";
import type { LauncherConfig } from "./config.ts";
import { createI18n } from "./i18n/index.ts";
import { validateRelayRuntimeEnv } from "@yuanio/shared";
import { paths } from "@/paths.ts";

interface AppProps {
  config: LauncherConfig;
  onRestart?: () => void;
  onLogEntry?: (entry: LogEntry) => void;
}

const TAB_ORDER: TabId[] = ["dashboard", "services", "pair", "monitor", "logs", "skills", "config"];

function Separator() {
  return (
    <Box paddingX={0}>
      <Text dimColor>{"-".repeat(process.stdout.columns ? process.stdout.columns - 4 : 76)}</Text>
    </Box>
  );
}

export function App({ config, onRestart, onLogEntry }: AppProps) {
  const app = useApp();
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<LauncherConfig>(config);
  const [inputLocked, setInputLocked] = useState(false);
  const i18n = useMemo(() => createI18n(runtimeConfig.language), [runtimeConfig.language]);
  const startupGuideLoggedRef = useRef<string | null>(null);
  const relayEnvErrors = useMemo(
    () => validateRelayRuntimeEnv({ env: process.env, startDir: paths.repoRoot, workspaceRoot: paths.repoRoot }),
    [],
  );
  const startupGuide = useMemo(
    () => relayEnvErrors.length > 0
      ? i18n.t("app.banner.relay_env_invalid", { reason: relayEnvErrors.join(", ") })
      : null,
    [i18n, relayEnvErrors],
  );

  const addLog = useCallback((entry: Omit<LogEntry, "ts">) => {
    const fullEntry: LogEntry = { ...entry, ts: Date.now() };
    onLogEntry?.(fullEntry);
    setLogs((prev) => {
      const next = [...prev, fullEntry];
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, [onLogEntry]);

  const services = useServices({ config: runtimeConfig, addLog, i18n });
  const daemon = useDaemon(services.state.daemon);
  const monitor = useRemoteMonitor(activeTab === "monitor", i18n);

  useEffect(() => {
    if (!startupGuide) {
      startupGuideLoggedRef.current = null;
      return;
    }
    if (startupGuideLoggedRef.current === startupGuide) return;
    startupGuideLoggedRef.current = startupGuide;
    addLog({
      source: "ops",
      level: "warn",
      text: i18n.t("app.log.relay_env_invalid", { reason: relayEnvErrors.join(", ") }),
    });
  }, [addLog, i18n, relayEnvErrors, startupGuide]);

  const restartLauncher = useCallback(() => {
    addLog({ source: "ops", level: "info", text: i18n.t("app.log.restarting_launcher") });
    services.stopAll().finally(() => {
      onRestart?.();
      app.exit();
    });
  }, [addLog, app, i18n, onRestart, services]);

  const reloadDaemonAfterPair = useCallback(async () => {
    const daemonStatus = services.state.daemon.status;
    if (daemonStatus !== "running" && daemonStatus !== "starting") return;
    addLog({ source: "ops", level: "info", text: i18n.t("app.log.reloading_daemon_after_pair") });
    try {
      await services.reloadDaemonSession();
      await services.reloadRemoteBridge();
      addLog({ source: "ops", level: "info", text: i18n.t("app.log.reloaded_daemon_after_pair") });
      return;
    } catch (hotReloadErr: any) {
      addLog({
        source: "ops",
        level: "warn",
        text: i18n.t("app.log.reload_daemon_hot_failed_fallback_restart", {
          error: hotReloadErr?.message || String(hotReloadErr),
        }),
      });
    }

    try {
      await services.stopDaemon();
      await services.startDaemon();
      await services.reloadRemoteBridge();
      addLog({ source: "ops", level: "info", text: i18n.t("app.log.reloaded_daemon_after_pair") });
    } catch (err: any) {
      addLog({
        source: "ops",
        level: "error",
        text: i18n.t("app.log.reload_daemon_after_pair_failed", { error: err?.message || String(err) }),
      });
    }
  }, [addLog, i18n, services]);

  useInput((input, key) => {
    if (inputLocked) return;
    if (input === "q") {
      services.stopAll().finally(() => app.exit());
      return;
    }
    if (input === "0") {
      restartLauncher();
      return;
    }
    const isShiftTab = (key.tab && key.shift) || input === "\u001b[Z";
    const isTab = key.tab
      || input === "\t"
      || input === String.fromCharCode(9)
      || (key.ctrl && input.toLowerCase() === "i");
    if (isTab || isShiftTab) {
      setActiveTab((prev) => {
        const currentIndex = Math.max(0, TAB_ORDER.indexOf(prev));
        const nextIndex = isShiftTab
          ? (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
          : (currentIndex + 1) % TAB_ORDER.length;
        return TAB_ORDER[nextIndex];
      });
      return;
    }
    if (input === "1") setActiveTab("dashboard");
    if (input === "2") setActiveTab("services");
    if (input === "3") setActiveTab("pair");
    if (input === "4") setActiveTab("monitor");
    if (input === "5") setActiveTab("logs");
    if (input === "6") setActiveTab("skills");
    if (input === "7") setActiveTab("config");
  });

  const renderTab = () => {
    switch (activeTab) {
      case "dashboard":
        return <DashboardTab services={services} daemon={daemon} logs={logs} config={runtimeConfig} i18n={i18n} />;
      case "services":
        return (
          <ServicesTab
            services={services}
            autoStart={runtimeConfig.autoStart}
            connectionProfile={runtimeConfig.connectionProfile}
            i18n={i18n}
          />
        );
      case "pair": {
        const relayOnline = services.state.relay.status === "running" || services.state.relay.status === "starting";
        const lanProfileActive = services.state.relay.status === "running"
          && services.state.daemon.status === "running"
          && services.state.tunnel.status !== "running"
          && services.state.tunnel.status !== "starting";
        const tunnelProfileActive = services.state.relay.status === "running"
          && services.state.daemon.status === "running"
          && services.state.tunnel.status === "running";
        const preferLanPair = lanProfileActive
          ? true
          : tunnelProfileActive
            ? false
            : runtimeConfig.connectionProfile === "lan";

        const localServerUrl = `http://localhost:${runtimeConfig.relayPort}`;
        const localRelayUrl = relayOnline ? services.state.relay.url : undefined;
        const pairServerUrl = preferLanPair
          ? (localRelayUrl || localServerUrl)
          : (services.state.tunnel.publicUrl || runtimeConfig.serverUrl);

        return <PairTab
          serverUrl={pairServerUrl}
          localRelayUrl={localRelayUrl}
          namespace={runtimeConfig.namespace}
          i18n={i18n}
          onPairSuccess={reloadDaemonAfterPair}
          onEnsureRelay={async () => { await services.startRelay(); }}
          onDone={() => setActiveTab("dashboard")}
        />;
      }
      case "monitor":
        return <MonitorTab monitor={monitor} i18n={i18n} />;
      case "logs":
        return <LogsTab entries={logs} onClear={() => setLogs([])} i18n={i18n} />;
      case "skills":
        return <SkillsTab daemonPort={services.state.daemon.port} i18n={i18n} />;
      case "config":
        return (
          <ConfigTab
            config={runtimeConfig}
            i18n={i18n}
            onApply={(next) => {
              setRuntimeConfig(next);
              const nextI18n = createI18n(next.language);
              addLog({ source: "ops", level: "info", text: nextI18n.t("app.log.config_saved_restart") });
            }}
            onEditStateChange={setInputLocked}
          />
        );
    }
  };

  const termHeight = process.stdout.rows || 24;

  return (
    <Box flexDirection="column" height={termHeight} justifyContent="center" alignItems="center" width="100%">
      <Box flexDirection="column" width="100%" borderStyle="classic" borderColor="gray">
      <Box justifyContent="center" paddingX={1}>
        <Text bold color="cyan">{i18n.t("app.title")}</Text>
      </Box>
      {startupGuide ? (
        <Box paddingX={1}>
          <Text color="yellow">{startupGuide}</Text>
        </Box>
      ) : null}
      <Separator />
      <TabBar active={activeTab} onChange={setActiveTab} i18n={i18n} />
      <Separator />
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {renderTab()}
      </Box>
      <Separator />
      <StatusBar state={services.state} i18n={i18n} />
      </Box>
    </Box>
  );
}

