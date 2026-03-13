<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconMoon, IconSun } from "@tabler/icons-vue";
import QRCode from "qrcode";

type ServiceStatus = "stopped" | "starting" | "running" | "error";
type ServiceInfo = {
  status: ServiceStatus;
  pid?: number;
  port?: number;
  url?: string;
  publicUrl?: string;
};
type ServiceState = {
  relay: ServiceInfo;
  daemon: ServiceInfo;
  tunnel: ServiceInfo;
};
type CloudflaredStatus = "unknown" | "checking" | "ready" | "missing" | "error";
type CloudflaredServiceState = {
  supported: boolean;
  status: CloudflaredStatus;
  installed: boolean;
  running: boolean;
  checking: boolean;
  installing: boolean;
  binPath?: string;
  lastBackupDir?: string;
  detail?: string;
};
type ServiceProfile = "lan" | "tunnel" | "idle";
type ServiceSnapshot = {
  service: ServiceState;
  cloudflared: CloudflaredServiceState;
  profile: ServiceProfile;
};
type PairStatus = "idle" | "generating" | "waiting" | "success" | "timeout" | "error";
type PairingPrepareResponse = {
  pairing_code: string;
  server_url: string;
  namespace: string;
};
type PairingPollResponse = {
  status: "waiting" | "success" | "timeout" | "error" | "idle";
  message?: string | null;
};
type MonitorSession = {
  sessionId: string;
  role?: string;
  onlineCount?: number;
  hasAgentOnline?: boolean;
  hasAppOnline?: boolean;
};
type MonitorLine = {
  id: string;
  ts: number;
  type: string;
  text: string;
  sessionId: string;
};
type MonitorSessionsResponse = {
  currentSessionId?: string | null;
  sessions?: MonitorSession[];
};
type MonitorMessagesResponse = {
  lines?: MonitorLine[];
  nextCursor?: number | null;
};

const theme = ref<"dark" | "light">("dark");
const pairingCode = ref("");
const logs = ref<string[]>([]);
const serverUrl = ref("http://localhost:3000");
const relayPort = ref(3000);
const tunnelMode = ref<"quick" | "named">("quick");
const tunnelName = ref("");
const tunnelHostname = ref("");
const pairingMode = ref<"start" | "join">("start");
const pairingNamespace = ref("default");
const serviceState = ref<ServiceState>({
  relay: { status: "stopped", port: relayPort.value, url: `http://localhost:${relayPort.value}` },
  daemon: { status: "stopped" },
  tunnel: { status: "stopped" },
});
const cloudflaredState = ref<CloudflaredServiceState | null>(null);
const activeProfile = ref<ServiceProfile>("idle");
const pairStatus = ref<PairStatus>("idle");
const pairError = ref("");
const pairOpMessage = ref("");
const pairQrData = ref<string | null>(null);
const pairChecking = ref(false);
const pairControlReady = ref<boolean | null>(null);
const pairMobileReady = ref<boolean | null>(null);
const pairLanIp = ref<string | null>(null);
let pairPollTimer: ReturnType<typeof setTimeout> | null = null;
const monitorReady = ref(false);
const monitorStatus = ref("等待连接");
const monitorError = ref<string | null>(null);
const monitorSessions = ref<MonitorSession[]>([]);
const monitorCurrentSessionId = ref<string | null>(null);
const monitorSelectedSessionId = ref<string | null>(null);
const monitorLines = ref<MonitorLine[]>([]);
const monitorLogs = new Map<string, MonitorLine[]>();
const monitorSeenIds = new Map<string, Set<string>>();
const monitorAfterCursor = new Map<string, number>();
const monitorPolling = { sessions: false, messages: false };
let monitorSessionsTimer: ReturnType<typeof setInterval> | null = null;
let monitorMessagesTimer: ReturnType<typeof setInterval> | null = null;

const statusLabels: Record<ServiceStatus, string> = {
  running: "运行中",
  starting: "启动中",
  stopped: "已停止",
  error: "异常",
};

