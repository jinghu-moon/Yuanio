<script setup lang="ts">
import type { DoctorReport, TranslateFn } from "../types/desktop";

const doctorControlUrl = defineModel<string>("doctorControlUrl");
const doctorPublicUrl = defineModel<string>("doctorPublicUrl");

defineProps<{
  doctorRunning: boolean;
  doctorReport: DoctorReport | null;
  doctorError: string;
  doctorStatusLabel: string;
  runDoctor: () => void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="doctor" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("诊断") }}</h2>
      <span class="badge" :class="doctorReport && doctorReport.failed === 0 ? 'green' : doctorReport ? 'red' : 'blue'">
        {{ doctorStatusLabel }}
      </span>
    </div>
    <p class="section-desc">{{ t("诊断说明") }}</p>
    <div class="row">
      <input v-model="doctorControlUrl" class="input" type="text" :placeholder="t('控制端地址（如 http://localhost:3000）')" />
      <input v-model="doctorPublicUrl" class="input" type="text" :placeholder="t('公网地址（可选）')" />
      <button class="btn btn-primary btn-sm" type="button" @click="runDoctor" :disabled="doctorRunning">
        {{ doctorRunning ? t("诊断中...") : t("开始诊断") }}
      </button>
    </div>
    <div class="row" v-if="doctorError">
      <span class="muted">{{ t("错误：{message}", { message: doctorError }) }}</span>
    </div>
    <div class="card" v-if="doctorReport">
      <div class="card-body doctor-list">
        <div v-for="item in doctorReport.checks" :key="item.label" class="doctor-item">
          <span class="status-dot" :class="item.ok ? 'online' : 'offline'"></span>
          <span class="doctor-label">{{ item.label }}</span>
          <span class="muted">{{ item.detail }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
