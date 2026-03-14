<script setup lang="ts">
import type { CloudflaredServiceState, TranslateFn } from "../types/desktop";

defineProps<{
  cloudflaredState: CloudflaredServiceState | null;
  cloudflaredLabel: string;
  cloudflaredConfirm: boolean;
  refreshCloudflared: () => void;
  confirmCloudflaredInstall: () => void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="cloudflared" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("Cloudflared 服务") }}</h2>
      <span class="badge" :class="cloudflaredState?.running ? 'green' : cloudflaredState?.supported ? 'blue' : 'red'">
        {{ cloudflaredLabel }}
      </span>
    </div>
    <p class="section-desc">{{ t("命名 Tunnel 依赖 Cloudflared 服务（Windows 可管理）。") }}</p>
    <div class="row">
      <button class="btn btn-ghost btn-sm" type="button" @click="refreshCloudflared">{{ t("刷新") }}</button>
      <button
        class="btn btn-secondary btn-sm"
        type="button"
        :disabled="!cloudflaredState?.supported"
        @click="confirmCloudflaredInstall"
      >
        {{ cloudflaredConfirm ? t("确认安装 Cloudflared 服务") : t("安装 / 修复") }}
      </button>
      <span v-if="cloudflaredConfirm" class="muted">{{ t("再次点击确认安装 Cloudflared 服务。") }}</span>
    </div>
    <div class="row" v-if="cloudflaredState">
      <span class="muted">{{ t("状态：{status}", { status: cloudflaredLabel }) }}</span>
      <span class="muted" v-if="cloudflaredState.binPath">{{ t("路径：{path}", { path: cloudflaredState.binPath }) }}</span>
    </div>
    <div class="row" v-if="cloudflaredState?.lastBackupDir">
      <span class="muted">{{ t("备份：{path}", { path: cloudflaredState.lastBackupDir }) }}</span>
    </div>
  </section>
</template>
