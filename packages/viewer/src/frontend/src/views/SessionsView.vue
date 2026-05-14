<template>
  <div class="container">
    <div v-if="loading" class="loading"><div class="spinner"></div>Loading...</div>

    <template v-else-if="error">
      <div class="error-banner">{{ error }}</div>
    </template>

    <template v-else-if="groups.length === 0">
      <div class="empty-state">
        <div class="icon">📁</div>
        <p>No sessions found</p>
        <p style="font-size:12px;margin-top:8px;color:var(--text-secondary)">Trace data is stored in ~/.opencode-trace</p>
        <p style="font-size:12px;margin-top:4px;color:var(--text-tertiary)">
          Run <code>opencode</code> to start recording sessions
        </p>
      </div>
    </template>

    <template v-else>
      <div class="page-title">Sessions <span class="count">{{ totalCount }}</span></div>

      <div class="sessions-controls-bar">
        <div class="view-controls">
          <div class="search-input-container">
            <span class="search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              ref="searchInputRef"
              type="search"
              class="search-input"
              placeholder="Search sessions..."
              aria-label="Search sessions"
              v-model="searchQuery"
              @input="onSearch"
            />
            <button
              v-show="searchQuery"
              class="search-clear"
              aria-label="Clear search"
              @click="clearSearch"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <label class="sort-label">
            <span class="sort-label-text">Sort:</span>
            <select class="sort-select" aria-label="Sort sessions" v-model="sortMode" @change="onSortChange">
              <option value="recent">Recent</option>
              <option value="name_asc">A-Z</option>
              <option value="name_desc">Z-A</option>
              <option value="created">Created</option>
            </select>
          </label>
        </div>
      </div>

      <div v-if="filteredGroups.length === 0 && searchQuery" class="empty-state">
        <div class="icon">🔍</div>
        <p>No sessions match "{{ searchQuery }}"</p>
      </div>

      <div v-else class="folder-groups">
        <div v-for="group in filteredGroups" :key="group.fullPath" class="folder-group">
          <div class="folder-header">
            <div class="folder-title">{{ group.projectName }}</div>
            <div class="folder-path">{{ group.fullPath }}</div>
            <span class="badge">{{ group.totalCount }} sessions</span>
            <span class="badge">{{ relativeTime(group.lastActivity) }}</span>
          </div>
          <div class="folder-sessions">
            <div v-for="node in group.sessions" :key="node.id">
              <div
                class="session-card card card-interactive parent-card"
                tabindex="0"
                role="button"
                :aria-label="`View session ${node.title || node.id}`"
                @click="router.push(`/session/${node.id}`)"
                @keydown.enter="router.push(`/session/${node.id}`)"
              >
                <div class="session-card-header">
                  <div class="session-title-row">
                    <div class="session-card-content">
                      <div class="session-title">{{ node.title || node.id }}</div>
                      <div v-if="node.title" class="session-id">{{ node.id }}</div>
                      <div class="session-meta">
                        <span class="badge">{{ node.requestCount }} requests</span>
                        <span v-if="node.createdAt" class="badge">{{ relativeTime(node.createdAt) }}</span>
                        <span v-if="node.updatedAt" class="badge">updated {{ relativeTime(node.updatedAt) }}</span>
                        <span v-if="node.children?.length" class="badge">{{ node.children.length }} children</span>
                      </div>
                    </div>
                  </div>
                  <div class="session-card-actions" @click.stop>
                    <div class="session-card-more">
                      <button
                        class="session-more-btn"
                        aria-label="More options"
                        :aria-expanded="openMenuId === node.id"
                        @click="toggleMenu(node.id)"
                      >⋮</button>
                      <div v-show="openMenuId === node.id" class="session-more-menu">
                        <button
                          v-if="node.children?.length"
                          class="dropdown-item"
                          @click="toggleChildren(node.id)"
                        >
                          <svg 
                            width="16" 
                            height="16" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            stroke-width="2"
                            :class="['subsession-arrow', { 'rotated': expandedChildren.has(node.id) }]"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                          subsessions
                        </button>
                        <button class="dropdown-item danger" @click="deleteSession(node.id)">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="node.children?.length && expandedChildren.has(node.id)"
                class="children-container"
              >
                <div
                  v-for="child in node.children"
                  :key="child.id"
                  class="session-card card card-interactive child-card"
                  tabindex="0"
                  role="button"
                  :aria-label="`View session ${child.title || child.id}`"
                  @click="router.push(`/session/${child.id}`)"
                  @keydown.enter="router.push(`/session/${child.id}`)"
                >
                  <div class="session-title">{{ child.title || child.id }}</div>
                  <div v-if="child.title" class="session-id">{{ child.id }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject, watch } from "vue";
