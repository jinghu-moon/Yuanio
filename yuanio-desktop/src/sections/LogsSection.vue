<script setup lang="ts">
import type { AppLogEntry, TranslateFn } from "../types/desktop";

const logFilter = defineModel<string>("logFilter");
const logSearch = defineModel<string>("logSearch");

defineProps<{
  logSources: string[];
  filteredLogs: AppLogEntry[];
  refreshAppLogs: () => void;
  clearAppLogs: () => void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="logs" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("日志面板") }}</h2>
      <span class="muted">{{ t("共 {count} 条", { count: filteredLogs.length }) }}</span>
    </div>
    <div class="row">
      <span class="muted">{{ t("日志来源") }}</span>
      <button
        v-for="source in logSources"
        :key="source"
        class="btn btn-ghost btn-sm"
        type="button"
        :class="{ active: logFilter === source }"
        @click="logFilter = source"
      >
        {{ source === "all" ? t("全部") : source }}
      </button>
      <input
        v-model="logSearch"
        class="input input-sm"
        type="text"
        :placeholder="t('搜索日志')"
      />
      <button class="btn btn-ghost btn-sm" type="button" @click="refreshAppLogs">{{ t("刷新") }}</button>
      <button class="btn btn-ghost btn-sm" type="button" @click="clearAppLogs">{{ t("清空日志") }}</button>
    </div>
    <div class="log-list log-panel">
      <div v-if="filteredLogs.length === 0" class="log-item muted">{{ t("暂无日志。") }}</div>
      <div
        v-for="entry in filteredLogs.slice(0, 200)"
        :key="`${entry.ts}-${entry.source}-${entry.text}`"
        class="log-item log-entry"
      >
        <span class="log-time">{{ new Date(entry.ts).toLocaleTimeString() }}</span>
        <span class="log-source">[{{ entry.source }}]</span>
        <span class="log-text">{{ entry.text }}</span>
      </div>
    </div>
  </section>
</template>
