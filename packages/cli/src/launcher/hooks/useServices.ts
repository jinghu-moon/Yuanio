import { useState, useCallback, useRef, useEffect } from "react";
import { spawn, type Subprocess } from "bun";
import { paths } from "@/paths.ts";
import type { LogEntry } from "../components/LogViewer.tsx";
import type { LauncherConfig } from "../config.ts";
import type { LauncherI18n } from "../i18n/index.ts";
import { resolveRelayLaunchEnv } from "../relay-runtime.ts";

export interface ServiceInfo {
  status: "stopped" | "starting" | "running" | "error";
  pid?: number;
  port?: number;
  url?: string;
  publicUrl?: string;
}

export interface ServiceState {
  relay: ServiceInfo & { port: number; url: string };
  tunnel: ServiceInfo & { publicUrl?: string };
  daemon: ServiceInfo & { port?: number };
}

export interface CloudflaredServiceState {
  supported: boolean;
  status: "unknown" | "checking" | "ready" | "missing" | "error";
  installed: boolean;
  running: boolean;
  checking: boolean;
  installing: boolean;
  binPath?: string;
  lastBackupDir?: string;
  detail?: string;
}

type AddLog = (entry: Omit<LogEntry, "ts">) => void;

interface UseServicesOptions {
  config: LauncherConfig;
  addLog: AddLog;
  i18n: LauncherI18n;
}

function relayUrlFor(port: number): string {
  return `http://localhost:${port}`;
}

