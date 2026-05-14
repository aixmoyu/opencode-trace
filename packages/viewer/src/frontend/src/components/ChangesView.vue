<template>
  <div v-if="!hasChanges" class="empty-state"><p>No change data for this request</p></div>
  <template v-else>
    <template v-if="sysAdded.length > 0 || sysRemoved.length > 0">
      <div class="section-title" :class="{ expanded: expandedSections.sys }" @click="toggleSection('sys')">
        <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
        SYSTEM PROMPT
      </div>
      <div class="section-content expanded" v-show="expandedSections.sys">
        <div v-if="sysRemoved.length > 0" class="change-card removed">
          <div class="change-card-header">
            <span class="cat-tag sys">SYS</span>
            <span class="action-tag del">-DEL</span>
          </div>
          <div class="change-card-body">
            <BlockRenderer v-for="(block, i) in sysRemoved" :key="'sys-rem-' + i" :block="block" />
          </div>
        </div>
        <div v-if="sysAdded.length > 0" class="change-card added">
          <div class="change-card-header">
            <span class="cat-tag sys">SYS</span>
            <span class="action-tag new">+NEW</span>
          </div>
          <div class="change-card-body">
            <BlockRenderer v-for="(block, i) in sysAdded" :key="'sys-add-' + i" :block="block" />
          </div>
        </div>
      </div>
    </template>

    <template v-if="toolAdded.length > 0 || toolRemoved.length > 0">
      <div class="section-title" :class="{ expanded: expandedSections.tool }" @click="toggleSection('tool')">
        <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
        TOOL DEFINITIONS
      </div>
      <div class="section-content expanded" v-show="expandedSections.tool">
        <div v-if="toolAdded.length > 0" class="change-card added">
          <div class="change-card-header">
            <span class="cat-tag tool">TOOL</span>
            <span class="action-tag new">+NEW</span>
          </div>
          <div class="change-card-body">
            <BlockRenderer v-for="(block, i) in toolAdded" :key="'tool-add-' + i" :block="block" />
          </div>
        </div>
        <div v-if="toolRemoved.length > 0" class="change-card removed">
          <div class="change-card-header">
            <span class="cat-tag tool">TOOL</span>
            <span class="action-tag del">-DEL</span>
          </div>
          <div class="change-card-body">
            <BlockRenderer v-for="(block, i) in toolRemoved" :key="'tool-rem-' + i" :block="block" />
          </div>
        </div>
      </div>
    </template>

    <template v-if="msgAdded.length > 0 || msgRemoved.length > 0">
      <div class="section-title" :class="{ expanded: expandedSections.msgs }" @click="toggleSection('msgs')">
        <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
        MESSAGES
      </div>
      <div class="section-content expanded" v-show="expandedSections.msgs">
        <div v-if="msgRemoved.length > 0" class="change-card removed">
          <div class="change-card-header">
            <span class="cat-tag msg">MSG</span>
            <span class="action-tag del">-DEL</span>
          </div>
          <div class="change-card-body">
            <BlockRenderer v-for="(block, i) in msgRemoved" :key="'msg-rem-' + i" :block="block" />
          </div>
        </div>
        <div v-if="msgAdded.length > 0" class="change-card added">
          <div class="change-card-header">
            <span class="cat-tag msg">MSG</span>
            <span class="action-tag new">+NEW</span>
          </div>
          <div class="change-card-body">
            <BlockRenderer v-for="(block, i) in msgAdded" :key="'msg-add-' + i" :block="block" />
          </div>
        </div>
      </div>
    </template>
  </template>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import BlockRenderer from "./BlockRenderer.vue";
import type { Block } from "../utils/block-defs";

interface Delta {
  sys?: { added: Block[]; removed: Block[] };
  tool?: { added: Block[]; removed: Block[] };
  msgs?: { added: Block[]; removed: Block[] }[];
}

const props = defineProps<{
  changeData: { delta?: Delta } | null;
}>();

const expandedSections = reactive({
  sys: true,
  tool: true,
  msgs: true,
});

function toggleSection(key: keyof typeof expandedSections) {
  expandedSections[key] = !expandedSections[key];
}

const delta = computed(() => props.changeData?.delta);

const sysAdded = computed(() => delta.value?.sys?.added || []);
const sysRemoved = computed(() => delta.value?.sys?.removed || []);
const toolAdded = computed(() => delta.value?.tool?.added || []);
const toolRemoved = computed(() => delta.value?.tool?.removed || []);

const msgAdded = computed(() => {
  const msgs = delta.value?.msgs || [];
  const all: Block[] = [];
  for (const m of msgs) {
    if (m.added) all.push(...m.added);
  }
  return all;
});

const msgRemoved = computed(() => {
  const msgs = delta.value?.msgs || [];
  const all: Block[] = [];
  for (const m of msgs) {
    if (m.removed) all.push(...m.removed);
  }
  return all;
});

const hasChanges = computed(() => {
  return sysAdded.value.length > 0 || sysRemoved.value.length > 0 ||
    toolAdded.value.length > 0 || toolRemoved.value.length > 0 ||
    msgAdded.value.length > 0 || msgRemoved.value.length > 0;
});
</script>

<style scoped>
.section-content {
  margin-bottom: 16px;
}

.change-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 8px;
  overflow: hidden;
}

.change-card.added {
  border-left: 3px solid var(--success);
}

.change-card.removed {
  border-left: 3px solid var(--danger);
}

.change-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
}

.change-card-body {
  padding: 8px;
}

.cat-tag {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 2px;
}

.cat-tag.sys { background: rgba(139, 92, 246, 0.15); color: var(--sys-color); }
.cat-tag.tool { background: rgba(255, 159, 10, 0.15); color: var(--warning); }
.cat-tag.msg { background: rgba(61, 139, 255, 0.15); color: var(--accent); }

.action-tag {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 2px;
}

.action-tag.new { background: rgba(48, 209, 88, 0.15); color: var(--success); }
.action-tag.del { background: rgba(255, 59, 48, 0.15); color: var(--danger); }
</style>
