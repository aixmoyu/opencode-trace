<template>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <div id="a11y-live-region" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>

  <AppHeader
    :trace-enabled="traceEnabled"
    @toggle-theme="toggleTheme"
    @toggle-trace="toggleTraceEnabled"
    @import="showImportModal = true"
    @export="handleExport"
    @keyboard-help="showKeyboardHelp = true"
  />

  <Breadcrumb />

  <main id="main-content">
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
  </main>

  <FabButtons />

  <ToastContainer />

  <ConfirmDialog
    v-if="confirmState"
    :title="confirmState.title"
    :message="confirmState.message"
    @confirm="handleConfirm"
    @cancel="confirmState = null"
  />

  <KeyboardHelp
    v-if="showKeyboardHelp"
    @close="showKeyboardHelp = false"
  />

  <ImportModal
    v-if="showImportModal"
    @close="showImportModal = false"
    @imported="onImported"
  />
</template>

<script setup lang="ts">
import { ref, provide } from "vue";
import { useRouter } from "vue-router";
import AppHeader from "./components/AppHeader.vue";
import Breadcrumb from "./components/Breadcrumb.vue";
import FabButtons from "./components/FabButtons.vue";
import ToastContainer from "./components/ToastContainer.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import KeyboardHelp from "./components/KeyboardHelp.vue";
import ImportModal from "./components/ImportModal.vue";
import { useTheme } from "./composables/useTheme";
import { useToast } from "./composables/useToast";
import { useKeyboard } from "./composables/useKeyboard";
import { api } from "./composables/useApi";

const { toggleTheme } = useTheme();
const { showToast } = useToast();
const router = useRouter();

const traceEnabled = ref(false);
const showKeyboardHelp = ref(false);
const showImportModal = ref(false);

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => void;
}
const confirmState = ref<ConfirmState | null>(null);

function showConfirm(title: string, message: string, onConfirm: () => void) {
  confirmState.value = { title, message, onConfirm };
}

function handleConfirm() {
  if (confirmState.value) {
    confirmState.value.onConfirm();
    confirmState.value = null;
  }
}

provide("showConfirm", showConfirm);
provide("showToast", showToast);

async function loadTraceStatus() {
  try {
    const res = await api<{ globalEnabled: boolean }>("trace/status");
    traceEnabled.value = res.globalEnabled;
  } catch {
    traceEnabled.value = false;
  }
}

async function toggleTraceEnabled() {
  const isOn = traceEnabled.value;
  try {
    await api(`trace/${isOn ? "disable" : "enable"}`);
    traceEnabled.value = !isOn;
    showToast(`Trace ${traceEnabled.value ? "enabled" : "disabled"}`, "success");
  } catch (e) {
    console.error("Failed to toggle trace:", e);
  }
}

function handleExport() {
  const route = router.currentRoute.value;
  if (route.name === "timeline" && route.params.sessionId) {
    exportSession(route.params.sessionId as string);
  }
}

async function exportSession(sessionId: string) {
  try {
    showToast("Exporting session...", "info");
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export`, { method: "POST" });
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sessionId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Session exported!", "success");
  } catch (e) {
    showToast(`Export failed: ${(e as Error).message}`, "error");
  }
}

function onImported() {
  showImportModal.value = false;
  if (router.currentRoute.value.name === "sessions") {
    router.replace("/");
  }
}

useKeyboard({
  "/": () => {
    const input = document.querySelector<HTMLInputElement>("#session-search, .search-input");
    input?.focus();
  },
  "?": () => {
    showKeyboardHelp.value = true;
  },
  "e": () => {
    const route = router.currentRoute.value;
    if (route.name === "timeline" && route.params.sessionId) {
      exportSession(route.params.sessionId as string);
    }
  },
  "Escape": () => {
    showKeyboardHelp.value = false;
    showImportModal.value = false;
    confirmState.value = null;
  },
});

loadTraceStatus();
</script>
