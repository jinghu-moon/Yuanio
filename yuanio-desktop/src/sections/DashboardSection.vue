<script setup lang="ts">
import type {
  AppLogEntry,
  QuickLink,
  ServiceState,
  ServiceStatus,
  SystemInfo,
  TranslateFn,
} from "../types/desktop";

defineProps<{
  profileLabel: string;
  serviceState: ServiceState;
  configDirty: boolean;
  serverUrl: string;
  pairingNamespace: string;
  relayPort: number;
  tunnelMode: "quick" | "named";
  statusLabel: (status: ServiceStatus) => string;
  badgeTone: (status: ServiceStatus) => string;
  statusTone: (status: ServiceStatus) => string;
  daemonSessions: string[];
  daemonSessionPreview: string[];
  quickLinks: QuickLink[];
  scrollToSection: (id: string) => void;
  shortSessionId: (value: string) => string;
  systemInfo: SystemInfo | null;
  uptimeLabel: string;
  appVersion: string | null;
  dashboardLogs: AppLogEntry[];
  t: TranslateFn;
}>();
</script>

<template>
  <section id="dashboard" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("仪表盘") }}</h2>
      <span class="badge blue">{{ profileLabel }}</span>
    </div>
    <div class="grid dashboard-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("服务状态") }}</div>
          <span class="badge" :class="badgeTone(serviceState.relay.status)">
            {{ statusLabel(serviceState.relay.status) }}
          </span>
        </div>
        <div class="card-body">
          <div class="row">
            <span class="status-dot" :class="statusTone(serviceState.relay.status)"></span>
            <span>Relay</span>
            <span class="muted">{{ statusLabel(serviceState.relay.status) }}</span>
            <span class="muted">: {{ serviceState.relay.port ?? "-" }}</span>
          </div>
          <div class="row">
            <span class="status-dot" :class="statusTone(serviceState.daemon.status)"></span>
            <span>Daemon</span>
            <span class="muted">{{ statusLabel(serviceState.daemon.status) }}</span>
            <span class="muted">: {{ serviceState.daemon.port ?? "-" }}</span>
          </div>
          <div class="row">
            <span class="status-dot" :class="statusTone(serviceState.tunnel.status)"></span>
            <span>Tunnel</span>
            <span class="muted">{{ statusLabel(serviceState.tunnel.status) }}</span>
            <span class="muted" v-if="serviceState.tunnel.publicUrl">: {{ serviceState.tunnel.publicUrl }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("当前配置") }}</div>
          <span class="badge" :class="configDirty ? 'blue' : 'green'">
            {{ configDirty ? t("未保存") : t("已同步") }}
          </span>
        </div>
        <div class="card-body">
          <div class="row">
            <span class="muted">{{ t("Server URL") }}</span>
            <span class="truncate">{{ serverUrl }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("命名空间") }}</span>
            <span>{{ pairingNamespace || "-" }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("Relay 端口") }}</span>
            <span>{{ relayPort }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("Tunnel 模式") }}</span>
            <span>{{ tunnelMode === "quick" ? t("Quick") : t("命名") }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("会话") }}</div>
          <span class="muted">{{ daemonSessions.length }} {{ t("个") }}</span>
        </div>
        <div class="card-body">
          <div v-if="daemonSessions.length === 0" class="muted">{{ t("暂无会话。") }}</div>
          <div v-else class="tag-list">
            <span v-for="session in daemonSessionPreview" :key="session" class="tag">
              {{ shortSessionId(session) }}
            </span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("快捷导航") }}</div>
        </div>
        <div class="card-body">
          <div class="row">
            <button
              v-for="link in quickLinks"
              :key="link.id"
              class="btn btn-ghost btn-sm"
              type="button"
              @click="scrollToSection(link.id)"
            >
              {{ t(link.label) }}
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("系统信息") }}</div>
          <span class="muted">{{ uptimeLabel }}</span>
        </div>
        <div class="card-body">
          <div class="row">
            <span class="muted">{{ t("运行时间") }}</span>
            <span>{{ uptimeLabel }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("平台") }}</span>
            <span>{{ systemInfo ? `${systemInfo.os} ${systemInfo.arch}` : "-" }}</span>
          </div>
          <div class="row">
            <span class="muted">PID</span>
            <span>{{ systemInfo?.pid ?? "-" }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("版本") }}</span>
            <span>{{ appVersion ?? "-" }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("最近日志") }}</div>
          <span class="muted">{{ t("共 {count} 条", { count: dashboardLogs.length }) }}</span>
        </div>
        <div class="card-body log-list">
          <div v-if="dashboardLogs.length === 0" class="muted">{{ t("暂无日志。") }}</div>
          <div v-for="entry in dashboardLogs" :key="`${entry.ts}-${entry.text}`" class="log-item log-entry">
            <span class="log-time">{{ new Date(entry.ts).toLocaleTimeString() }}</span>
            <span class="log-source">[{{ entry.source }}]</span>
            <span class="log-text">{{ entry.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
