<script setup lang="ts">
import type { Component } from "vue";
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarRightCollapse } from "@tabler/icons-vue";
import AppTooltip from "../components/AppTooltip.vue";
import type { TranslateFn } from "../types/desktop";

type NavItem = {
  id: string;
  label: string;
  icon: Component;
};

defineProps<{
  items: NavItem[];
  activeId: string;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onToggle: () => void;
  t: TranslateFn;
}>();
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-header">
      <div class="header-logo-container">
        <div class="logo-box">Y</div>
      </div>
      <span class="logo-text">Yuanio</span>
    </div>
    <nav class="sidebar-nav">
      <AppTooltip
        v-for="item in items"
        :key="item.id"
        :content="t(item.label)"
        placement="right"
        :disabled="!collapsed"
      >
        <button
          class="nav-item"
          :class="{ active: item.id === activeId }"
          type="button"
          :aria-current="item.id === activeId ? 'page' : undefined"
          :aria-label="t(item.label)"
          @click="onSelect(item.id)"
        >
          <div class="nav-icon-box">
            <component :is="item.icon" :size="18" stroke-width="1.8" />
          </div>
          <span class="nav-label">{{ t(item.label) }}</span>
        </button>
      </AppTooltip>
    </nav>
    <div class="sidebar-footer">
      <AppTooltip :content="collapsed ? '展开' : '折叠'" placement="right" :disabled="!collapsed">
        <button class="sidebar-btn" type="button" :aria-label="collapsed ? '展开' : '折叠'" @click="onToggle">
          <IconLayoutSidebarRightCollapse v-if="collapsed" :size="18" stroke-width="1.8" />
          <IconLayoutSidebarLeftCollapse v-else :size="18" stroke-width="1.8" />
        </button>
      </AppTooltip>
    </div>
  </aside>
</template>
