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
  goToSection: (id: string) => void;
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
        <div class="card-body status-list">
          <div class="status-row">
            <div class="status-main">
              <span class="status-dot" :class="statusTone(serviceState.relay.status)"></span>
              <span class="status-name">Relay</span>
              <span class="status-value">{{ statusLabel(serviceState.relay.status) }}</span>
            </div>
            <span class="status-meta">
              {{ serviceState.relay.port != null ? `: ${serviceState.relay.port}` : "-" }}
            </span>
          </div>
          <div class="status-row">
            <div class="status-main">
              <span class="status-dot" :class="statusTone(serviceState.daemon.status)"></span>
              <span class="status-name">Daemon</span>
              <span class="status-value">{{ statusLabel(serviceState.daemon.status) }}</span>
            </div>
            <span class="status-meta">
              {{ serviceState.daemon.port != null ? `: ${serviceState.daemon.port}` : "-" }}
            </span>
          </div>
          <div class="status-row">
            <div class="status-main">
              <span class="status-dot" :class="statusTone(serviceState.tunnel.status)"></span>
              <span class="status-name">Tunnel</span>
              <span class="status-value">{{ statusLabel(serviceState.tunnel.status) }}</span>
            </div>
            <span class="status-meta truncate">
              {{ serviceState.tunnel.publicUrl ?? "-" }}
            </span>
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
        <div class="card-body kv-list">
          <div class="kv-row">
            <span class="kv-label">{{ t("Server URL") }}</span>
            <span class="kv-value truncate">{{ serverUrl }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">{{ t("命名空间") }}</span>
            <span class="kv-value">{{ pairingNamespace || "-" }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">{{ t("Relay 端口") }}</span>
            <span class="kv-value">{{ relayPort }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">{{ t("Tunnel 模式") }}</span>
            <span class="kv-value">{{ tunnelMode === "quick" ? t("Quick") : t("命名") }}</span>
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
                  @click="goToSection(link.id)"
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
        <div class="card-body kv-list">
          <div class="kv-row">
            <span class="kv-label">{{ t("运行时间") }}</span>
            <span class="kv-value">{{ uptimeLabel }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">{{ t("平台") }}</span>
            <span class="kv-value">{{ systemInfo ? `${systemInfo.os} ${systemInfo.arch}` : "-" }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">PID</span>
            <span class="kv-value">{{ systemInfo?.pid ?? "-" }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-label">{{ t("版本") }}</span>
            <span class="kv-value">{{ appVersion ?? "-" }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("最近日志") }}</div>
          <span class="muted">{{ t("共 {count} 条", { count: dashboardLogs.length }) }}</span>
        </div>
        <div class="card-body log-list log-list-compact">
          <div v-if="dashboardLogs.length === 0" class="muted">{{ t("暂无日志。") }}</div>
          <div
            v-for="entry in dashboardLogs"
            :key="`${entry.ts}-${entry.text}`"
            class="log-item log-entry log-entry-compact"
          >
            <span class="log-time">{{ new Date(entry.ts).toLocaleTimeString() }}</span>
            <span class="log-source">[{{ entry.source }}]</span>
            <span class="log-text">{{ entry.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
