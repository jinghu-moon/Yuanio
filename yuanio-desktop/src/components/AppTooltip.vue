<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    content: string;
    placement?: "right" | "left" | "top" | "bottom";
    offset?: number;
    disabled?: boolean;
  }>(),
  {
    placement: "right",
    offset: 8,
    disabled: false,
  },
);

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);
const tooltipStyle = ref<Record<string, string>>({});

const enabled = computed(() => Boolean(props.content) && !props.disabled);

const closeTooltip = () => {
  open.value = false;
};

const openTooltip = () => {
  if (!enabled.value) return;
  open.value = true;
};

const updatePosition = () => {
  const trigger = triggerRef.value;
  const tooltip = tooltipRef.value;
  if (!trigger || !tooltip) return;
  const rect = trigger.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const offset = props.offset ?? 8;
  let top = 0;
  let left = 0;
  let transform = "";
  if (props.placement === "left") {
    top = rect.top + rect.height / 2;
    left = rect.left - offset;
    transform = "translate(-100%, -50%)";
  } else if (props.placement === "top") {
    top = rect.top - offset;
    left = rect.left + rect.width / 2;
    transform = "translate(-50%, -100%)";
  } else if (props.placement === "bottom") {
    top = rect.bottom + offset;
    left = rect.left + rect.width / 2;
    transform = "translate(-50%, 0)";
  } else {
    top = rect.top + rect.height / 2;
    left = rect.right + offset;
    transform = "translate(0, -50%)";
  }
  tooltipStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    transform,
  };
};

const onWindowChange = () => {
  if (!open.value) return;
  updatePosition();
};

const onWindowBlur = () => {
  closeTooltip();
};

const onWindowFocus = () => {
  closeTooltip();
};

const onWindowMouseOut = (event: MouseEvent) => {
  if (event.relatedTarget === null) {
    closeTooltip();
  }
};

const onVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    closeTooltip();
  }
};

const removeListeners = () => {
  window.removeEventListener("resize", onWindowChange);
  window.removeEventListener("scroll", onWindowChange, true);
};

watch(open, async (value) => {
  removeListeners();
  if (!value) return;
  await nextTick();
  updatePosition();
  window.addEventListener("resize", onWindowChange);
  window.addEventListener("scroll", onWindowChange, true);
});

watch(
  () => props.disabled,
  (value) => {
    if (value) closeTooltip();
  },
);

onMounted(() => {
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("focus", onWindowFocus);
  window.addEventListener("mouseout", onWindowMouseOut);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
  removeListeners();
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("focus", onWindowFocus);
  window.removeEventListener("mouseout", onWindowMouseOut);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<template>
  <span
    ref="triggerRef"
    class="tooltip-trigger"
    @mouseenter="openTooltip"
    @mouseleave="closeTooltip"
    @focusin="openTooltip"
    @focusout="closeTooltip"
  >
    <slot />
  </span>
  <Teleport to="body">
    <transition name="tooltip-fade">
      <div v-if="open" ref="tooltipRef" class="app-tooltip" :style="tooltipStyle" role="tooltip">
        {{ content }}
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.tooltip-trigger {
  display: block;
  width: 100%;
}

.app-tooltip {
  position: fixed;
  z-index: 2000;
  max-width: 220px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--gray-alpha-600);
  background: var(--background-100);
  color: var(--gray-1000);
  font-size: 0.75rem;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
  pointer-events: none;
  white-space: nowrap;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
