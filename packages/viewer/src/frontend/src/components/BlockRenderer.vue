<template>
  <div class="block-item" :data-block-type="block.type">
    <div class="block-type-bar">
      <div class="block-type-left">
        <span :class="['block-type-tag', block.type]">{{ def.tag }}</span>
        <span v-if="def.renderMeta" v-html="def.renderMeta(block)"></span>
      </div>
      <div class="block-type-right">
        <button
          v-if="def.toggle"
          class="toggle-btn"
          aria-label="Toggle between rendered and raw view"
          :data-mode="viewMode"
          :class="{ active: viewMode === 'rendered' }"
          @click="toggleView"
        >&lt;/&gt;</button>
      </div>
    </div>
    <div v-if="hasContent" :class="['block-content', viewMode, contentClass]">
      <button class="copy-btn" aria-label="Copy this content" @click="copyContent">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>
      <div v-if="viewMode === 'raw'" v-html="rawHtml"></div>
      <div v-else v-html="renderedHtml"></div>
    </div>
    <textarea v-if="rawContent" class="raw-content-store" style="display:none" :value="rawContent"></textarea>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { BLOCK_DEFS, formatJsonLines, formatXmlLines, renderContent } from "../utils/block-defs";
import { marked } from "marked";
import { esc } from "../utils/format";
import { useToast } from "../composables/useToast";
import type { Block } from "../utils/block-defs";

const props = defineProps<{
  block: Block;
}>();

const { showToast } = useToast();
const viewMode = ref<"raw" | "rendered">("raw");

const def = computed(() => BLOCK_DEFS[props.block.type] || {
  tag: props.block.type.toUpperCase(),
  toggle: false,
  renderMeta: null,
  getRaw: null,
  renderRaw: null,
  renderRendered: null,
});

const rawContent = computed(() => {
  if (def.value.getRaw) return def.value.getRaw(props.block);
  return "";
});

const rawHtml = computed(() => {
  if (def.value.renderRaw) return def.value.renderRaw(props.block);
  if (rawContent.value) return esc(rawContent.value);
  return "";
});

const renderedHtml = computed(() => {
  if (def.value.renderRendered) {
    return def.value.renderRendered(rawContent.value);
  }
  if (props.block.type === "text" || props.block.type === "thinking") {
    return renderMarkdown(rawContent.value);
  }
  if (props.block.type === "tc" || props.block.type === "tr") {
    return renderContent(rawContent.value);
  }
  if (props.block.type === "td") {
    try {
      const obj = JSON.parse(rawContent.value);
      let h = "";
      if (obj.description) h += `<div class="tool-def-desc">${esc(obj.description)}</div>`;
      if (obj.parameters) h += `<div class="tool-def-params">${formatJsonLines(obj.parameters)}</div>`;
      return h || esc(rawContent.value);
    } catch {
      return esc(rawContent.value);
    }
  }
  return esc(rawContent.value);
});

const hasContent = computed(() => {
  return !!(rawHtml.value || renderedHtml.value || rawContent.value);
});

const contentClass = computed(() => {
  if (props.block.type === "json") return "json-lines";
  if (props.block.type === "xml") return "xml-lines";
  return "";
});

function toggleView() {
  viewMode.value = viewMode.value === "raw" ? "rendered" : "raw";
}

function copyContent() {
  const text = rawContent.value;
  navigator.clipboard.writeText(text).then(() => {
    showToast("Copied!", "success", undefined, undefined, 2000);
  }).catch((e) => {
    console.error("Copy failed:", e);
  });
}

function renderMarkdown(text: string): string {
  if (!text) return "";
  try {
    return marked.parse(text, { breaks: true, gfm: true }) as string;
  } catch {
    return esc(text);
  }
}
</script>

<style scoped>
.block-item {
  margin-bottom: 8px;
}

.block-type-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border-radius: var(--radius) var(--radius) 0 0;
  border: 1px solid var(--border);
  border-bottom: none;
}

.block-type-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.block-type-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.block-type-tag {
  font-weight: 700;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 2px;
}

.block-type-tag.text { background: rgba(61, 139, 255, 0.15); color: var(--accent); }
.block-type-tag.thinking { background: rgba(139, 92, 246, 0.15); color: var(--sys-color); }
.block-type-tag.td { background: rgba(255, 159, 10, 0.15); color: var(--warning); }
.block-type-tag.tc { background: rgba(48, 209, 88, 0.15); color: var(--success); }
.block-type-tag.tr { background: rgba(48, 209, 88, 0.15); color: var(--success); }
.block-type-tag.image { background: rgba(154, 152, 152, 0.15); color: var(--text-secondary); }
.block-type-tag.json { background: rgba(167, 139, 250, 0.15); color: var(--json-key-color); }
.block-type-tag.xml { background: rgba(255, 159, 10, 0.15); color: var(--warning); }
.block-type-tag.status { background: rgba(154, 152, 152, 0.15); color: var(--text-secondary); }

.tool-meta-name {
  font-weight: 500;
  color: var(--text-primary);
}

.tool-meta-id {
  color: var(--text-secondary);
}

.toggle-btn {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 2px;
  color: var(--text-tertiary);
  transition: color 0.1s, background 0.1s;
}

.toggle-btn:hover,
.toggle-btn.active {
  color: var(--accent);
  background: rgba(61, 139, 255, 0.1);
}

.block-content {
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 0 0 var(--radius) var(--radius);
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
  position: relative;
}

.block-content.empty {
  display: none;
}

.block-content.raw {
  white-space: pre-wrap;
  word-break: break-word;
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

.block-content:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  background: var(--bg-hover);
}

.content-muted {
  color: var(--text-tertiary);
  font-style: italic;
}

.tool-def-desc {
  margin-bottom: 8px;
  color: var(--text-secondary);
}

.tool-def-params {
  margin-top: 4px;
}
</style>
