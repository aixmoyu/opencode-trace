<template>
  <div class="container">
    <div v-if="loading" class="loading"><div class="spinner"></div>Loading timeline...</div>

    <template v-else-if="error">
      <div class="error-banner">{{ error }}</div>
    </template>

    <template v-else>
      <div class="page-title">
        {{ displayTitle }}
        <span v-if="displaySubtitle" class="subtitle">{{ displaySubtitle }}</span>
        <span class="count">{{ records.length }} requests</span>
      </div>

      <MetadataCard v-if="metadata" title="Session Statistics" :sections="metadataSections" />

      <div class="timeline-controls">
        <label class="sort-label">
          <span class="sort-label-text">Sort:</span>
          <select class="sort-select" aria-label="Sort timeline" v-model="sortMode">
            <option value="time_asc">Time (oldest)</option>
            <option value="time_desc">Time (newest)</option>
            <option value="duration_asc">Duration (shortest)</option>
            <option value="duration_desc">Duration (longest)</option>
            <option value="gap_asc">Gap (shortest)</option>
            <option value="gap_desc">Gap (longest)</option>
          </select>
        </label>
      </div>

      <div class="timeline">
        <div v-for="rec in sortedRecords" :key="rec.id" class="timeline-item">
          <div
            class="timeline-card card card-interactive"
            tabindex="0"
            role="button"
            :aria-label="`View request #${rec.id} details`"
            @click="router.push(`/session/${sessionId}/record/${rec.id}`)"
            @keydown.enter="router.push(`/session/${sessionId}/record/${rec.id}`)"
          >
            <div class="timeline-card-header">
              <div class="left">
                <span class="req-num">#{{ rec.id }}</span>
                <span :class="['call-type', getCallType(rec.id)]" :title="getCallTypeTitle(rec.id)">
                  {{ getCallTypeLabel(rec.id) }}
                </span>
                <span class="url">{{ getUrlHost(rec) }}</span>
                <ChangeSummary v-if="getChange(rec.id)" :change="getChange(rec.id)" />
              </div>
              <div class="right">
                <span v-if="getInterDuration(rec.id) != null" class="time-badge gap">gap {{ formatDuration(getInterDuration(rec.id)!) }}</span>
                <span class="time-badge dur">dur {{ formatExecDuration(rec) }}</span>
                <span v-if="getModel(rec.id)" class="time-badge model">{{ getModel(rec.id) }}</span>
                <span v-if="rec.provider" class="time-badge provider">{{ rec.provider }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../composables/useApi";
import { esc, formatNumber, formatLatency, formatDuration } from "../utils/format";
import ChangeSummary from "../components/ChangeSummary.vue";
import MetadataCard from "../components/MetadataCard.vue";

const props = defineProps<{
  sessionId: string;
}>();

const router = useRouter();

interface Record {
  id: number;
  requestAt?: string;
  responseAt?: string;
  request?: { url?: string; method?: string };
  provider?: string;
  purpose?: string;
}

interface Change {
  requestId: number;
  isUserCall?: boolean;
  interRequestDuration?: number;
  delta?: unknown;
}

interface RecordMeta {
  id: number;
  model?: string;
}

interface TimelineData {
  changes?: Change[];
  recordMeta?: RecordMeta[];
}

interface Metadata {
  tokenUsage?: {
    inputMissTokens: number;
    inputHitTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheHitRate?: number;
  };
  durationStats?: {
    wallTime: number;
    totalRequestDuration: number;
  };
  latencyStats?: {
    streamRequestCount: number;
    avgTTFT: number;
    maxTTFT: number;
    avgTPOT: number;
    maxTPOT: number;
  };
  subSessions?: string[];
  parentSession?: string;
}

const loading = ref(true);
const error = ref("");
const records = ref<Record[]>([]);
const timeline = ref<TimelineData>({});
const metadata = ref<Metadata | null>(null);
const session = ref<{ title?: string }>({});
const sortMode = ref("time_asc");

const displayTitle = computed(() => session.value.title || props.sessionId);
const displaySubtitle = computed(() => session.value.title ? props.sessionId : "");

const cacheHitRate = computed(() => {
  const rate = metadata.value?.tokenUsage?.cacheHitRate;
  return rate != null ? `${(rate * 100).toFixed(1)}%` : "0%";
});

const userCount = computed(() => {
  const changes = timeline.value.changes || [];
  return changes.filter((c) => c.isUserCall).length;
});

const agentCount = computed(() => {
  const changes = timeline.value.changes || [];
  return changes.filter((c) => !c.isUserCall).length;
});

const metadataSections = computed(() => {
  if (!metadata.value) return [];

  const sections: any[] = [];

  if (metadata.value.tokenUsage) {
    sections.push({
      title: "Token Usage",
      layout: "inline",
      items: [
        { key: "Input (miss)", value: formatNumber(metadata.value.tokenUsage.inputMissTokens) },
        { key: "Input (hit)", value: formatNumber(metadata.value.tokenUsage.inputHitTokens) },
        { key: "Output", value: formatNumber(metadata.value.tokenUsage.outputTokens) },
        { key: "Total", value: formatNumber(metadata.value.tokenUsage.totalTokens), modifier: "highlight" },
        { key: "Hit Rate", value: cacheHitRate.value },
      ],
    });
  }

  if (metadata.value.durationStats) {
    const timeItems: any[] = [
      { key: "Wall Time", value: formatDuration(metadata.value.durationStats.wallTime) },
      { key: "Request Time", value: formatDuration(metadata.value.durationStats.totalRequestDuration) },
    ];

    if (metadata.value.latencyStats && metadata.value.latencyStats.streamRequestCount > 0) {
      timeItems.push(
        { key: "TTFT", value: `${formatLatency(metadata.value.latencyStats.avgTTFT)} / ${formatLatency(metadata.value.latencyStats.maxTTFT)}` },
        { key: "TPOT", value: `${formatLatency(metadata.value.latencyStats.avgTPOT)} / ${formatLatency(metadata.value.latencyStats.maxTPOT)}` }
      );
    }

    sections.push({
      title: "Time Usage",
      layout: "inline",
      items: timeItems,
    });
  }

  sections.push({
    title: "Requests",
    layout: "inline",
    items: [
      { key: "User", value: formatNumber(userCount.value) },
      { key: "Agent", value: formatNumber(agentCount.value) },
      { key: "Total", value: formatNumber(userCount.value + agentCount.value), modifier: "highlight" },
    ],
  });

  if (metadata.value.subSessions && metadata.value.subSessions.length > 0) {
    sections.push({
      title: "Sub Sessions",
      layout: "inline",
      items: metadata.value.subSessions.map((id) => ({
        key: "Session",
        value: id,
        link: `/session/${id}`,
      })),
    });
  }

  if (metadata.value.parentSession) {
    sections.push({
      title: "Parent Session",
      layout: "inline",
      items: [
        { key: "Session", value: metadata.value.parentSession, link: `/session/${metadata.value.parentSession}` },
      ],
    });
  }

  return sections;
});

const sortedRecords = computed(() => {
  const recs = [...records.value];
  const changes = timeline.value.changes || [];

  if (sortMode.value === "time_asc") {
    recs.sort((a, b) => a.id - b.id);
  } else if (sortMode.value === "time_desc") {
    recs.sort((a, b) => b.id - a.id);
  } else if (sortMode.value === "duration_asc" || sortMode.value === "duration_desc") {
    recs.sort((a, b) => {
      const aDur = getRecordDuration(a);
      const bDur = getRecordDuration(b);
      return sortMode.value === "duration_asc" ? aDur - bDur : bDur - aDur;
    });
  } else if (sortMode.value === "gap_asc" || sortMode.value === "gap_desc") {
    recs.sort((a, b) => {
      const aGap = getRecordGap(a, changes);
      const bGap = getRecordGap(b, changes);
      if (aGap === null && bGap === null) return 0;
      if (aGap === null) return 1;
      if (bGap === null) return -1;
      return sortMode.value === "gap_asc" ? aGap - bGap : bGap - aGap;
    });
  }

  return recs;
});

function getRecordDuration(rec: Record): number {
  if (!rec.requestAt || !rec.responseAt) return 0;
  return new Date(rec.responseAt).getTime() - new Date(rec.requestAt).getTime();
}

function getRecordGap(rec: Record, changes: Change[]): number | null {
  const change = changes.find((c) => c.requestId === rec.id);
  return change?.interRequestDuration ?? null;
}

function formatExecDuration(rec: Record): string {
  return formatDuration(getRecordDuration(rec));
}

function getChange(recordId: number): Change | null {
  const changes = timeline.value.changes || [];
  return changes.find((c) => c.requestId === recordId) || null;
}

function getInterDuration(recordId: number): number | null {
  return getChange(recordId)?.interRequestDuration ?? null;
}

function getModel(recordId: number): string | null {
  const meta = (timeline.value.recordMeta || []).find((m) => m.id === recordId);
  return meta?.model || null;
}

function getCallType(recordId: number): string {
  const change = getChange(recordId);
  return change?.isUserCall ? "user" : "agent";
}

function getCallTypeLabel(recordId: number): string {
  const change = getChange(recordId);
  return change?.isUserCall ? "USER" : "AGENT";
}

function getCallTypeTitle(recordId: number): string {
  const change = getChange(recordId);
  return change?.isUserCall ? "Direct human request" : "AI automatic continuation";
}

function getUrlHost(rec: Record): string {
  try {
    return rec.request?.url ? new URL(rec.request.url).host : (rec.request?.url || "");
  } catch {
    return rec.request?.url || "";
  }
}

async function loadTimeline() {
  loading.value = true;
  error.value = "";
  try {
    const [data, tl, meta] = await Promise.all([
      api<any>(`sessions/${encodeURIComponent(props.sessionId)}`),
      api<TimelineData>(`sessions/${encodeURIComponent(props.sessionId)}/timeline`),
      api<Metadata>(`sessions/${encodeURIComponent(props.sessionId)}/metadata`),
    ]);
    records.value = data.records || [];
    timeline.value = tl;
    metadata.value = meta;
    session.value = data.session || {};
  } catch (e) {
    error.value = `Failed to load session: ${esc((e as Error).message)}`;
  } finally {
    loading.value = false;
  }
}

onMounted(loadTimeline);
</script>

<style scoped>
.timeline-controls {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  margin-bottom: 16px;
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

.timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timeline-item {
  margin-bottom: 4px;
}

.timeline-card {
  padding: 12px 16px;
}

.timeline-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.timeline-card-header .left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.timeline-card-header .right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.req-num {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary);
}

.call-type {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 2px;
}

.call-type.user {
  background: rgba(61, 139, 255, 0.15);
  color: var(--accent);
}

.call-type.agent {
  background: rgba(139, 92, 246, 0.15);
  color: var(--sys-color);
}

.url {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.time-badge {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius);
  white-space: nowrap;
}

.time-badge.dur {
  background: rgba(61, 139, 255, 0.1);
  color: var(--accent);
}

.time-badge.gap {
  background: rgba(255, 159, 10, 0.1);
  color: var(--warning);
}

.time-badge.model {
  background: rgba(48, 209, 88, 0.1);
  color: var(--success);
}

.time-badge.provider {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
</style>
