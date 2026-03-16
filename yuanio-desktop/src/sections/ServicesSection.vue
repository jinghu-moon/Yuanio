<script setup lang="ts">
import type { ServiceState, ServiceStatus, TranslateFn } from "../types/desktop";

const serverUrl = defineModel<string>("serverUrl");
const relayPort = defineModel<number>("relayPort");
const tunnelMode = defineModel<"quick" | "named">("tunnelMode");
const tunnelName = defineModel<string>("tunnelName");
const tunnelHostname = defineModel<string>("tunnelHostname");

defineProps<{
  profileLabel: string;
  serviceState: ServiceState;
  statusLabel: (status: ServiceStatus) => string;
  badgeTone: (status: ServiceStatus) => string;
  refreshStatus: () => void;
  startRelay: () => Promise<void> | void;
  stopRelay: () => Promise<void> | void;
  restartRelay: () => Promise<void> | void;
  startDaemon: () => Promise<void> | void;
  stopDaemon: () => Promise<void> | void;
  restartDaemon: () => Promise<void> | void;
  startTunnel: () => Promise<void> | void;
  stopTunnel: () => Promise<void> | void;
  restartTunnel: () => Promise<void> | void;
  startProfile: (profile: "lan" | "tunnel") => Promise<boolean>;
  stopAll: () => Promise<void> | void;
  reloadBridge: () => Promise<void> | void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="services" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("服务控制") }}</h2>
      <span class="badge blue">{{ t("当前：{profile}", { profile: profileLabel }) }}</span>
    </div>
    <p class="section-desc">{{ t("内嵌 Rust Core，桌面端负责状态展示与快捷控制。") }}</p>
    <div class="row">
      <input
        v-model="serverUrl"
        class="input"
        type="text"
        :placeholder="t('控制端地址（如 http://localhost:3000）')"
      />
      <input
        v-model.number="relayPort"
        class="input"
        type="number"
        min="1"
        max="65535"
        :placeholder="t('Relay 端口')"
      />
      <button class="btn btn-ghost btn-sm" type="button" @click="refreshStatus">{{ t("刷新状态") }}</button>
    </div>
    <div class="row">
      <span class="section-desc">{{ t("Tunnel 模式") }}</span>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        :class="{ active: tunnelMode === 'quick' }"
        @click="tunnelMode = 'quick'"
      >
        {{ t("Quick") }}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        :class="{ active: tunnelMode === 'named' }"
        @click="tunnelMode = 'named'"
      >
        {{ t("Named") }}
      </button>
    </div>
    <div class="row" v-if="tunnelMode === 'named'">
      <input
        v-model="tunnelName"
        class="input"
        type="text"
        :placeholder="t('Tunnel 名称（如 yuanio-main）')"
      />
      <input
        v-model="tunnelHostname"
        class="input"
        type="text"
        :placeholder="t('Tunnel Hostname（如 xxx.trycloudflare.com）')"
      />
    </div>
    <div class="grid service-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Relay</div>
          <span class="badge" :class="badgeTone(serviceState.relay.status)">
            {{ statusLabel(serviceState.relay.status) }}
          </span>
        </div>
        <div class="card-body">
          <div class="row">
            <span class="muted">PID</span>
            <span>{{ serviceState.relay.pid ?? "-" }}</span>
            <span class="muted">{{ t("端口") }}</span>
            <span>{{ serviceState.relay.port ?? "-" }}</span>
          </div>
          <div class="row">
            <span class="muted">URL</span>
            <span class="truncate">{{ serviceState.relay.url ?? "-" }}</span>
          </div>
          <div class="row">
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="serviceState.relay.status === 'running' || serviceState.relay.status === 'starting'"
              @click="startRelay"
            >
              {{ t("启动") }}
            </button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="serviceState.relay.status === 'stopped'"
              @click="stopRelay"
            >
              {{ t("停止") }}
            </button>
            <button class="btn btn-secondary btn-sm" type="button" @click="restartRelay">
              {{ t("重启") }}
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Daemon</div>
          <span class="badge" :class="badgeTone(serviceState.daemon.status)">
            {{ statusLabel(serviceState.daemon.status) }}
          </span>
        </div>
        <div class="card-body">
          <div class="row">
            <span class="muted">PID</span>
            <span>{{ serviceState.daemon.pid ?? "-" }}</span>
            <span class="muted">{{ t("端口") }}</span>
            <span>{{ serviceState.daemon.port ?? "-" }}</span>
          </div>
          <div class="row">
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="serviceState.daemon.status === 'running' || serviceState.daemon.status === 'starting'"
              @click="startDaemon"
            >
              {{ t("启动") }}
            </button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="serviceState.daemon.status === 'stopped'"
              @click="stopDaemon"
            >
              {{ t("停止") }}
            </button>
            <button class="btn btn-secondary btn-sm" type="button" @click="restartDaemon">
              {{ t("重启") }}
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Tunnel</div>
          <span class="badge" :class="badgeTone(serviceState.tunnel.status)">
            {{ statusLabel(serviceState.tunnel.status) }}
          </span>
        </div>
        <div class="card-body">
          <div class="row">
            <span class="muted">PID</span>
            <span>{{ serviceState.tunnel.pid ?? "-" }}</span>
          </div>
          <div class="row">
            <span class="muted">URL</span>
            <span class="truncate">{{ serviceState.tunnel.publicUrl ?? "-" }}</span>
          </div>
          <div class="row">
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="serviceState.tunnel.status === 'running' || serviceState.tunnel.status === 'starting'"
              @click="startTunnel"
            >
              {{ t("启动") }}
            </button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              :disabled="serviceState.tunnel.status === 'stopped'"
              @click="stopTunnel"
            >
              {{ t("停止") }}
            </button>
            <button class="btn btn-secondary btn-sm" type="button" @click="restartTunnel">
              {{ t("重启") }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="row">
      <button class="btn btn-primary" type="button" @click="startProfile('lan')">{{ t("启动 LAN") }}</button>
      <button class="btn btn-secondary" type="button" @click="startProfile('tunnel')">{{ t("启动 Tunnel") }}</button>
      <button class="btn btn-ghost" type="button" @click="reloadBridge">{{ t("重载桥接") }}</button>
      <button class="btn btn-ghost" type="button" @click="stopAll">{{ t("全部停止") }}</button>
    </div>
  </section>
</template>