import { useRouter } from "vue-router";
import { api, apiDelete } from "../composables/useApi";
import { relativeTime, getProjectName, esc } from "../utils/format";

const router = useRouter();
const showConfirm = inject<(title: string, message: string, onConfirm: () => void) => void>("showConfirm")!;
const showToast = inject<(message: string, type: string) => void>("showToast")!;

interface TreeNode {
  id: string;
  title?: string;
  folderPath?: string;
  requestCount: number;
  createdAt?: string;
  updatedAt?: string;
  children?: TreeNode[];
}

interface FolderGroup {
  projectName: string;
  fullPath: string;
  lastActivity: string | null;
  sessions: TreeNode[];
  totalCount: number;
}

const loading = ref(true);
const error = ref("");
const tree = ref<TreeNode[]>([]);
const searchQuery = ref("");
const sortMode = ref("recent");
const openMenuId = ref<string | null>(null);
const expandedChildren = ref(new Set<string>());
const searchInputRef = ref<HTMLInputElement | null>(null);

const groups = computed(() => {
  const grouped = groupTreeByFolder(tree.value);
  return sortGroups(grouped, sortMode.value);
});

const filteredGroups = computed(() => {
  if (!searchQuery.value) return groups.value;
  const q = searchQuery.value.toLowerCase();
  return groups.value
    .map((g) => {
      const matches = g.sessions.filter((s) => {
        const title = (s.title || s.id).toLowerCase();
        const id = s.id.toLowerCase();
        if (title.includes(q) || id.includes(q)) return true;
        if (s.children) {
          return s.children.some((c) => {
            const ct = (c.title || c.id).toLowerCase();
            const ci = c.id.toLowerCase();
            return ct.includes(q) || ci.includes(q);
          });
        }
        return false;
      });
      if (matches.length === 0) return null;
      return { ...g, sessions: matches, totalCount: countTotal(matches) };
    })
    .filter(Boolean) as FolderGroup[];
});

const totalCount = computed(() => {
  let n = 0;
  for (const g of groups.value) n += g.totalCount;
  return n;
});

function countTotal(sessions: TreeNode[]): number {
  let n = sessions.length;
  for (const s of sessions) {
    if (s.children) n += s.children.length;
  }
  return n;
}

function groupTreeByFolder(nodes: TreeNode[]): FolderGroup[] {
  const map: Record<string, FolderGroup> = {};
  for (const node of nodes) {
    const folder = node.folderPath || "Unknown";
    if (!map[folder]) {
      map[folder] = {
        projectName: getProjectName(folder),
        fullPath: folder,
        sessions: [],
        lastActivity: null,
        totalCount: 0,
      };
    }
    map[folder].sessions.push(node);
    const activityTime = node.updatedAt || node.createdAt || null;
    if (activityTime && (!map[folder].lastActivity || activityTime > map[folder].lastActivity)) {
      map[folder].lastActivity = activityTime;
    }
  }
  for (const g of Object.values(map)) {
    g.totalCount = countTotal(g.sessions);
  }
  return Object.values(map);
}

function sortGroups(groups: FolderGroup[], mode: string): FolderGroup[] {
  const sorted = [...groups];
  if (mode === "recent") {
    sorted.sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
  } else if (mode === "created") {
    sorted.sort((a, b) => {
      const aEarliest = a.sessions.reduce((min: string | null, s) => {
        return s.createdAt && (!min || s.createdAt < min) ? s.createdAt : min;
      }, null);
      const bEarliest = b.sessions.reduce((min: string | null, s) => {
        return s.createdAt && (!min || s.createdAt < min) ? s.createdAt : min;
      }, null);
      return (aEarliest || "").localeCompare(bEarliest || "");
    });
  } else if (mode === "name_asc") {
    sorted.sort((a, b) => a.projectName.localeCompare(b.projectName));
  } else if (mode === "name_desc") {
    sorted.sort((a, b) => b.projectName.localeCompare(a.projectName));
  }
  return sorted;
}

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id;
}

