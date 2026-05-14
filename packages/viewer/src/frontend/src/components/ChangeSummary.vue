<template>
  <span v-if="parts.length > 0" v-html="parts.join('')"></span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Block } from "../utils/block-defs";

interface Delta {
  sys?: { added: Block[]; removed: Block[] };
  tool?: { added: Block[]; removed: Block[] };
  msgs?: { added: Block[]; removed: Block[] }[];
}

const props = defineProps<{
  change: { delta?: Delta } | null;
}>();

const parts = computed(() => {
  if (!props.change?.delta) return [];
  const result: string[] = [];
  const delta = props.change.delta;

  if (delta.sys) {
    const { added, removed } = delta.sys;
    if (added.length > 0 || removed.length > 0) {
      result.push(renderCategorySummary("SYS", "sys", added, removed));
    }
  }

  if (delta.tool) {
    const { added, removed } = delta.tool;
    if (added.length > 0 || removed.length > 0) {
      result.push(renderCategorySummary("TOOL", "tool", added, removed));
    }
  }

  if (delta.msgs && delta.msgs.length > 0) {
    const allAdded: Block[] = [];
    const allRemoved: Block[] = [];
    for (const m of delta.msgs) {
      allAdded.push(...(m.added || []));
      allRemoved.push(...(m.removed || []));
    }
    if (allAdded.length > 0 || allRemoved.length > 0) {
      result.push(renderCategorySummary("MSG", "msg", allAdded, allRemoved));
    }
  }

  return result;
});

function renderCategorySummary(label: string, labelClass: string, added: Block[], removed: Block[]): string {
  let s = `<span class="cs-group"><span class="cs-label ${labelClass}">${label}</span>`;

  const typeCounts: Record<string, { added: number; removed: number }> = {};
  for (const b of added) {
    const t = b.type || "other";
    typeCounts[t] = typeCounts[t] || { added: 0, removed: 0 };
    typeCounts[t].added++;
  }
  for (const b of removed) {
    const t = b.type || "other";
    typeCounts[t] = typeCounts[t] || { added: 0, removed: 0 };
    typeCounts[t].removed++;
  }

  const types = Object.keys(typeCounts);
  if (types.length > 0) {
    s += '<span class="cs-types">';
    for (const t of types) {
      const tc = typeCounts[t];
      s += `<span class="cs-type">${t.toUpperCase()}`;
      if (tc.added > 0) s += `<span class="cs-plus">+${tc.added}</span>`;
      if (tc.removed > 0) s += `<span class="cs-minus">-${tc.removed}</span>`;
      s += "</span>";
    }
    s += "</span>";
  }

  s += "</span>";
  return s;
}
</script>

<style>
.cs-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 8px;
}

.cs-label {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 2px;
}

.cs-label.sys { background: rgba(139, 92, 246, 0.15); color: var(--sys-color); }
.cs-label.tool { background: rgba(255, 159, 10, 0.15); color: var(--warning); }
.cs-label.msg { background: rgba(61, 139, 255, 0.15); color: var(--accent); }

.cs-types {
  display: inline-flex;
  gap: 3px;
}

.cs-type {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}

.cs-plus {
  color: var(--success);
  margin-left: 2px;
}

.cs-minus {
  color: var(--danger);
  margin-left: 2px;
}
</style>