const profileLabel = computed(() => {
  if (activeProfile.value === "lan") return "LAN";
  if (activeProfile.value === "tunnel") return "Tunnel";
  return "未连接";
});

const cloudflaredLabel = computed(() => {
  const state = cloudflaredState.value;
  if (!state) return "未知";
  if (!state.supported) return "不支持";
  if (state.status === "missing") return "未安装";
  if (state.status === "checking") return "检测中";
  if (state.status === "error") return "异常";
  if (state.status === "ready" && state.running) return "运行中";
  if (state.status === "ready") return "已安装";
  return "未知";
});

const themeLabel = computed(() => (theme.value === "dark" ? "浅色" : "深色"));

const pairStatusLabel = computed(() => {
  if (pairStatus.value === "generating") return "准备中";
  if (pairStatus.value === "waiting") return "等待扫码";
  if (pairStatus.value === "success") return "已完成";
  if (pairStatus.value === "timeout") return "已超时";
  if (pairStatus.value === "error") return "失败";
  return "待命";
});

const monitorReadonlySelection = computed(() => {
  return !!monitorSelectedSessionId.value
    && !!monitorCurrentSessionId.value
    && monitorSelectedSessionId.value !== monitorCurrentSessionId.value;
});

const localRelayUrl = computed(() => {
  if (serviceState.value.relay.status !== "running") return null;
  return serviceState.value.relay.url ?? null;
});

const pairServerUrl = computed(() => localRelayUrl.value ?? serverUrl.value);
const isLanPair = computed(() => !pairServerUrl.value.startsWith("https://"));
const displayPairUrl = computed(() => {
  const baseUrl = pairServerUrl.value;
  if (!pairLanIp.value) return baseUrl;
  return baseUrl.replace(/localhost|127\.0\.0\.1/i, pairLanIp.value);
});

const statusTone = (status: ServiceStatus) => {
  if (status === "running") return "online";
  if (status === "starting") return "warn";
  return "offline";
};

const badgeTone = (status: ServiceStatus) => {
  if (status === "running") return "green";
  if (status === "starting") return "blue";
  return "red";
};

const readinessLabel = (value: boolean | null) => {
  if (value === null) return "未知";
  return value ? "可用" : "不可用";
};

const normalizeRelayPort = () => {
  const port = Number(relayPort.value);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return 3000;
  return Math.floor(port);
};

const setTheme = (value: "dark" | "light") => {
  document.documentElement.dataset.theme = value;
  if (isTauri()) {
    void getCurrentWindow().setTheme(value);
  }
};

const appendLog = (text: string) => {
  const stamp = new Date().toLocaleTimeString();
  logs.value = [`[${stamp}] ${text}`, ...logs.value].slice(0, 8);
};

const applyServiceSnapshot = (snapshot: ServiceSnapshot) => {
  serviceState.value = snapshot.service;
  cloudflaredState.value = snapshot.cloudflared;
  activeProfile.value = snapshot.profile;
};

const refreshStatus = async () => {
  try {
    const [snapshot, appStatus, newLogs] = await Promise.all([
      invoke<ServiceSnapshot>("service_state"),
      invoke<{ paired: boolean; session?: { session_id: string } }>("app_status"),
      invoke<string[]>("app_logs"),
    ]);
    applyServiceSnapshot(snapshot);
    if (appStatus?.paired) {
      appendLog(`已配对（session ${appStatus.session?.session_id ?? "?"}）。`);
    } else {
      appendLog("尚未配对。");
    }
    if (newLogs.length > 0) {
      logs.value = newLogs.slice().reverse().slice(0, 8);
    }
    void refreshReadiness();
  } catch (err: any) {
    appendLog(`状态刷新失败：${err?.message || String(err)}`);
  }
};

