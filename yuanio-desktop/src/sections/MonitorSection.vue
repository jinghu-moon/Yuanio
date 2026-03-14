<script setup lang="ts">
import type { MonitorLine, MonitorRealtimeStatus, MonitorSession, TranslateFn } from "../types/desktop";

defineProps<{
  monitorReady: boolean;
  monitorStatus: string;
  monitorRealtime: MonitorRealtimeStatus;
  monitorRealtimeLabel: string;
  monitorError: string | null;
  monitorSessions: MonitorSession[];
  monitorSelectedSessionId: string | null;
  monitorLines: MonitorLine[];
  monitorReadonlySelection: boolean;
  shortSessionId: (value: string) => string;
  refreshMonitorNow: () => void;
  clearMonitorLines: () => void;
  selectMonitorSession: (sessionId: string) => void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="monitor" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("远程监控") }}</h2>
      <span class="badge" :class="monitorReady ? 'green' : monitorError ? 'red' : 'blue'">
        {{ monitorStatus }}
      </span>
      <span class="badge" :class="monitorRealtime.status === 'connected' ? 'green' : monitorRealtime.status === 'error' ? 'red' : 'blue'">
        {{ monitorRealtimeLabel }}
      </span>
    </div>
    <p class="section-desc">{{ t("展示当前会话的消息流与在线状态。") }}</p>
    <div class="row">
      <button class="btn btn-ghost btn-sm" type="button" @click="refreshMonitorNow">
        {{ t("刷新") }}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        :disabled="!monitorSelectedSessionId"
        @click="clearMonitorLines"
      >
        {{ t("清空当前会话") }}
      </button>
      <span v-if="monitorError" class="muted">{{ t("错误：{message}", { message: monitorError }) }}</span>
    </div>
    <div class="grid monitor-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("会话列表") }}</div>
          <span class="muted">{{ monitorSessions.length }} {{ t("个") }}</span>
        </div>
        <div class="card-body session-list">
          <div v-if="monitorSessions.length === 0" class="muted">{{ t("暂无会话。") }}</div>
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
            {{ t("输出") }} {{ monitorSelectedSessionId ? `(${shortSessionId(monitorSelectedSessionId)})` : "" }}
          </div>
          <span class="muted">{{ t("共 {count} 条", { count: monitorLines.length }) }}</span>
        </div>
        <div class="card-body monitor-lines">
          <div v-if="monitorReadonlySelection" class="monitor-hint">
            {{ t("当前仅支持查看本机会话的实时日志。") }}
          </div>
          <div v-if="monitorLines.length === 0" class="muted">{{ t("暂无消息。") }}</div>
          <div v-for="line in monitorLines" :key="line.id" class="monitor-line">
            <span class="monitor-time">{{ new Date(line.ts).toLocaleTimeString() }}</span>
            <span class="monitor-type">[{{ line.type }}]</span>
            <span class="monitor-text">{{ line.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
