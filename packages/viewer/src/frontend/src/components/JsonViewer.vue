<template>
  <div class="json-container">
    <button class="copy-btn" aria-label="Copy JSON content" @click="copyContent">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
    <div v-for="(line, i) in lines" :key="i" class="json-line">
      <span class="json-num">{{ i + 1 }}</span>
      <span v-html="line"></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useToast } from "../composables/useToast";

const props = defineProps<{
  data: unknown;
}>();

const { showToast } = useToast();

const lines = computed(() => {
  const json = JSON.stringify(props.data, null, 2) || String(props.data);
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const highlighted = escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
          const key = match.slice(0, -1);
          return `<span class="${cls}">${key}</span>:`;
        }
        cls = "json-string";
      } else if (/true/.test(match)) {
        cls = "json-bool json-true";
      } else if (/false/.test(match)) {
        cls = "json-bool json-false";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );

  return highlighted.split("\n");
});

function copyContent() {
  const text = JSON.stringify(props.data, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    showToast("Copied!", "success", undefined, undefined, 2000);
  }).catch((e) => {
    console.error("Copy failed:", e);
  });
}
</script>

<style scoped>
.json-container {
  position: relative;
  background: var(--bg-primary);
  font-size: 13px;
  line-height: 1.6;
}

.copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 4px;
  border-radius: 2px;
  opacity: 0;
  transition: opacity 0.1s;
  z-index: 1;
}

.json-container:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  background: var(--bg-hover);
}

.json-line {
  display: flex;
  padding: 0 12px;
  min-height: 22px;
}

.json-line:hover {
  background: var(--bg-hover);
}

.json-num {
  flex-shrink: 0;
  width: 40px;
  text-align: right;
  padding-right: 12px;
  color: var(--text-tertiary);
  user-select: none;
}
</style>
