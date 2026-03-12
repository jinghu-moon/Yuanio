<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";

type ServiceStatus = "online" | "warn" | "offline";

type DaemonStatus = {
  running: boolean;
  pid?: number;
  port?: number;
  version?: string;
  started_at?: string;
  sessions?: string[];
};

const theme = ref<"dark" | "light">("dark");
const pairingCode = ref("");
const logs = ref<string[]>([]);
const serverUrl = ref("http://localhost:3000");
const pairingMode = ref<"start" | "join">("start");
const serviceStatus = ref({
  relay: "offline" as ServiceStatus,
  daemon: "offline" as ServiceStatus,
  tunnel: "warn" as ServiceStatus,
});

const statusLabels: Record<ServiceStatus, string> = {
  online: "运行中",
  warn: "待机",
  offline: "未启动",
};

const themeLabel = computed(() => (theme.value === "dark" ? "浅色" : "深色"));

const setTheme = (value: "dark" | "light") => {
  document.documentElement.dataset.theme = value;
};

const appendLog = (text: string) => {
  const stamp = new Date().toLocaleTimeString();
  logs.value = [`[${stamp}] ${text}`, ...logs.value].slice(0, 8);
};

const applyDaemonStatus = (status: DaemonStatus | null) => {
  if (!status?.running) {
    serviceStatus.value = {
      relay: "offline",
      daemon: "offline",
      tunnel: serviceStatus.value.tunnel,
    };
    return;
  }
  serviceStatus.value = {
    relay: "online",
    daemon: "online",
    tunnel: serviceStatus.value.tunnel,
  };
};

const refreshStatus = async () => {
  try {
    const status = await invoke<DaemonStatus>("daemon_status");
    const appStatus = await invoke<{ paired: boolean; session?: { session_id: string } }>("app_status");
    applyDaemonStatus(status);
    if (!status.running) {
      appendLog("Daemon 未运行。");
    } else {
      appendLog(`Daemon 运行中（端口 ${status.port ?? "?"}）。`);
    }
    if (appStatus?.paired) {
      appendLog(`已配对（session ${appStatus.session?.session_id ?? "?"}）。`);
    } else {
      appendLog("尚未配对。");
    }
    const newLogs = await invoke<string[]>("app_logs");
    if (newLogs.length > 0) {
      logs.value = newLogs.slice().reverse().slice(0, 8);
    }
  } catch (err: any) {
    appendLog(`状态刷新失败：${err?.message || String(err)}`);
  }
};

const startLan = async () => {
  serviceStatus.value.tunnel = "offline";
  try {
    const status = await invoke<DaemonStatus>("daemon_start", { serverUrl: serverUrl.value });
    applyDaemonStatus(status);
    await invoke("relay_start", { serverUrl: serverUrl.value });
    appendLog("已请求启动 daemon（LAN 模式）。");
  } catch (err: any) {
    appendLog(`启动失败：${err?.message || String(err)}`);
  }
};

const startTunnel = async () => {
  serviceStatus.value.tunnel = "online";
  try {
    const status = await invoke<DaemonStatus>("daemon_start", { serverUrl: serverUrl.value });
    applyDaemonStatus(status);
    await invoke("relay_start", { serverUrl: serverUrl.value });
    appendLog("已请求启动 daemon（Tunnel 模式）。");
  } catch (err: any) {
    appendLog(`启动失败：${err?.message || String(err)}`);
  }
};

const stopAll = async () => {
  try {
    const status = await invoke<DaemonStatus>("daemon_stop");
    applyDaemonStatus(status);
    serviceStatus.value.tunnel = "offline";
    await invoke("relay_stop");
    appendLog("已请求停止 daemon。");
  } catch (err: any) {
    appendLog(`停止失败：${err?.message || String(err)}`);
  }
};

const submitPairing = () => {
  const code = pairingCode.value.trim();
  if (pairingMode.value === "join") {
    if (!code) {
      appendLog("配对码为空，请先输入或扫码。");
      return;
    }
    appendLog(`提交配对码 ${code}，等待远端响应。`);
    invoke("pairing_join", { serverUrl: serverUrl.value, code })
      .then(() => refreshStatus())
      .catch((err: any) => appendLog(`配对失败：${err?.message || String(err)}`));
    return;
  }
  appendLog("开始创建配对码...");
  invoke<{ pairing_code: string }>("pairing_start", { serverUrl: serverUrl.value })
    .then((resp) => {
      if (resp?.pairing_code) {
        pairingCode.value = resp.pairing_code;
        appendLog(`配对码已生成：${resp.pairing_code}`);
      }
      refreshStatus();
    })
    .catch((err: any) => appendLog(`配对失败：${err?.message || String(err)}`));
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
});

watch(theme, (value) => setTheme(value));
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span>Yuanio Desktop</span>
        <span class="tag">Windows</span>
        <span class="brand-subtitle">CLI 外壳</span>
      </div>
      <div class="row">
        <button class="btn btn-ghost btn-sm" type="button" @click="toggleTheme">
          切换为{{ themeLabel }}
        </button>
      </div>
    </header>

    <div class="content">
      <section class="section">
        <div class="row">
          <h2 class="section-title">服务概览</h2>
          <span class="badge blue">本地控制</span>
        </div>
        <p class="section-desc">保留 CLI 逻辑，桌面端负责状态展示与快捷控制。</p>
        <div class="row">
          <input
            v-model="serverUrl"
            class="input"
            type="text"
            placeholder="控制端地址（如 http://localhost:3000）"
          />
          <button class="btn btn-ghost btn-sm" type="button" @click="refreshStatus">刷新状态</button>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">Relay / Daemon</div>
              <span class="badge green" v-if="serviceStatus.relay === 'online'">可用</span>
              <span class="badge red" v-else>未运行</span>
            </div>
            <div class="card-body">
              <div class="row">
                <span class="status-dot" :class="serviceStatus.relay"></span>
                Relay：{{ statusLabels[serviceStatus.relay] }}
              </div>
              <div class="row">
                <span class="status-dot" :class="serviceStatus.daemon"></span>
                Daemon：{{ statusLabels[serviceStatus.daemon] }}
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">Tunnel</div>
              <span class="badge" :class="{ green: serviceStatus.tunnel === 'online', blue: serviceStatus.tunnel === 'warn', red: serviceStatus.tunnel === 'offline' }">
                {{ statusLabels[serviceStatus.tunnel] }}
              </span>
            </div>
            <div class="card-body">
              云隧道用于远程协作，当前状态为{{ statusLabels[serviceStatus.tunnel] }}。
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-title">快速操作</h2>
        <div class="row">
          <button class="btn btn-primary" type="button" @click="startLan">启动 LAN</button>
          <button class="btn btn-secondary" type="button" @click="startTunnel">启动 Tunnel</button>
          <button class="btn btn-ghost" type="button" @click="stopAll">全部停止</button>
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
        </div>
        <div class="row">
          <input
            v-model="pairingCode"
            class="input"
            type="text"
            placeholder="输入配对码（如 123-456）"
          />
          <button class="btn btn-primary" type="button" @click="submitPairing">
            {{ pairingMode === 'start' ? '生成配对码' : '提交配对' }}
          </button>
          <button class="btn btn-ghost" type="button" @click="scanPairing">扫码</button>
        </div>
        <p class="section-desc">
          {{ pairingMode === 'start'
            ? '创建配对后可用移动端加入。'
            : '输入移动端显示的配对码完成绑定。' }}
        </p>
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
