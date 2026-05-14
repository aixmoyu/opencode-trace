<template>
  <header>
    <h1>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" width="20" height="20">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      opencode-trace
    </h1>
    <div class="header-actions">
      <div class="dropdown" ref="dropdownRef">
        <button
          class="dropdown-toggle"
          @click="toggleDropdown"
          aria-label="More actions"
          :aria-expanded="dropdownOpen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
        <div class="dropdown-menu" v-show="dropdownOpen">
          <button class="dropdown-item" @click="$emit('toggleTheme'); closeDropdown()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
            Toggle theme
          </button>
          <button class="dropdown-item" @click="$emit('toggleTrace'); closeDropdown()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
            Trace {{ traceEnabled ? 'ON' : 'OFF' }}
          </button>
          <div class="dropdown-divider"></div>
          <button v-if="showImport" class="dropdown-item" @click="$emit('import'); closeDropdown()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7,10 12,15 17,10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Import Session
          </button>
          <button v-if="showExport" class="dropdown-item" @click="$emit('export'); closeDropdown()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17,8 12,3 7,8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Export Session
          </button>
          <button class="dropdown-item" @click="$emit('keyboardHelp'); closeDropdown()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h12M6 16h8" />
            </svg>
            Keyboard shortcuts
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";

defineProps<{
  traceEnabled: boolean;
}>();

defineEmits<{
  toggleTheme: [];
  toggleTrace: [];
  import: [];
  export: [];
  keyboardHelp: [];
}>();

const route = useRoute();
const dropdownOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

function onDocumentClick(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    dropdownOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onUnmounted(() => document.removeEventListener("click", onDocumentClick));

const showImport = computed(() => route.name === "sessions");
const showExport = computed(() => route.name === "timeline");

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value;
}

function closeDropdown() {
  dropdownOpen.value = false;
}
</script>

<style scoped>
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 48px;
}

header h1 {
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dropdown {
  position: relative;
}

.dropdown-toggle {
  padding: 8px;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
}

.dropdown-toggle:hover {
  background: var(--bg-hover);
}

.dropdown-menu {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 200px;
  z-index: 100;
  padding: 4px;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 500;
  border-radius: var(--radius);
  transition: background 0.1s;
  text-align: left;
}

.dropdown-item:hover {
  background: var(--bg-hover);
}

.dropdown-item.danger {
  color: var(--danger);
}

.dropdown-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
