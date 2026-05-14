<template>
  <div class="metadata-card card">
    <div class="metadata-header">{{ title }}</div>
    <div class="metadata-body">
      <slot name="before-sections" />
      <div v-for="section in sections" :key="section.title" class="stat-section">
        <div class="stat-section-title">{{ section.title }}</div>
        <div v-if="section.layout === 'inline'" class="stat-row-inline">
          <span
            v-for="item in section.items"
            :key="item.key"
            :class="['stat-item', item.modifier]"
          >
            <span class="stat-key">{{ item.key }}</span>
            <router-link v-if="item.link" class="stat-val stat-link" :to="item.link">{{ item.value }}</router-link>
            <span v-else class="stat-val">{{ item.value }}</span>
          </span>
        </div>
        <div v-else class="stat-grid">
          <span
            v-for="item in section.items"
            :key="item.key"
            :class="['stat-item', item.modifier]"
          >
            <span class="stat-key">{{ item.key }}</span>
            <router-link v-if="item.link" class="stat-val stat-link" :to="item.link">{{ item.value }}</router-link>
            <span v-else class="stat-val">{{ item.value }}</span>
          </span>
        </div>
      </div>
      <slot name="after-sections" />
    </div>
  </div>
</template>

<script setup lang="ts">
interface StatItem {
  key: string;
  value: string;
  modifier?: "highlight" | "warning" | "danger" | "success";
  link?: string;
}

interface StatSection {
  title: string;
  items: StatItem[];
  layout?: "inline" | "grid";
}

defineProps<{
  title: string;
  sections: StatSection[];
}>();
</script>

<style scoped>
.metadata-header {
  padding: 12px 16px;
  background: var(--bg-tertiary);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.metadata-body {
  padding: 16px;
}

.stat-section {
  margin-bottom: 12px;
}

.stat-section:last-child {
  margin-bottom: 0;
}

.stat-section-title {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 600;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-row-inline {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 4px 10px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
}

.stat-key {
  color: var(--text-tertiary);
  font-weight: 500;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.stat-key::after {
  content: ":";
}

.stat-val {
  color: var(--text-primary);
  font-weight: 600;
  font-family: var(--font-family);
  font-size: 12px;
}

.stat-item.highlight .stat-val {
  color: var(--accent);
}

.stat-item.warning .stat-val {
  color: var(--warning);
}

.stat-item.danger .stat-val {
  color: var(--danger);
}

.stat-item.success .stat-val {
  color: var(--success);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}

.stat-grid .stat-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
}

.stat-grid .stat-key {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-grid .stat-val {
  font-size: 14px;
}

.stat-link {
  color: var(--accent);
  text-decoration: underline;
  font-weight: 500;
}

.stat-link:hover {
  color: var(--accent-hover);
}
</style>