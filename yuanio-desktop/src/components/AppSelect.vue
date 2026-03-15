<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { IconChevronDown } from "@tabler/icons-vue";

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const modelValue = defineModel<string>({ default: "" });
const props = withDefaults(
  defineProps<{
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md";
  }>(),
  {
    placeholder: "",
    disabled: false,
    size: "md",
  },
);

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const menuPlacement = ref<"bottom" | "top">("bottom");

const transitionName = computed(() => (menuPlacement.value === "top" ? "select-fade-up" : "select-fade"));

const selectedOption = computed(() => props.options.find((option) => option.value === modelValue.value));
const displayLabel = computed(() => selectedOption.value?.label ?? props.placeholder);
const isPlaceholder = computed(() => !selectedOption.value);

const closeMenu = () => {
  open.value = false;
};

const toggleMenu = () => {
  if (props.disabled) return;
  open.value = !open.value;
};

const selectOption = (option: SelectOption) => {
  if (props.disabled || option.disabled) return;
  modelValue.value = option.value;
  closeMenu();
};

const onTriggerKeydown = (event: KeyboardEvent) => {
  if (props.disabled) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleMenu();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
  }
};

const onDocumentPointer = (event: PointerEvent) => {
  if (!rootRef.value) return;
  if (!rootRef.value.contains(event.target as Node)) {
    closeMenu();
  }
};

const updatePlacement = () => {
  if (!open.value) return;
  const anchor = triggerRef.value ?? rootRef.value;
  const menu = menuRef.value;
  if (!anchor || !menu) return;
  const rect = anchor.getBoundingClientRect();
  const menuHeight = menu.getBoundingClientRect().height;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  if (spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow) {
    menuPlacement.value = "top";
    return;
  }
  menuPlacement.value = "bottom";
};

const removePlacementListeners = () => {
  window.removeEventListener("resize", updatePlacement);
  window.removeEventListener("scroll", updatePlacement, true);
};

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointer);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointer);
  removePlacementListeners();
});

watch(
  () => props.disabled,
  (value) => {
    if (value) closeMenu();
  },
);

watch(open, async (value) => {
  removePlacementListeners();
  if (!value) return;
  await nextTick();
  updatePlacement();
  window.addEventListener("resize", updatePlacement);
  window.addEventListener("scroll", updatePlacement, true);
});
</script>

<template>
  <div ref="rootRef" class="select" :class="{ open, disabled: props.disabled, sm: props.size === 'sm' }">
    <button
      ref="triggerRef"
      class="select-trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-disabled="props.disabled"
      :disabled="props.disabled"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="select-value" :class="{ placeholder: isPlaceholder }">{{ displayLabel || "-" }}</span>
      <IconChevronDown class="select-arrow" :size="18" stroke-width="1.8" />
    </button>
    <transition :name="transitionName">
      <div v-if="open" ref="menuRef" class="select-menu" :class="{ 'drop-up': menuPlacement === 'top' }" role="listbox">
        <button
          v-for="option in props.options"
          :key="option.value"
          class="select-option"
          :class="{ active: option.value === modelValue, disabled: option.disabled }"
          type="button"
          role="option"
          :aria-selected="option.value === modelValue"
          :disabled="option.disabled"
          @click="selectOption(option)"
        >
          {{ option.label }}
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.select {
  position: relative;
  width: auto;
  min-width: 200px;
}

.select.sm {
  min-width: 160px;
}

.select.field-control {
  width: 100%;
  min-width: 0;
}

.select-trigger {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--gray-alpha-600);
  background: var(--background-100);
  color: var(--gray-1000);
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.select.sm .select-trigger {
  height: 30px;
  font-size: 0.75rem;
}

.select-trigger:hover {
  background: var(--gray-200);
}

.select-trigger:focus-visible {
  border-color: var(--blue-700);
  box-shadow: 0 0 0 3px rgba(0, 114, 245, 0.12);
  outline: none;
}

.select.disabled .select-trigger {
  cursor: not-allowed;
  opacity: 0.6;
  background: var(--gray-200);
}

.select-value {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.select-value.placeholder {
  color: var(--gray-800);
}

.select-arrow {
  color: var(--gray-800);
  transition: transform 0.2s ease;
}

.select.open .select-arrow {
  transform: rotate(180deg);
}

.select-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--background-100);
  border: 1px solid var(--gray-alpha-600);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.12);
  z-index: 50;
  max-height: 240px;
  overflow-y: auto;
}

.select-menu.drop-up {
  top: auto;
  bottom: calc(100% + 6px);
}

.select-option {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--gray-1000);
  text-align: left;
  cursor: pointer;
  font-size: 0.8rem;
  transition: background 0.15s ease, color 0.15s ease;
}

.select-option:hover {
  background: var(--gray-200);
}

.select-option.active {
  background: rgba(0, 114, 245, 0.12);
  color: var(--blue-700);
  font-weight: 500;
}

.select-option.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.select-fade-enter-active,
.select-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.select-fade-enter-from,
.select-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.select-fade-up-enter-active,
.select-fade-up-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.select-fade-up-enter-from,
.select-fade-up-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