const startProfile = async (profile: "lan" | "tunnel"): Promise<boolean> => {
  try {
    const snapshot = await invoke<ServiceSnapshot>("service_start_profile", {
      profile,
      serverUrl: serverUrl.value,
      relayPort: normalizeRelayPort(),
      tunnelMode: tunnelMode.value,
      tunnelName: tunnelName.value,
      tunnelHostname: tunnelHostname.value,
    });
    applyServiceSnapshot(snapshot);
    appendLog(`已请求启动 ${profile === "lan" ? "LAN" : "Tunnel"}。`);
    return true;
  } catch (err: any) {
    appendLog(`启动失败：${err?.message || String(err)}`);
    return false;
  }
};

const stopAll = async () => {
  try {
    const snapshot = await invoke<ServiceSnapshot>("service_stop_all");
    applyServiceSnapshot(snapshot);
    appendLog("已请求停止所有服务。");
  } catch (err: any) {
    appendLog(`停止失败：${err?.message || String(err)}`);
  }
};

const reloadBridge = async () => {
  try {
    const snapshot = await invoke<ServiceSnapshot>("remote_bridge_reload");
    applyServiceSnapshot(snapshot);
    appendLog("已请求重载远程桥接。");
  } catch (err: any) {
    appendLog(`桥接重载失败：${err?.message || String(err)}`);
  }
};

const refreshCloudflared = async () => {
  try {
    const state = await invoke<CloudflaredServiceState>("cloudflared_refresh");
    cloudflaredState.value = state;
  } catch (err: any) {
    appendLog(`Cloudflared 刷新失败：${err?.message || String(err)}`);
  }
};

const installCloudflared = async () => {
  if (!tunnelName.value.trim()) {
    appendLog("Tunnel 名称为空，无法安装 Cloudflared 服务。");
    return;
  }
  try {
    const state = await invoke<CloudflaredServiceState>("cloudflared_install", {
      tunnelName: tunnelName.value.trim(),
      relayPort: normalizeRelayPort(),
    });
    cloudflaredState.value = state;
    appendLog("已请求安装 Cloudflared 服务。");
  } catch (err: any) {
    appendLog(`Cloudflared 安装失败：${err?.message || String(err)}`);
  }
};

const healthUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/health`;

const probeHealth = async (baseUrl: string, timeoutMs = 3000): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrl(baseUrl), { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const waitHealth = async (baseUrl: string, timeoutMs = 15000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(baseUrl, 3000)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
};

const isLocalServerUrl = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(trimmed);
  }
};

const refreshReadiness = async () => {
  pairChecking.value = true;
  try {
    pairLanIp.value = await invoke<string | null>("local_ipv4");
    const [controlOk, mobileOk] = await Promise.all([
      probeHealth(pairServerUrl.value, 3000),
      isLanPair.value ? probeHealth(displayPairUrl.value, 3000) : Promise.resolve<boolean | null>(null),
    ]);
    pairControlReady.value = controlOk;
    pairMobileReady.value = mobileOk;
  } finally {
    pairChecking.value = false;
  }
};

const ensureControlReady = async (): Promise<boolean> => {
  pairOpMessage.value = "检测控制端健康...";
  let ready = await probeHealth(pairServerUrl.value, 3000);
  if (ready) {
    pairOpMessage.value = "";
    return true;
  }

  if (isLocalServerUrl(serverUrl.value)) {
    pairOpMessage.value = "控制端未就绪，尝试启动本地 Relay...";
    const started = await startProfile("lan");
    if (!started) {
      pairOpMessage.value = "启动 Relay 失败";
      await refreshReadiness();
      return false;
    }
    ready = await waitHealth(pairServerUrl.value, 15000);
    pairOpMessage.value = ready ? "" : "控制端启动超时";
    await refreshReadiness();
    return ready;
  }

  pairOpMessage.value = "控制端不可用，请检查地址或网络";
  await refreshReadiness();
  return false;
};

const MONITOR_MAX_LINES = 2000;

const shortSessionId = (value: string) => value.slice(0, 8);

const formatMonitorText = (value: string) => {
  const flattened = value.replace(/\r?\n/g, "\\n");
  return flattened.length > 300 ? `${flattened.slice(0, 300)}...` : flattened;
};

const applyMonitorSelection = (sessionId: string | null) => {
  monitorSelectedSessionId.value = sessionId;
  monitorLines.value = sessionId ? monitorLogs.get(sessionId) ?? [] : [];
};

const fetchMonitorSessions = async () => {
  if (monitorPolling.sessions) return;
  monitorPolling.sessions = true;
  try {
    const resp = await invoke<MonitorSessionsResponse>("monitor_sessions");
    const sessions = resp.sessions ?? [];
    monitorSessions.value = sessions;
    monitorCurrentSessionId.value = resp.currentSessionId ?? null;
    monitorReady.value = true;
    monitorError.value = null;
    monitorStatus.value = `已连接 · ${sessions.length} 会话`;

    const selected = monitorSelectedSessionId.value;
    const selectedExists = !!selected && sessions.some((item) => item.sessionId === selected);
    if (!selectedExists) {
      const fallback = resp.currentSessionId ?? sessions[0]?.sessionId ?? null;
      applyMonitorSelection(fallback);
    } else if (selected) {
      monitorLines.value = monitorLogs.get(selected) ?? [];
    }
  } catch (err: any) {
    const message = err?.message || String(err);
    monitorReady.value = false;
    if (message.includes("尚未配对")) {
      monitorStatus.value = "尚未配对";
      monitorError.value = null;
      monitorSessions.value = [];
      monitorCurrentSessionId.value = null;
      applyMonitorSelection(null);
    } else {
      monitorStatus.value = "监控不可用";
      monitorError.value = message;
    }
  } finally {
    monitorPolling.sessions = false;
  }
};

const fetchMonitorMessages = async () => {
  if (monitorPolling.messages) return;
  const sessionId = monitorCurrentSessionId.value;
  if (!sessionId) return;
  monitorPolling.messages = true;
  try {
    const afterCursor = monitorAfterCursor.get(sessionId) ?? 0;
    const resp = await invoke<MonitorMessagesResponse>("monitor_messages", {
      sessionId,
      afterCursor,
      limit: 200,
    });
    const lines = resp.lines ?? [];
    if (resp.nextCursor !== undefined && resp.nextCursor !== null) {
      monitorAfterCursor.set(sessionId, resp.nextCursor);
    }

    if (lines.length > 0) {
      const seen = monitorSeenIds.get(sessionId) ?? new Set<string>();
      const prev = monitorLogs.get(sessionId) ?? [];
      const appended: MonitorLine[] = [];

      for (const line of lines) {
        if (seen.has(line.id)) continue;
        seen.add(line.id);
        appended.push({
          ...line,
          text: formatMonitorText(line.text),
        });
      }

      if (appended.length > 0) {
        const next = [...prev, ...appended].slice(-MONITOR_MAX_LINES);
        monitorLogs.set(sessionId, next);
        if (monitorSelectedSessionId.value === sessionId) {
          monitorLines.value = next;
        }
      }

      monitorSeenIds.set(sessionId, seen);
    }
  } catch (err: any) {
    const message = err?.message || String(err);
    monitorError.value = message;
    monitorStatus.value = "监控不可用";
    monitorReady.value = false;
  } finally {
    monitorPolling.messages = false;
  }
};

const refreshMonitorNow = async () => {
  await fetchMonitorSessions();
  await fetchMonitorMessages();
};

const clearMonitorLines = () => {
  const sessionId = monitorSelectedSessionId.value;
  if (!sessionId) return;
  monitorLogs.set(sessionId, []);
  monitorSeenIds.set(sessionId, new Set());
  if (monitorSelectedSessionId.value === sessionId) {
    monitorLines.value = [];
  }
};

const selectMonitorSession = (sessionId: string) => {
  applyMonitorSelection(sessionId);
};

const clearPairingPoll = () => {
  if (pairPollTimer) {
    clearTimeout(pairPollTimer);
    pairPollTimer = null;
  }
};

const schedulePairingPoll = () => {
  clearPairingPoll();
  pairPollTimer = setTimeout(async () => {
    if (pairStatus.value !== "waiting") return;
    try {
      const result = await invoke<PairingPollResponse>("pairing_poll", { code: pairingCode.value });
      if (result.status === "idle") {
        pairStatus.value = "idle";
        pairError.value = result.message || "";
        return;
      }
      if (result.status === "success") {
        pairStatus.value = "success";
        pairError.value = "";
        await refreshStatus();
        return;
      }
      if (result.status === "timeout") {
        pairStatus.value = "timeout";
        pairError.value = result.message || "";
        return;
      }
      if (result.status === "error") {
        pairStatus.value = "error";
        pairError.value = result.message || "配对失败";
        return;
      }
    } catch (err: any) {
      pairStatus.value = "error";
      pairError.value = err?.message || String(err);
      return;
    }
    schedulePairingPoll();
  }, 2000);
};

const resetPairingState = () => {
  pairStatus.value = "idle";
  pairError.value = "";
  pairOpMessage.value = "";
  pairQrData.value = null;
  clearPairingPoll();
};

const buildPairingQr = async (code: string, namespace: string) => {
  const payload = JSON.stringify({
    server: displayPairUrl.value,
    code,
    namespace,
  });
  pairQrData.value = await QRCode.toDataURL(payload, { width: 168, margin: 1 });
};

const startPairing = async () => {
  resetPairingState();
  pairStatus.value = "generating";
  const ready = await ensureControlReady();
  if (!ready) {
    pairStatus.value = "error";
    pairError.value = pairOpMessage.value || "控制端不可用";
    return;
  }
  try {
    const resp = await invoke<PairingPrepareResponse>("pairing_prepare", {
      serverUrl: pairServerUrl.value,
      namespace: pairingNamespace.value.trim() || undefined,
    });
    pairingCode.value = resp.pairing_code;
    pairingNamespace.value = resp.namespace;
    await refreshReadiness();
    await buildPairingQr(resp.pairing_code, resp.namespace);
    pairStatus.value = "waiting";
    pairOpMessage.value = "";
    schedulePairingPoll();
  } catch (err: any) {
    pairStatus.value = "error";
    pairError.value = err?.message || String(err);
  }
};

const cancelPairing = async () => {
  clearPairingPoll();
  try {
    await invoke("pairing_cancel");
    appendLog("已取消配对。");
  } catch (err: any) {
    appendLog(`取消配对失败：${err?.message || String(err)}`);
  } finally {
    resetPairingState();
  }
};

const joinPairing = async () => {
  resetPairingState();
  pairStatus.value = "generating";
  const ready = await ensureControlReady();
  if (!ready) {
    pairStatus.value = "error";
    pairError.value = pairOpMessage.value || "控制端不可用";
    return;
  }
  const code = pairingCode.value.trim();
  if (!code) {
    pairStatus.value = "error";
    pairError.value = "配对码为空";
    return;
  }
  try {
    await invoke("pairing_join", { serverUrl: pairServerUrl.value, code });
    pairStatus.value = "success";
    pairError.value = "";
    pairOpMessage.value = "";
    await refreshStatus();
  } catch (err: any) {
    pairStatus.value = "error";
    pairError.value = err?.message || String(err);
  }
};

const submitPairing = () => {
  if (pairingMode.value === "join") {
    appendLog(`提交配对码 ${pairingCode.value.trim() || "-"}，等待远端响应。`);
    void joinPairing();
    return;
  }
  appendLog("开始创建配对码...");
  void startPairing();
};

const scanPairing = () => {
  appendLog("等待扫码结果（桌面端只做入口展示）。");
};

const toggleTheme = () => {
  theme.value = theme.value === "dark" ? "light" : "dark";
};

onMounted(() => {
  setTheme(theme.value);
  appendLog("桌面壳初始化完成。");
  refreshStatus();
  void refreshReadiness();
  void refreshMonitorNow();
  monitorSessionsTimer = setInterval(() => { void fetchMonitorSessions(); }, 3000);
  monitorMessagesTimer = setInterval(() => { void fetchMonitorMessages(); }, 5000);
});

watch(theme, (value) => setTheme(value));

watch(relayPort, (value) => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 1 || next > 65535) {
    return;
  }
  if (serviceState.value.relay.status === "running" || serviceState.value.relay.status === "starting") {
    return;
  }
  serviceState.value.relay.port = next;
  serviceState.value.relay.url = `http://localhost:${next}`;
});

