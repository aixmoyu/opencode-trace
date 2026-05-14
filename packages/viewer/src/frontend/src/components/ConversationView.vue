<template>
  <div v-if="!hasContent" class="empty-state"><p>No conversation data</p></div>
  <template v-else>
    <template v-if="sysBlocks.length > 0">
      <div class="section-title" :class="{ expanded: expandedSections.sys }" @click="toggleSection('sys')">
        <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
        SYSTEM PROMPT
      </div>
      <div class="section-content expanded" v-show="expandedSections.sys">
        <div class="msg">
          <div class="msg-header"><span class="cat-tag sys">SYS</span></div>
          <div class="msg-body">
            <BlockRenderer v-for="(block, i) in sysBlocks" :key="'sys-' + i" :block="block" />
          </div>
        </div>
      </div>
    </template>

    <template v-if="tdBlocks.length > 0">
      <div class="section-title" :class="{ expanded: expandedSections.tool }" @click="toggleSection('tool')">
        <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
        TOOL DEFINITIONS
      </div>
      <div class="section-content expanded" v-show="expandedSections.tool">
        <div class="msg">
          <div class="msg-header">
            <span class="cat-tag tool">TOOL</span>
            <span class="badge">{{ tdBlocks.length }} tools</span>
          </div>
          <div class="msg-body">
            <BlockRenderer v-for="(block, i) in tdBlocks" :key="'td-' + i" :block="block" />
          </div>
        </div>
      </div>
    </template>

    <template v-if="msgs.length > 0">
      <div class="section-title" :class="{ expanded: expandedSections.msgs }" @click="toggleSection('msgs')">
        <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
        MESSAGES
      </div>
      <div class="section-content expanded" v-show="expandedSections.msgs">
        <div class="msg-list">
          <div v-for="(msg, i) in msgs" :key="'msg-' + i" class="msg">
            <div class="msg-header">
              <span class="cat-tag msg">MSG</span>
              <span class="role-tag">{{ msg.role }}</span>
            </div>
            <div class="msg-body">
              <BlockRenderer v-for="(block, j) in (msg.blocks || [])" :key="'msg-block-' + j" :block="block" />
            </div>
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

interface Message {
  role: string;
  blocks?: Block[];
}

const props = defineProps<{
  parsed: {
    sys?: { blocks: Block[] };
    tool?: { blocks: Block[] };
    msgs?: Message[];
  };
}>();

const expandedSections = reactive({
  sys: true,
  tool: true,
  msgs: true,
});

function toggleSection(key: keyof typeof expandedSections) {
  expandedSections[key] = !expandedSections[key];
}

const sysBlocks = computed(() => props.parsed?.sys?.blocks || []);

const tdBlocks = computed(() => {
  const blocks = props.parsed?.tool?.blocks || [];
  return blocks.filter((b) => b.type === "td");
});

const msgs = computed(() => props.parsed?.msgs || []);

const hasContent = computed(() => {
  return sysBlocks.value.length > 0 || tdBlocks.value.length > 0 || msgs.value.length > 0;
});
</script>

<style scoped>
.section-content {
  margin-bottom: 16px;
}

.msg {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 8px;
  overflow: hidden;
}

.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
}

.msg-body {
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

.role-tag {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
</style>
