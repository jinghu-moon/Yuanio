<script setup lang="ts">
import AppSelect from "../components/AppSelect.vue";
import type { SkillCandidate, SkillItem, SkillLogItem, TranslateFn } from "../types/desktop";

const skillSource = defineModel<string>("skillSource");
const skillScope = defineModel<"project" | "user">("skillScope");
const skillInstallId = defineModel<string>("skillInstallId");

defineProps<{
  skillCandidates: SkillCandidate[];
  skillSelected: string[];
  skillInstalled: SkillItem[];
  skillLogs: SkillLogItem[];
  skillStatus: string;
  skillError: string;
  skillBusy: boolean;
  prepareSkills: () => void;
  refreshSkills: () => void;
  selectValidCandidates: () => void;
  commitSkills: (policy: "skip" | "overwrite") => void;
  cancelSkills: () => void;
  toggleSkillCandidate: (candidate: SkillCandidate) => void;
  t: TranslateFn;
}>();
</script>

<template>
  <section id="skills" class="section">
    <div class="row">
      <h2 class="section-title">{{ t("技能管理") }}</h2>
      <span class="badge" :class="skillError ? 'red' : 'blue'">
        {{ skillError ? t("异常") : t("就绪") }}
      </span>
    </div>
    <p class="section-desc">{{ t("技能管理说明") }}</p>
    <div class="row">
      <input v-model="skillSource" class="input" type="text" :placeholder="t('安装源（如 ./refer/teleclaude）')" />
      <AppSelect
        v-model="skillScope"
        :options="[
          { value: 'project', label: 'project' },
          { value: 'user', label: 'user' },
        ]"
      />
      <button class="btn btn-secondary btn-sm" type="button" @click="prepareSkills" :disabled="skillBusy">
        prepare
      </button>
      <button class="btn btn-ghost btn-sm" type="button" @click="refreshSkills" :disabled="skillBusy">
        {{ t("刷新") }}
      </button>
    </div>
    <div class="row">
      <input v-model="skillInstallId" class="input" type="text" :placeholder="t('installId（可选）')" />
      <button class="btn btn-ghost btn-sm" type="button" @click="selectValidCandidates" :disabled="skillBusy">
        {{ t("全选有效") }}
      </button>
      <button class="btn btn-primary btn-sm" type="button" @click="commitSkills('skip')" :disabled="skillBusy">
        {{ t("提交(跳过)") }}
      </button>
      <button class="btn btn-secondary btn-sm" type="button" @click="commitSkills('overwrite')" :disabled="skillBusy">
        {{ t("提交(覆盖)") }}
      </button>
      <button class="btn btn-ghost btn-sm" type="button" @click="cancelSkills" :disabled="skillBusy">
        {{ t("取消") }}
      </button>
    </div>
    <div class="row">
      <span class="muted">{{ skillBusy ? t("处理中...") : skillStatus }}</span>
    </div>
    <div class="grid skill-grid">
      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("候选项") }}</div>
          <span class="muted">{{ skillCandidates.length }} {{ t("个") }}</span>
        </div>
        <div class="card-body skill-list">
          <div v-if="skillCandidates.length === 0" class="muted">{{ t("暂无候选项。") }}</div>
          <button
            v-for="item in skillCandidates.slice(0, 12)"
            :key="item.id"
            class="skill-item"
            :class="{ active: skillSelected.includes(item.id), invalid: !item.valid }"
            type="button"
            @click="toggleSkillCandidate(item)"
          >
            <span class="skill-check">{{ skillSelected.includes(item.id) ? "✓" : "" }}</span>
            <span class="skill-name">{{ item.name }}</span>
            <span class="skill-desc">{{ item.description }}</span>
          </button>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">{{ t("已安装") }}</div>
          <span class="muted">{{ skillInstalled.length }} {{ t("个") }}</span>
        </div>
        <div class="card-body skill-installed">
          <div v-if="skillInstalled.length === 0" class="muted">{{ t("暂无已安装 skills。") }}</div>
          <div v-for="item in skillInstalled.slice(0, 8)" :key="item.id" class="skill-installed-item">
            <span class="skill-name">{{ item.name }}</span>
            <span class="muted">{{ item.scope }}/{{ item.source }}</span>
          </div>
        </div>
        <div class="card-header">
          <div class="card-title">{{ t("日志") }}</div>
          <span class="muted">{{ skillLogs.length }} {{ t("条") }}</span>
        </div>
        <div class="card-body skill-logs">
          <div v-if="skillLogs.length === 0" class="muted">{{ t("暂无日志。") }}</div>
          <div v-for="log in skillLogs.slice(0, 6)" :key="log.id" class="skill-log-item">
            <span class="muted">[{{ log.level }}]</span>
            <span>{{ log.action }}: {{ log.message }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