watch(pairingMode, () => {
  if (pairStatus.value === "waiting") {
    void cancelPairing();
    return;
  }
  resetPairingState();
});

onBeforeUnmount(() => {
  clearPairingPoll();
  if (monitorSessionsTimer) {
    clearInterval(monitorSessionsTimer);
    monitorSessionsTimer = null;
  }
  if (monitorMessagesTimer) {
    clearInterval(monitorMessagesTimer);
    monitorMessagesTimer = null;
  }
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span>Yuanio Desktop</span>
      </div>
      <div class="row">
        <button
          class="icon-btn"
          type="button"
          :aria-label="`切换为${themeLabel}`"
          :title="`切换为${themeLabel}`"
          @click="toggleTheme"
        >
          <IconSun v-if="theme === 'dark'" class="icon" :size="18" stroke-width="2" />
          <IconMoon v-else class="icon" :size="18" stroke-width="2" />
        </button>
      </div>
    </header>

    <div class="content">
      <section class="section">
        <div class="row">
          <h2 class="section-title">服务概览</h2>
          <span class="badge blue">当前：{{ profileLabel }}</span>
        </div>
        <p class="section-desc">保留 CLI 逻辑，桌面端负责状态展示与快捷控制。</p>
        <div class="row">
          <input
            v-model="serverUrl"
            class="input"
            type="text"
            placeholder="控制端地址（如 http://localhost:3000）"
          />
          <input
            v-model.number="relayPort"
            class="input"
            type="number"
            min="1"
            max="65535"
            placeholder="Relay 端口"
          />
          <button class="btn btn-ghost btn-sm" type="button" @click="refreshStatus">刷新状态</button>
        </div>
        <div class="row">
          <span class="section-desc">Tunnel 模式</span>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :class="{ active: tunnelMode === 'quick' }"
            @click="tunnelMode = 'quick'"
          >
            Quick
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :class="{ active: tunnelMode === 'named' }"
            @click="tunnelMode = 'named'"
          >
            Named
          </button>
        </div>
        <div class="row" v-if="tunnelMode === 'named'">
          <input
            v-model="tunnelName"
            class="input"
            type="text"
            placeholder="Tunnel 名称（如 yuanio-main）"
          />
          <input
            v-model="tunnelHostname"
            class="input"
            type="text"
            placeholder="Tunnel Hostname（如 xxx.trycloudflare.com）"
          />
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">Relay / Daemon</div>
              <span class="badge" :class="badgeTone(serviceState.relay.status)">
                {{ statusLabels[serviceState.relay.status] }}
              </span>
            </div>
            <div class="card-body">
              <div class="row">
                <span class="status-dot" :class="statusTone(serviceState.relay.status)"></span>
                Relay：{{ statusLabels[serviceState.relay.status] }}
                <span class="muted">端口 {{ serviceState.relay.port ?? "-" }}</span>
              </div>
              <div class="row">
                <span class="status-dot" :class="statusTone(serviceState.daemon.status)"></span>
                Daemon：{{ statusLabels[serviceState.daemon.status] }}
                <span class="muted">端口 {{ serviceState.daemon.port ?? "-" }}</span>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">Tunnel</div>
              <span class="badge" :class="badgeTone(serviceState.tunnel.status)">
                {{ statusLabels[serviceState.tunnel.status] }}
              </span>
            </div>
            <div class="card-body">
              <div class="row">
                <span class="status-dot" :class="statusTone(serviceState.tunnel.status)"></span>
                Tunnel：{{ statusLabels[serviceState.tunnel.status] }}
              </div>
              <div class="row" v-if="serviceState.tunnel.publicUrl">
                <span class="muted">URL：{{ serviceState.tunnel.publicUrl }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">快速操作</h2>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="startProfile('lan')">启动 LAN</button>
          <button class="btn btn-secondary" type="button" @click="startProfile('tunnel')">启动 Tunnel</button>
          <button class="btn btn-ghost" type="button" @click="reloadBridge">重载桥接</button>
          <button class="btn btn-ghost" type="button" @click="stopAll">全部停止</button>
        </div>
      </section>

      <section class="section">
        <div class="row">
          <h2 class="section-title">Cloudflared 服务</h2>
          <span class="badge" :class="cloudflaredState?.running ? 'green' : cloudflaredState?.supported ? 'blue' : 'red'">
            {{ cloudflaredLabel }}
          </span>
        </div>
        <p class="section-desc">命名 Tunnel 依赖 Cloudflared 服务（Windows 可管理）。</p>
        <div class="row">
          <button class="btn btn-ghost btn-sm" type="button" @click="refreshCloudflared">刷新</button>
          <button
            class="btn btn-secondary btn-sm"
            type="button"
            :disabled="!cloudflaredState?.supported"
            @click="installCloudflared"
          >
            安装 / 修复
          </button>
        </div>
        <div class="row" v-if="cloudflaredState">
          <span class="muted">状态：{{ cloudflaredLabel }}</span>
          <span class="muted" v-if="cloudflaredState.binPath">路径：{{ cloudflaredState.binPath }}</span>
        </div>
        <div class="row" v-if="cloudflaredState?.lastBackupDir">
          <span class="muted">备份：{{ cloudflaredState.lastBackupDir }}</span>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">配对入口</h2>
        <div class="row">
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :class="{ active: pairingMode === 'start' }"
            @click="pairingMode = 'start'"
          >
            创建配对
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :class="{ active: pairingMode === 'join' }"
            @click="pairingMode = 'join'"
          >
            加入配对
          </button>
          <span class="badge" :class="pairStatus === 'success' ? 'green' : pairStatus === 'error' ? 'red' : 'blue'">
            {{ pairStatusLabel }}
          </span>
        </div>
        <div class="row">
          <input
            v-if="pairingMode === 'start'"
            v-model="pairingNamespace"
            class="input"
            type="text"
            placeholder="命名空间（默认 default）"
          />
          <input
            v-model="pairingCode"
            class="input"
            type="text"
            placeholder="输入配对码（如 123-456）"
          />
          <button
            class="btn btn-primary"
            type="button"
            :disabled="pairStatus === 'waiting' || pairStatus === 'generating'"
            @click="submitPairing"
          >
            {{ pairingMode === 'start' ? '生成配对码' : '提交配对' }}
          </button>
          <button class="btn btn-ghost" type="button" @click="scanPairing">扫码</button>
          <button
            v-if="pairStatus === 'waiting'"
            class="btn btn-ghost"
            type="button"
            @click="cancelPairing"
          >
            取消
          </button>
        </div>
        <p class="section-desc">
          {{ pairingMode === 'start'
            ? '创建配对后可用移动端加入。'
            : '输入移动端显示的配对码完成绑定。' }}
        </p>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">连接检测</div>
              <span class="badge" :class="pairControlReady === false ? 'red' : pairControlReady ? 'green' : 'blue'">
                {{ readinessLabel(pairControlReady) }}
              </span>
            </div>
            <div class="card-body">
              <div class="row">
                <span class="muted">控制端</span>
                <span>{{ pairServerUrl }}</span>
              </div>
              <div class="row">
                <span class="muted">移动端</span>
                <span>{{ displayPairUrl }}</span>
              </div>
              <div class="row">
                <span class="muted">LAN IP</span>
                <span>{{ pairLanIp || "-" }}</span>
              </div>
              <div class="row">
                <span class="muted">控制端健康</span>
                <span>{{ readinessLabel(pairControlReady) }}</span>
              </div>
              <div class="row" v-if="isLanPair">
                <span class="muted">移动端健康</span>
                <span>{{ readinessLabel(pairMobileReady) }}</span>
              </div>
              <div class="row">
                <button class="btn btn-ghost btn-sm" type="button" @click="refreshReadiness" :disabled="pairChecking">
                  {{ pairChecking ? '检测中...' : '刷新检测' }}
                </button>
              </div>
              <div class="row" v-if="pairOpMessage">
                <span class="muted">{{ pairOpMessage }}</span>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">扫码配对</div>
              <span class="badge blue">{{ pairStatusLabel }}</span>
            </div>
            <div class="card-body">
              <div class="qr-box">
                <img v-if="pairQrData" :src="pairQrData" alt="pairing-qr" />
                <span v-else class="muted">暂无二维码</span>
              </div>
              <div class="row">
                <span class="muted">状态：{{ pairStatusLabel }}</span>
              </div>
              <div class="row" v-if="pairError">
                <span class="muted">错误：{{ pairError }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="row">
          <h2 class="section-title">远程监控</h2>
          <span class="badge" :class="monitorReady ? 'green' : monitorError ? 'red' : 'blue'">
            {{ monitorStatus }}
          </span>
        </div>
        <p class="section-desc">展示当前会话的消息流与在线状态。</p>
        <div class="row">
          <button class="btn btn-ghost btn-sm" type="button" @click="refreshMonitorNow">
            刷新
          </button>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :disabled="!monitorSelectedSessionId"
            @click="clearMonitorLines"
          >
            清空当前会话
          </button>
          <span v-if="monitorError" class="muted">错误：{{ monitorError }}</span>
        </div>
        <div class="grid monitor-grid">
          <div class="card">
            <div class="card-header">
              <div class="card-title">会话列表</div>
              <span class="muted">{{ monitorSessions.length }} 个</span>
            </div>
            <div class="card-body session-list">
              <div v-if="monitorSessions.length === 0" class="muted">暂无会话。</div>
              <button
                v-for="session in monitorSessions"
                :key="session.sessionId"
                class="session-item"
                :class="{ active: monitorSelectedSessionId === session.sessionId }"
                type="button"
                @click="selectMonitorSession(session.sessionId)"
              >
                <span class="session-id">{{ shortSessionId(session.sessionId) }}</span>
                <span class="session-meta">
                  {{ session.role || "unknown" }} · online: {{ session.onlineCount ?? 0 }}
                </span>
                <span class="session-flags">
                  {{ session.hasAgentOnline ? "A" : "-" }}{{ session.hasAppOnline ? "M" : "-" }}
                </span>
              </button>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">
                输出 {{ monitorSelectedSessionId ? `(${shortSessionId(monitorSelectedSessionId)})` : "" }}
              </div>
              <span class="muted">共 {{ monitorLines.length }} 条</span>
            </div>
            <div class="card-body monitor-lines">
              <div v-if="monitorReadonlySelection" class="monitor-hint">
                当前仅支持查看本机会话的实时日志。
              </div>
              <div v-if="monitorLines.length === 0" class="muted">暂无消息。</div>
              <div v-for="line in monitorLines" :key="line.id" class="monitor-line">
                <span class="monitor-time">{{ new Date(line.ts).toLocaleTimeString() }}</span>
                <span class="monitor-type">[{{ line.type }}]</span>
                <span class="monitor-text">{{ line.text }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">最近日志</h2>
        <div class="log-list">
          <div v-if="logs.length === 0" class="log-item muted">暂无日志。</div>
          <div v-for="item in logs" :key="item" class="log-item">{{ item }}</div>
        </div>
      </section>
    </div>
  </main>
</template>
