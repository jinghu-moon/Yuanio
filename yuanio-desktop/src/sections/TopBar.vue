<script setup lang="ts">
import { IconMoon, IconSun } from "@tabler/icons-vue";
import type { TranslateFn } from "../types/desktop";

defineProps<{
  theme: "dark" | "light";
  themeLabel: string;
  t: TranslateFn;
  toggleTheme: () => void;
}>();
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span>Yuanio Desktop</span>
    </div>
    <div class="row">
      <button
        class="icon-btn"
        type="button"
        :aria-label="t('切换为{theme}', { theme: themeLabel })"
        :title="t('切换为{theme}', { theme: themeLabel })"
        @click="toggleTheme"
      >
        <IconSun v-if="theme === 'dark'" class="icon" :size="18" stroke-width="2" />
        <IconMoon v-else class="icon" :size="18" stroke-width="2" />
      </button>
    </div>
  </header>
</template>