export function useServices({ config, addLog, i18n }: UseServicesOptions) {
  const { serverUrl, relayPort, tunnelMode, tunnelName, tunnelHostname, namespace } = config;
  const { t } = i18n;

  const [state, setState] = useState<ServiceState>({
    relay: { status: "stopped", port: relayPort, url: relayUrlFor(relayPort) },
    tunnel: { status: "stopped" },
    daemon: { status: "stopped" },
  });
  const [cloudflaredService, setCloudflaredService] = useState<CloudflaredServiceState>(() => ({
    supported: process.platform === "win32",
    status: process.platform === "win32" ? "unknown" : "ready",
    installed: false,
    running: false,
    checking: false,
    installing: false,
    detail: process.platform === "win32" ? t("service.cf.detail.not_checked") : t("service.cf.detail.windows_only"),
  }));

  const procs = useRef<{
    relay?: Subprocess;
    tunnel?: Subprocess;
    daemon?: Subprocess;
    remoteBridge?: Subprocess;
    serviceInstall?: Subprocess;
  }>({});
  const tunnelManagedByService = useRef(false);

  // 鐢?ref 闀滃儚 state锛屼緵 startAll 绛夊紓姝ユ祦绋嬭鍙栨渶鏂板€?
const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // 閰嶇疆鏇存柊鍚庯紝鍚屾鈥滄湭杩愯鐘舵€佲€濅笅鐨?relay 鍦板潃灞曠ず涓庡悗缁粯璁ょ洰鏍囧湴鍧€
  useEffect(() => {
    if (state.relay.status === "running" || state.relay.status === "starting") return;
    const nextUrl = relayUrlFor(relayPort);
    if (state.relay.port === relayPort && state.relay.url === nextUrl) return;
    setState((prev) => ({ ...prev, relay: { ...prev.relay, port: relayPort, url: nextUrl } }));
  }, [relayPort, state.relay.port, state.relay.status, state.relay.url]);

  // 娓呯悊鍑芥暟锛氱粍浠跺嵏杞芥椂缁堟鎵€鏈夎繘绋?
useEffect(() => {
    return () => {
      for (const proc of Object.values(procs.current)) {
        try { proc?.kill("SIGTERM"); } catch {}
      }
    };
  }, []);

  const update = useCallback(
    <K extends keyof ServiceState>(key: K, patch: Partial<ServiceState[K]>) => {
      setState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    },
    [],
  );

  // --- Relay ---
  const startRelay = useCallback(async () => {
    if (stateRef.current.relay.status === "running" || stateRef.current.relay.status === "starting") return true;
    update("relay", { status: "starting", port: relayPort, url: relayUrlFor(relayPort) });
    addLog({ source: "relay", level: "info", text: t("service.log.relay.starting") });

    try {
      const relayEntry = paths.relay("index.ts");
      const relayLaunch = resolveRelayLaunchEnv({ env: process.env, port: relayPort, repoRoot: paths.repoRoot });
      const proc = spawn({
        cmd: [process.execPath, "run", relayEntry],
        cwd: paths.relayRoot,
        env: relayLaunch.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      procs.current.relay = proc;

      pipeOutput(proc, "relay", addLog, (line) => {
        if (line.includes("listening") || line.includes("Started") || line.includes("ready") || line.includes("running on")) {
          update("relay", { status: "running", pid: proc.pid, port: relayPort, url: relayUrlFor(relayPort) });
          addLog({ source: "relay", level: "info", text: t("service.log.relay.started_pid", { pid: proc.pid }) });
        }
      });

      // 瓒呮椂妫€娴?
setTimeout(() => {
        setState((s) => {
          if (s.relay.status === "starting") {
            // 鍙兘 stdout 娌℃湁鏄庣‘鐨?ready 淇″彿锛屽皾璇?health check
            checkRelayHealth(relayPort).then((ok) => {
              if (ok) update("relay", { status: "running", pid: proc.pid, port: relayPort, url: relayUrlFor(relayPort) });
              else update("relay", { status: "error" });
            });
          }
          return s;
        });
      }, 8000);

      proc.exited.then((code) => {
        procs.current.relay = undefined;
        update("relay", { status: "stopped", pid: undefined, port: relayPort, url: relayUrlFor(relayPort) });
        addLog({ source: "relay", level: code === 0 ? "info" : "error", text: t("service.log.relay.exited_code", { code }) });
      });
      return true;
    } catch (err: any) {
      update("relay", { status: "error" });
      addLog({ source: "relay", level: "error", text: t("service.log.relay.start_failed", { message: err.message }) });
      return false;
    }
  }, [addLog, relayPort, t]);

  const stopRelay = useCallback(async () => {
    const proc = procs.current.relay;
    if (!proc) return;
    addLog({ source: "relay", level: "info", text: t("service.log.relay.stopping") });
    proc.kill("SIGTERM");
    await proc.exited;
  }, [t]);

  // --- Tunnel ---
  const startTunnel = useCallback(async () => {
    if (stateRef.current.tunnel.status === "running" || stateRef.current.tunnel.status === "starting") return;
    const relayReady = stateRef.current.relay.status === "running" || await checkRelayHealth(relayPort);
    if (!relayReady) {
      addLog({ source: "tunnel", level: "error", text: t("service.log.tunnel.relay_required") });
      return;
    }
    if (stateRef.current.relay.status !== "running") {
      update("relay", { status: "running", port: relayPort, url: relayUrlFor(relayPort) });
    }
    update("tunnel", { status: "starting" });
    tunnelManagedByService.current = false;

    const useServiceManagedNamedTunnel = process.platform === "win32"
      && tunnelMode === "named"
      && !!tunnelHostname
      && cloudflaredService.running;
    if (useServiceManagedNamedTunnel) {
      const publicUrl = `https://${tunnelHostname}`;
      tunnelManagedByService.current = true;
      addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.use_service_managed") });
      update("tunnel", { status: "starting", publicUrl });
      addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.public_url", { url: publicUrl }) });
      addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.verify_public") });
      const ok = await waitForHealth(`${publicUrl}/health`, 60000);
      if (ok) {
        update("tunnel", { status: "running", pid: undefined, publicUrl });
        addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.public_ready") });
      } else {
        update("tunnel", { status: "error", pid: undefined, publicUrl });
        addLog({ source: "tunnel", level: "error", text: t("service.log.tunnel.public_health_failed") });
      }
      return;
    }

    try {
      const cloudflaredPath = await resolveCommand("cloudflared");
      if (!cloudflaredPath) {
        update("tunnel", { status: "error" });
        addLog({ source: "tunnel", level: "error", text: t("service.log.tunnel.cloudflared_missing") });
        return;
      }

      // 鍓ョ浠ｇ悊鐜鍙橀噺锛岄伩鍏嶅共鎵?cloudflared 鐨?tunnel 杩炴帴
      const cleanEnv = { ...process.env };
      for (const key of Object.keys(cleanEnv)) {
        if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete cleanEnv[key];
      }

      const isNamed = tunnelMode === "named" && tunnelName;
      const cmd = isNamed
        ? [cloudflaredPath, "tunnel", "run", tunnelName]
        : [cloudflaredPath, "tunnel", "--url", `http://localhost:${relayPort}`];

      addLog({
        source: "tunnel",
        level: "info",
        text: isNamed
          ? t("service.log.tunnel.start_named", { name: tunnelName, host: tunnelHostname })
          : t("service.log.tunnel.start_quick"),
      });

      const proc = spawn({ cmd, env: cleanEnv, stdout: "pipe", stderr: "pipe" });
      procs.current.tunnel = proc;

      let discovered = false;

      const markPublicUrl = (publicUrl: string) => {
        if (discovered) return;
        discovered = true;
        update("tunnel", { status: "starting", pid: proc.pid, publicUrl });
        addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.public_url", { url: publicUrl }) });
        addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.verify_public") });
        void (async () => {
          const ok = await waitForHealth(`${publicUrl}/health`, 60000);
          if (procs.current.tunnel !== proc) return;
          if (ok) {
            update("tunnel", { status: "running", pid: proc.pid, publicUrl });
            addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.public_ready") });
            return;
          }
          update("tunnel", { status: "error", pid: proc.pid, publicUrl });
          addLog({
            source: "tunnel",
            level: "error",
            text: t("service.log.tunnel.public_health_failed"),
          });
        })();
      };

      if (isNamed) {
        // named tunnel: URL 宸茬煡锛岀瓑 "Registered tunnel connection" 纭杩為€?
pipeOutput(proc, "tunnel", addLog, (line) => {
          if (discovered) return;
          if (line.includes("Registered tunnel connection")) {
            const publicUrl = `https://${tunnelHostname}`;
            markPublicUrl(publicUrl);
          }
        });
      } else {
        // quick tunnel: 浠?stderr 鎹曡幏涓存椂 URL
        pipeOutput(proc, "tunnel", addLog, (line) => {
          if (discovered) return;
          const m = line.match(/https:\/\/[a-z0-9._-]+\.trycloudflare\.com/i);
          if (m) {
            markPublicUrl(m[0]);
          }
        });
      }

      setTimeout(() => {
        if (!discovered && procs.current.tunnel === proc) {
          update("tunnel", { status: "error" });
          addLog({ source: "tunnel", level: "error", text: t("service.log.tunnel.ready_timeout") });
        }
      }, 30000);

      proc.exited.then((code) => {
        procs.current.tunnel = undefined;
        tunnelManagedByService.current = false;
        update("tunnel", { status: "stopped", pid: undefined, publicUrl: undefined });
        addLog({ source: "tunnel", level: code === 0 ? "info" : "error", text: t("service.log.tunnel.exited_code", { code }) });
      });
    } catch (err: any) {
      tunnelManagedByService.current = false;
      update("tunnel", { status: "error" });
      addLog({ source: "tunnel", level: "error", text: t("service.log.tunnel.start_failed", { message: err.message }) });
    }
  }, [cloudflaredService.running, relayPort, tunnelMode, tunnelName, tunnelHostname, t]);

  const stopTunnel = useCallback(async () => {
    if (tunnelManagedByService.current) {
      tunnelManagedByService.current = false;
      update("tunnel", { status: "stopped", pid: undefined, publicUrl: undefined });
      addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.stop_service_managed") });
      return;
    }

    const proc = procs.current.tunnel;
    if (!proc) return;
    addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.stopping") });
    proc.kill("SIGTERM");
    await proc.exited;
  }, [t]);

  // --- Daemon ---
  const startDaemon = useCallback(async () => {
    // 浠ヨ繘绋嬪彞鏌勪负鍑嗭紝閬垮厤 stop鈫抯tart 杩炵画璋冪敤鏃惰鏃х姸鎬佹嫤鎴?
if (procs.current.daemon) return;
    update("daemon", { status: "starting" });
    addLog({ source: "daemon", level: "info", text: t("service.log.daemon.starting") });

    // Daemon 涓?Relay 鍚屾満锛屼紭鍏堢洿杩炴湰鍦帮紱tunnel URL 鏄粰澶栭儴瀹㈡埛绔敤鐨?
const targetUrl = (stateRef.current.relay.status === "running" || stateRef.current.relay.status === "starting")
      ? stateRef.current.relay.url
      : serverUrl;

    try {
      const daemonScript = paths.cli("daemon-process.ts");
      const proc = spawn({
        cmd: [process.execPath, "run", daemonScript, "--server", targetUrl],
        cwd: paths.cliRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      procs.current.daemon = proc;

      pipeOutput(proc, "daemon", addLog, (line) => {
        const daemonPortMatch = line.match(/PID=\d+.*(?:绔彛|port)\s*[=:]\s*(\d+)/i);
        if (daemonPortMatch) {
          update("daemon", { status: "running", pid: proc.pid, port: Number(daemonPortMatch[1]) });
        }
        if (line.includes("listening") || line.includes("started") || line.includes("ready")) {
          update("daemon", { status: "running", pid: proc.pid });
          addLog({ source: "daemon", level: "info", text: t("service.log.daemon.started_pid", { pid: proc.pid }) });
        }
      });

      // 5 绉掑悗濡傛灉杩樺湪 starting锛屾爣璁颁负 running锛坉aemon 鍙兘娌℃湁鏄庣‘鐨?ready 淇″彿锛?
setTimeout(() => {
        setState((s) => {
          if (s.daemon.status === "starting" && procs.current.daemon) {
            update("daemon", { status: "running", pid: procs.current.daemon.pid });
          }
          return s;
        });
      }, 5000);

      proc.exited.then((code) => {
        // 浠呭湪褰撳墠鍙ユ焺浠嶆寚鍚戣杩涚▼鏃跺洖鏀剁姸鎬侊紝閬垮厤瑕嗙洊鏂版媺璧风殑 daemon 鐘舵€?
if (procs.current.daemon === proc) {
          procs.current.daemon = undefined;
          update("daemon", { status: "stopped", pid: undefined, port: undefined });
        }
        addLog({ source: "daemon", level: code === 0 ? "info" : "error", text: t("service.log.daemon.exited_code", { code }) });
      });
    } catch (err: any) {
      update("daemon", { status: "error" });
      addLog({ source: "daemon", level: "error", text: t("service.log.daemon.start_failed", { message: err.message }) });
    }
  }, [serverUrl, t]);

  const stopDaemon = useCallback(async () => {
    const proc = procs.current.daemon;
    if (!proc) return;
    addLog({ source: "daemon", level: "info", text: t("service.log.daemon.stopping") });
    proc.kill("SIGTERM");
    await proc.exited;
    // 鍏滃簳閲婃斁鍙ユ焺锛岄伩鍏嶉噸鍚摼璺鏃у彞鏌勯樆濉?
if (procs.current.daemon === proc) {
      procs.current.daemon = undefined;
    }
  }, [t]);

  // --- Remote Bridge ---
  const startRemoteBridge = useCallback(async () => {
    if (procs.current.remoteBridge) return;
    addLog({ source: "ops", level: "info", text: t("service.log.bridge.starting") });

    const targetUrl = (stateRef.current.relay.status === "running" || stateRef.current.relay.status === "starting")
      ? stateRef.current.relay.url
      : serverUrl;

    try {
      const cliEntry = paths.cli("index.ts");
      const cmd = [
        process.execPath,
        "run",
        cliEntry,
        "--server",
        targetUrl,
        "--continue",
        "--namespace",
        namespace,
      ];
      const proc = spawn({
        cmd,
        cwd: paths.cliRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      procs.current.remoteBridge = proc;

      pipeOutput(proc, "ops", addLog, (line) => {
        if (line.includes("Yuanio CLI")) {
          addLog({ source: "ops", level: "info", text: t("service.log.bridge.started_pid", { pid: proc.pid }) });
        }
      });

      proc.exited.then((code) => {
        if (procs.current.remoteBridge === proc) {
          procs.current.remoteBridge = undefined;
        }
        addLog({ source: "ops", level: code === 0 ? "info" : "warn", text: t("service.log.bridge.exited_code", { code }) });
      });
    } catch (err: any) {
      addLog({ source: "ops", level: "error", text: t("service.log.bridge.start_failed", { message: err?.message || String(err) }) });
    }
  }, [addLog, namespace, serverUrl, t]);

  const stopRemoteBridge = useCallback(async () => {
    const proc = procs.current.remoteBridge;
    if (!proc) return;
    addLog({ source: "ops", level: "info", text: t("service.log.bridge.stopping") });
    proc.kill("SIGTERM");
    await proc.exited;
    if (procs.current.remoteBridge === proc) {
      procs.current.remoteBridge = undefined;
    }
  }, [addLog, t]);

  const reloadRemoteBridge = useCallback(async () => {
    addLog({ source: "ops", level: "info", text: t("service.log.bridge.reloading") });
    await stopRemoteBridge();
    await startRemoteBridge();
  }, [addLog, startRemoteBridge, stopRemoteBridge, t]);

  const reloadDaemonSession = useCallback(async (): Promise<boolean> => {
    const daemonPort = stateRef.current.daemon.port;
    if (!daemonPort) {
      throw new Error(t("service.log.daemon.rebind_port_missing"));
    }

    addLog({ source: "daemon", level: "info", text: t("service.log.daemon.rebind_start", { port: daemonPort }) });
    const res = await fetch(`http://localhost:${daemonPort}/control/rebind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "pair" }),
    });

    const raw = await res.text();
    let json: any = null;
    try { json = raw ? JSON.parse(raw) : null; } catch {}

    if (!res.ok || !json?.ok) {
      const detail = json?.reason || `HTTP ${res.status}`;
      throw new Error(detail);
    }

    addLog({ source: "daemon", level: "info", text: t("service.log.daemon.rebind_ok") });
    return true;
  }, [addLog, t]);

  const ensureRelayReady = useCallback(async () => {
    // 1. 鍚姩 Relay锛岃疆璇?health 纭灏辩华
    const relayStarted = await startRelay();
    if (!relayStarted) return false;
    addLog({ source: "relay", level: "info", text: t("service.log.relay.wait_ready") });
    const relayOk = await waitForHealth(`http://localhost:${relayPort}/health`, 15000);
    if (!relayOk) {
      addLog({ source: "relay", level: "error", text: t("service.log.relay.start_timeout") });
      return false;
    }
    return true;
  }, [addLog, relayPort, startRelay, t]);

  const startLanConnection = useCallback(async () => {
    addLog({ source: "ops", level: "info", text: t("service.log.profile.lan_start") });
    await stopTunnel();
    const relayOk = await ensureRelayReady();
    if (!relayOk) return;
    await startDaemon();
    await startRemoteBridge();
    if (process.platform === "win32" && cloudflaredService.running) {
      addLog({
        source: "ops",
        level: "warn",
        text: t("service.log.profile.lan_cloudflared_running"),
      });
    }
  }, [addLog, cloudflaredService.running, ensureRelayReady, startDaemon, startRemoteBridge, stopTunnel, t]);

  const stopLanConnection = useCallback(async () => {
    addLog({ source: "ops", level: "info", text: t("service.log.profile.lan_stop") });
    await stopRemoteBridge();
    await stopDaemon();
    await stopTunnel();
    await stopRelay();
  }, [addLog, stopDaemon, stopRelay, stopTunnel, stopRemoteBridge, t]);

  const startTunnelConnection = useCallback(async () => {
    addLog({ source: "ops", level: "info", text: t("service.log.profile.tunnel_start") });
    const relayOk = await ensureRelayReady();
    if (!relayOk) return;

    // 2. 鍚姩 Tunnel锛岃疆璇㈢洿鍒?publicUrl 鍑虹幇涓旂鍒扮杩為€?
await startTunnel();
    addLog({ source: "tunnel", level: "info", text: t("service.log.tunnel.wait_connect") });
    const tunnelOk = await waitForTunnel(stateRef, 30000);
    if (!tunnelOk) {
      addLog({ source: "tunnel", level: "warn", text: t("service.log.tunnel.not_ready_use_cloud") });
    }

    // 3. 鍚姩 Daemon
    await startDaemon();
    await startRemoteBridge();
  }, [addLog, ensureRelayReady, startDaemon, startRemoteBridge, startTunnel, t]);

  const stopTunnelConnection = useCallback(async () => {
    addLog({ source: "ops", level: "info", text: t("service.log.profile.tunnel_stop") });
    await stopRemoteBridge();
    await stopDaemon();
    await stopTunnel();
    await stopRelay();
  }, [addLog, stopDaemon, stopRelay, stopTunnel, stopRemoteBridge, t]);

  // --- 鎵归噺鎿嶄綔锛堝吋瀹规棫璋冪敤锛?---
  const startAll = useCallback(async () => {
    await startTunnelConnection();
  }, [startTunnelConnection]);

  const stopAll = useCallback(async () => {
    await stopTunnelConnection();
  }, [stopTunnelConnection]);

  const refreshCloudflaredService = useCallback(async () => {
    if (process.platform !== "win32") return;
    setCloudflaredService((prev) => ({
      ...prev,
      checking: true,
      status: "checking",
      detail: t("service.cf.detail.checking"),
    }));

    const query = await runCommand(["sc.exe", "query", "cloudflared"]);
    const queryText = `${query.stdout}\n${query.stderr}`;
    const missing = query.code !== 0 && /1060|does not exist/i.test(queryText);

    if (missing) {
      setCloudflaredService((prev) => ({
        ...prev,
        checking: false,
        status: "missing",
        installed: false,
        running: false,
        binPath: undefined,
        detail: t("service.cf.detail.missing"),
      }));
      addLog({ source: "ops", level: "warn", text: t("service.log.cf.missing_install_hint") });
      return;
    }

    const qc = await runCommand(["sc.exe", "qc", "cloudflared"]);
    const qcText = `${qc.stdout}\n${qc.stderr}`;
    const running = /STATE\s*:\s*\d+\s+RUNNING/i.test(queryText);
    const installed = query.code === 0 || /SERVICE_NAME/i.test(queryText);
    const binPath = extractServiceBinPath(qcText);

    setCloudflaredService((prev) => ({
      ...prev,
      checking: false,
      status: installed ? "ready" : "error",
      installed,
      running,
      binPath,
      detail: installed
        ? (running ? t("service.cf.detail.running") : t("service.cf.detail.installed_not_running"))
        : t("service.cf.detail.unknown"),
    }));
  }, [addLog, t]);

  const installCloudflaredService = useCallback(async () => {
    if (process.platform !== "win32") {
      addLog({ source: "ops", level: "warn", text: t("service.log.cf.skip_non_windows") });
      return;
    }

    const scriptPath = paths.script("install-cloudflared-service.ps1");
    const runner = (await resolveCommand("pwsh")) || (await resolveCommand("powershell"));
    if (!runner) {
      setCloudflaredService((prev) => ({
        ...prev,
        status: "error",
        detail: t("service.cf.detail.powershell_missing"),
      }));
      addLog({ source: "ops", level: "error", text: t("service.log.cf.powershell_not_found") });
      return;
    }

    setCloudflaredService((prev) => ({
      ...prev,
      installing: true,
      status: "checking",
      detail: t("service.cf.detail.installing"),
    }));
    addLog({ source: "ops", level: "info", text: t("service.log.cf.run_script", { path: scriptPath }) });

    const args = isPwshLike(runner)
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-TunnelName", tunnelName, "-RelayPort", String(relayPort)]
      : ["-ExecutionPolicy", "Bypass", "-File", scriptPath, "-TunnelName", tunnelName, "-RelayPort", String(relayPort)];

    const proc = spawn({
      cmd: [runner, ...args],
      cwd: paths.repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    procs.current.serviceInstall = proc;
    let backupDirFromLog: string | undefined;

    pipeOutput(proc, "ops", addLog, (line, level) => {
      const backupDir = extractBackupDir(line);
      if (backupDir) backupDirFromLog = backupDir;
      if (level === "warn" && line.toLowerCase().includes("powershell")) {
        setCloudflaredService((prev) => ({
          ...prev,
          status: "error",
          detail: t("service.cf.detail.admin_required"),
        }));
      }
    });

    const code = await proc.exited;
    procs.current.serviceInstall = undefined;

    setCloudflaredService((prev) => ({
      ...prev,
      installing: false,
    }));

    if (code === 0) {
      setCloudflaredService((prev) => ({
        ...prev,
        lastBackupDir: backupDirFromLog || prev.lastBackupDir,
      }));
      addLog({ source: "ops", level: "info", text: t("service.log.cf.done_refreshing") });
      await refreshCloudflaredService();
      return;
    }

    setCloudflaredService((prev) => ({
      ...prev,
      status: "error",
      detail: t("service.cf.detail.failed_code", { code }),
    }));
    addLog({ source: "ops", level: "error", text: t("service.log.cf.failed_code", { code }) });
  }, [addLog, relayPort, refreshCloudflaredService, t, tunnelName]);

  useEffect(() => {
    if (process.platform !== "win32") {
      setCloudflaredService((prev) => ({ ...prev, detail: t("service.cf.detail.windows_only") }));
      return;
    }
    refreshCloudflaredService();
  }, [refreshCloudflaredService, t]);

  return {
    state,
    cloudflaredService,
    startRelay, stopRelay,
    startTunnel, stopTunnel,
    startDaemon, stopDaemon,
    reloadDaemonSession,
    startRemoteBridge, stopRemoteBridge, reloadRemoteBridge,
    startLanConnection, stopLanConnection,
    startTunnelConnection, stopTunnelConnection,
    startAll, stopAll,
    refreshCloudflaredService,
    installCloudflaredService,
  };
}

// --- 宸ュ叿鍑芥暟 ---

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkRelayHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** 杞 health 绔偣锛岀洿鍒拌繑鍥?ok 鎴栬秴鏃?*/
async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await delay(500);
  }
  return false;
}

/** 杞绛夊緟 tunnel publicUrl 鍑虹幇骞堕獙璇佺鍒扮杩為€?*/
async function waitForTunnel(
  stateRef: { current: ServiceState },
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // 鍏堢瓑 publicUrl 鍑虹幇
  while (Date.now() < deadline) {
    const url = stateRef.current.tunnel.publicUrl;
    if (url) {
      // 鍐嶉獙璇?tunnel 鑳戒唬鐞嗗埌 relay
      const ok = await waitForHealth(`${url}/health`, deadline - Date.now());
      return ok;
    }
    await delay(500);
  }
  return false;
}
async function resolveCommand(name: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? ["where", name] : ["which", name];
    const proc = spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const firstLine = output.trim().split("\n")[0]?.trim();
    return firstLine || null;
  } catch {
    return null;
  }
}

async function runCommand(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    readStreamText(proc.stdout as ReadableStream<Uint8Array> | null),
    readStreamText(proc.stderr as ReadableStream<Uint8Array> | null),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function extractServiceBinPath(text: string): string | undefined {
  const m = text.match(/BINARY_PATH_NAME\s*:\s*(.+)$/im);
  return m?.[1]?.trim();
}

function extractBackupDir(text: string): string | undefined {
  const m = text.match(/\[info\]\s*澶囦唤鐩綍:\s*(.+)$/im);
  return m?.[1]?.trim();
}

function isPwshLike(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.includes("pwsh");
}

async function readStreamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

function pipeOutput(
  proc: Subprocess,
  source: LogEntry["source"],
  addLog: AddLog,
  onLine?: (line: string, level: LogEntry["level"]) => void,
) {
  const read = async (stream: ReadableStream<Uint8Array> | null, level: LogEntry["level"]) => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          addLog({ source, level, text: trimmed });
          onLine?.(trimmed, level);
        }
      }
    } catch {}
  };

  read(proc.stdout as ReadableStream<Uint8Array> | null, "info");
  read(proc.stderr as ReadableStream<Uint8Array> | null, "warn");
}


