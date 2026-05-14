<template>
  <div>
    <div class="section-title" :class="{ expanded: expandedSections.headers }" @click="toggleSection('headers')">
      <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6" />
      </svg>
      REQUEST HEADERS
    </div>
    <div class="section-content expanded" v-show="expandedSections.headers">
      <div class="json-block">
        <JsonViewer :data="record.request?.headers || {}" />
      </div>
    </div>

    <div class="section-title" :class="{ expanded: expandedSections.body }" @click="toggleSection('body')">
      <svg class="section-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6" />
      </svg>
      REQUEST BODY
    </div>
    <div class="section-content expanded" v-show="expandedSections.body">
      <div class="json-block">
        <JsonViewer :data="record.request?.body || {}" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";
import JsonViewer from "./JsonViewer.vue";

defineProps<{
  record: {
    request?: { headers?: unknown; body?: unknown };
  };
}>();

const expandedSections = reactive({
  headers: true,
  body: true,
});

function toggleSection(key: keyof typeof expandedSections) {
  expandedSections[key] = !expandedSections[key];
}
</script>

<style scoped>
.section-content {
  margin-bottom: 16px;
}

.json-block {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
</style>
