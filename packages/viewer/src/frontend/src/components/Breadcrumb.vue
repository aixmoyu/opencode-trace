<template>
  <nav v-if="items.length > 0" class="breadcrumb" aria-label="Breadcrumb">
    <template v-for="(item, i) in items" :key="item.href">
      <router-link v-if="i < items.length - 1" :to="item.href">{{ item.label }}</router-link>
      <span v-if="i < items.length - 1" class="sep">/</span>
      <span v-else class="current">{{ item.label }}</span>
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

interface Crumb {
  label: string;
  href: string;
}

const route = useRoute();

const items = computed<Crumb[]>(() => {
  const crumbs: Crumb[] = [{ label: "Sessions", href: "/" }];

  if (route.name === "timeline" && route.params.sessionId) {
    const sid = route.params.sessionId as string;
    crumbs.push({ label: sid, href: `/session/${sid}` });
  } else if (route.name === "record" && route.params.sessionId && route.params.recordId) {
    const sid = route.params.sessionId as string;
    const rid = route.params.recordId as string;
    crumbs.push({ label: sid, href: `/session/${sid}` });
    crumbs.push({ label: `#${rid}`, href: `/session/${sid}/record/${rid}` });
  }

  return crumbs;
});
</script>

<style scoped>
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  padding: 8px 24px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.breadcrumb a {
  color: var(--text-secondary);
  text-decoration: none;
}

.breadcrumb a:hover {
  color: var(--accent);
  text-decoration: underline;
}

.sep {
  color: var(--text-tertiary);
  margin: 0 2px;
}

.current {
  color: var(--text-primary);
  font-weight: 500;
}
</style>