function toggleChildren(id: string) {
  if (expandedChildren.value.has(id)) {
    expandedChildren.value.delete(id);
  } else {
    expandedChildren.value.add(id);
  }
  expandedChildren.value = new Set(expandedChildren.value);
}

async function deleteSession(id: string) {
  openMenuId.value = null;
  showConfirm(
    "Delete Session",
    `Are you sure you want to delete session "${id}"? This action cannot be undone.`,
    async () => {
      try {
        await apiDelete(`sessions/${encodeURIComponent(id)}/delete`);
        showToast("Session deleted", "success");
        await loadSessions();
      } catch (e) {
        showToast(`Delete failed: ${(e as Error).message}`, "error");
      }
    }
  );
}

function onSearch() {
  // reactive, triggers recompute
}

function clearSearch() {
  searchQuery.value = "";
  searchInputRef.value?.focus();
}

function onSortChange() {
  // reactive
}

async function loadSessions() {
  loading.value = true;
  error.value = "";
  try {
    tree.value = await api<TreeNode[]>("sessions/tree");
  } catch (e) {
    error.value = `Failed to load sessions: ${esc((e as Error).message)}`;
  } finally {
    loading.value = false;
  }
}

onMounted(loadSessions);

defineExpose({ loadSessions });
</script>

<style scoped>
.sessions-controls-bar {
  margin-top: 16px;
  margin-bottom: 16px;
}

.view-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.search-input-container {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: var(--text-tertiary);
  pointer-events: none;
  display: flex;
}

.search-input {
  padding: 8px 36px 8px 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-family: var(--font-family);
  font-size: 14px;
  width: 240px;
  outline: none;
  transition: border-color 0.1s;
}

.search-input:focus {
  border-color: var(--accent);
}

.search-clear {
  position: absolute;
  right: 4px;
  padding: 4px;
  border-radius: 2px;
  display: flex;
  align-items: center;
}

.search-clear:hover {
  background: var(--bg-hover);
}

.sort-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.sort-select {
  padding: 6px 32px 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-family: var(--font-family);
  font-size: 13px;
  outline: none;
  appearance: none;
  cursor: pointer;
  position: relative;
}

.sort-select::after {
  content: '';
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: center;
  color: var(--text-secondary);
  pointer-events: none;
}

.sort-select option {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.folder-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.folder-group {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.folder-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.folder-title {
  font-size: 14px;
  font-weight: 700;
}

.folder-path {
  font-size: 12px;
  color: var(--text-tertiary);
  flex: 1;
}

.folder-sessions {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-card {
  padding: 12px 16px;
}

.session-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.session-title-row {
  flex: 1;
  min-width: 0;
}

.session-card-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-title {
  font-size: 14px;
  font-weight: 700;
  word-break: break-word;
}

.session-id {
  font-size: 12px;
  color: var(--text-tertiary);
  word-break: break-all;
}

.session-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.session-card-actions {
  flex-shrink: 0;
  margin-left: 12px;
}

.session-card-more {
  position: relative;
}

.session-more-btn {
  padding: 4px 8px;
  border-radius: var(--radius);
  font-size: 16px;
  line-height: 1;
}

.session-more-btn:hover {
  background: var(--bg-hover);
}

.session-more-menu {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 200px;
  z-index: 50;
  padding: 4px;
}

.session-more-menu .dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius);
  text-align: left;
}

.session-more-menu .dropdown-item:hover {
  background: var(--bg-hover);
}

.session-more-menu .dropdown-item.danger {
  color: var(--danger);
}

.subsession-arrow {
  transition: transform 0.2s ease;
}

.subsession-arrow.rotated {
  transform: rotate(180deg);
}

.children-container {
  margin-left: 24px;
  margin-top: 4px;
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.child-card {
  padding: 10px 14px;
}
</style>
