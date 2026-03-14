<script setup lang="ts">
import type { PairStatus, TranslateFn } from "../types/desktop";

const pairingMode = defineModel<"start" | "join">("pairingMode");
const pairingNamespace = defineModel<string>("pairingNamespace");
const pairingCode = defineModel<string>("pairingCode");

defineProps<{
  pairStatus: PairStatus;
  pairStatusLabel: string;
  pairError: string;
  pairQrData: string | null;
  pairOpMessage: string;
  pairChecking: boolean;
  pairControlReady: boolean | null;
  pairMobileReady: boolean | null;
  pairLanIp: string | null;
  pairServerUrl: string;
  displayPairUrl: string;
  isLanPair: boolean;
  readinessLabel: (value: boolean | null) => string;
  submitPairing: () => void;
  scanPairing: () => void;
  cancelPairing: () => void;
  refreshReadiness: () => void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="pairing" class="section">
    <h2 class="section-title">{{ t("配对入口") }}</h2>
    <div class="row">
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        :class="{ active: pairingMode === 'start' }"
        @click="pairingMode = 'start'"
      >
        {{ t("创建配对") }}
      </button>
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        :class="{ active: pairingMode === 'join' }"
        @click="pairingMode = 'join'"
      >
        {{ t("加入配对") }}
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
        :placeholder="t('命名空间（默认 default）')"
      />
      <input
        v-model="pairingCode"
        class="input"
        type="text"
        :placeholder="t('输入配对码（如 123-456）')"
      />
      <button
        class="btn btn-primary"
        type="button"
        :disabled="pairStatus === 'waiting' || pairStatus === 'generating'"
        @click="submitPairing"
      >
        {{ pairingMode === 'start' ? t("生成配对码") : t("提交配对") }}
      </button>
      <button class="btn btn-ghost" type="button" @click="scanPairing">{{ t("扫码") }}</button>
      <button
        v-if="pairStatus === 'waiting'"
        class="btn btn-ghost"
        type="button"
        @click="cancelPairing"
      >
        {{ t("取消") }}
      </button>
    </div>
    <p class="section-desc">
      {{ pairingMode === "start"
        ? t("创建配对后可用移动端加入。")
        : t("输入移动端显示的配对码完成绑定。") }}
    </p>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("连接检测") }}</div>
          <span class="badge" :class="pairControlReady === false ? 'red' : pairControlReady ? 'green' : 'blue'">
            {{ readinessLabel(pairControlReady) }}
          </span>
        </div>
        <div class="card-body">
          <div class="row">
            <span class="muted">{{ t("控制端") }}</span>
            <span>{{ pairServerUrl }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("移动端") }}</span>
            <span>{{ displayPairUrl }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("LAN IP") }}</span>
            <span>{{ pairLanIp || "-" }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("控制端健康") }}</span>
            <span>{{ readinessLabel(pairControlReady) }}</span>
          </div>
          <div class="row" v-if="isLanPair">
            <span class="muted">{{ t("移动端健康") }}</span>
            <span>{{ readinessLabel(pairMobileReady) }}</span>
          </div>
          <div class="row">
            <button class="btn btn-ghost btn-sm" type="button" @click="refreshReadiness" :disabled="pairChecking">
              {{ pairChecking ? t("检测中...") : t("刷新检测") }}
            </button>
          </div>
          <div class="row" v-if="pairOpMessage">
            <span class="muted">{{ pairOpMessage }}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("扫码配对") }}</div>
          <span class="badge blue">{{ pairStatusLabel }}</span>
        </div>
        <div class="card-body">
          <div class="qr-box">
            <img v-if="pairQrData" :src="pairQrData" alt="pairing-qr" />
            <span v-else class="muted">{{ t("暂无二维码") }}</span>
          </div>
          <div class="row">
            <span class="muted">{{ t("状态：{status}", { status: pairStatusLabel }) }}</span>
          </div>
          <div class="row" v-if="pairError">
            <span class="muted">{{ t("错误：{message}", { message: pairError }) }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
