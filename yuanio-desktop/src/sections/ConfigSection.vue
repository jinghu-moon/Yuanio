<script setup lang="ts">
import AppSelect from "../components/AppSelect.vue";
import type { TranslateFn } from "../types/desktop";

const serverUrl = defineModel<string>("serverUrl");
const pairingNamespace = defineModel<string>("pairingNamespace");
const relayPort = defineModel<number>("relayPort");
const configAutoStart = defineModel<boolean>("configAutoStart");
const configProfile = defineModel<"lan" | "tunnel">("configProfile");
const tunnelMode = defineModel<"quick" | "named">("tunnelMode");
const tunnelName = defineModel<string>("tunnelName");
const tunnelHostname = defineModel<string>("tunnelHostname");
const configLanguage = defineModel<"zh-CN" | "zh-TW" | "en">("configLanguage");

defineProps<{
  configDirty: boolean;
  configLoading: boolean;
  configSaving: boolean;
  configMessage: string;
  loadConfig: () => void;
  saveConfig: () => void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="config" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("配置中心") }}</h2>
      <span class="badge" :class="configDirty ? 'blue' : 'green'">
        {{ configDirty ? t("未保存") : t("已同步") }}
      </span>
    </div>
    <p class="section-desc">{{ t("配置中心说明") }}</p>
    <div class="row">
      <button class="btn btn-ghost btn-sm" type="button" @click="loadConfig" :disabled="configLoading">
        {{ configLoading ? t("加载中...") : t("重新加载") }}
      </button>
      <button class="btn btn-primary btn-sm" type="button" @click="saveConfig" :disabled="configSaving">
        {{ configSaving ? t("保存中...") : t("保存配置") }}
      </button>
      <span v-if="configMessage" class="muted">{{ configMessage }}</span>
    </div>
    <div class="grid config-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">连接配置</div>
        </div>
        <div class="card-body form-grid">
          <label class="field">
            <span class="field-label">{{ t("Server URL") }}</span>
            <input v-model="serverUrl" class="input field-control" type="text" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("命名空间") }}</span>
            <input v-model="pairingNamespace" class="input field-control" type="text" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("Relay 端口") }}</span>
            <input v-model.number="relayPort" class="input field-control" type="number" min="1" max="65535" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("自动启动") }}</span>
            <input v-model="configAutoStart" class="field-toggle" type="checkbox" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("连接模式") }}</span>
            <AppSelect
              v-model="configProfile"
              class="field-control"
              :options="[
                { value: 'lan', label: 'LAN' },
                { value: 'tunnel', label: 'Tunnel' },
              ]"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ t("Tunnel 模式") }}</span>
            <AppSelect
              v-model="tunnelMode"
              class="field-control"
              :options="[
                { value: 'named', label: t('命名') },
                { value: 'quick', label: 'Quick' },
              ]"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ t("Tunnel 名称") }}</span>
            <input v-model="tunnelName" class="input field-control" type="text" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("Tunnel Host") }}</span>
            <input v-model="tunnelHostname" class="input field-control" type="text" />
          </label>
          <label class="field">
            <span class="field-label">{{ t("语言") }}</span>
            <AppSelect
              v-model="configLanguage"
              class="field-control"
              :options="[
                { value: 'zh-CN', label: t('简体中文') },
                { value: 'zh-TW', label: t('繁体中文') },
                { value: 'en', label: 'English' },
              ]"
            />
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
