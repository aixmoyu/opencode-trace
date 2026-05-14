<template>
  <div class="container">
    <div v-if="loading" class="loading"><div class="spinner"></div>Loading record...</div>

    <template v-else-if="error">
      <div class="error-banner">{{ error }}</div>
    </template>

    <template v-else>
      <div class="page-title">
        {{ displayTitle }}
        <span v-if="displaySubtitle" class="subtitle">{{ displaySubtitle }}</span>
        <span class="count">#{{ recordId }}</span>
      </div>

      <MetadataCard title="Record Metadata" :sections="metadataSections">
        <template v-if="changeData?.delta" #before-sections>
          <div class="stat-section">
            <div class="stat-section-title">Changes</div>
            <div class="stat-row-inline">
              <ChangeSummary :change="changeData" />
            </div>
          </div>
        </template>
      </MetadataCard>

      <div class="view-toggle">
        <button :class="{ active: viewMode === 'changes' }" @click="viewMode = 'changes'">Changes</button>
        <button :class="{ active: viewMode === 'conversation' }" @click="viewMode = 'conversation'">Conversation</button>
        <button :class="{ active: viewMode === 'request' }" @click="viewMode = 'request'">Request</button>
        <button :class="{ active: viewMode === 'response' }" @click="viewMode = 'response'">Response</button>
      </div>

      <div class="record-view-content">
        <template v-if="viewMode === 'changes'">
          <ChangesView :change-data="changeData" />
        </template>

        <template v-else-if="viewMode === 'conversation'">
          <ConversationView :parsed="parsed" />
        </template>

        <template v-else-if="viewMode === 'request'">
          <RequestView :record="record" />
        </template>

        <template v-else-if="viewMode === 'response'">
          <ResponseView :record="record" />
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../composables/useApi";
import { esc, formatTime, formatNumber, formatLatency, formatDuration } from "../utils/format";
import ChangeSummary from "../components/ChangeSummary.vue";
import MetadataCard from "../components/MetadataCard.vue";
import ChangesView from "../components/ChangesView.vue";
import ConversationView from "../components/ConversationView.vue";
import RequestView from "../components/RequestView.vue";
import ResponseView from "../components/ResponseView.vue";

const props = defineProps<{
  sessionId: string;
  recordId: string;
}>();

interface RecordData {
  id: number;
  requestAt?: string;
  responseAt?: string;
  requestSentAt?: number;
  firstTokenAt?: number;
  lastTokenAt?: number;
  request?: { url?: string; method?: string };
  response?: { status?: number; headers?: unknown; body?: unknown };
  provider?: string;
}

interface ParsedData {
  provider?: string;
  model?: string;
  usage?: {
    inputMissTokens?: number;
    inputHitTokens?: number;
    outputTokens?: number;
  };
  sys?: { blocks: Block[] };
  tool?: { blocks: Block[] };
  msgs?: Message[];
}

interface Block {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  description?: string;
  parameters?: unknown;
  arguments?: string;
  toolCallId?: string;
  content?: string;
  data?: unknown;
}

interface Message {
  role: string;
  blocks?: Block[];
}

interface ChangeData {
  requestId: number;
  isUserCall?: boolean;
  interRequestDuration?: number;
  delta?: unknown;
}

interface TimelineData {
  changes?: ChangeData[];
}

const loading = ref(true);
const error = ref("");
const record = ref<RecordData>({} as RecordData);
const parsed = ref<ParsedData>({});
const changeData = ref<ChangeData | null>(null);
const session = ref<{ title?: string }>({});
const viewMode = ref<"changes" | "conversation" | "request" | "response">("changes");

const displayTitle = computed(() => session.value.title || props.sessionId);
const displaySubtitle = computed(() => session.value.title ? props.sessionId : "");

const isStream = computed(() => record.value.requestSentAt != null && record.value.firstTokenAt != null);

const isUserCall = computed(() => changeData.value?.isUserCall ?? false);

const interDuration = computed(() => changeData.value?.interRequestDuration ?? null);

const execDuration = computed(() => {
  if (!record.value.requestAt || !record.value.responseAt) return "-";
  const diff = new Date(record.value.responseAt).getTime() - new Date(record.value.requestAt).getTime();
  return formatDuration(diff);
});

const totalTokens = computed(() => {
  const usage = parsed.value.usage;
  if (!usage) return 0;
  return (usage.inputMissTokens || 0) + (usage.inputHitTokens || 0) + (usage.outputTokens || 0);
});

const hitRate = computed(() => {
  const usage = parsed.value.usage;
  if (!usage) return "0%";
  const totalInput = (usage.inputMissTokens || 0) + (usage.inputHitTokens || 0);
  if (totalInput === 0) return "0%";
  return `${((usage.inputHitTokens || 0) / totalInput * 100).toFixed(1)}%`;
});

const latency = computed(() => {
  const r = record.value;
  if (r.requestSentAt == null || r.firstTokenAt == null || r.lastTokenAt == null) return null;
  const ttft = r.firstTokenAt - r.requestSentAt;
  let tpot: number | null = null;
  const usage = parsed.value.usage;
  if (usage && usage.outputTokens && usage.outputTokens > 0) {
    tpot = (r.lastTokenAt - r.firstTokenAt) / usage.outputTokens;
  }
  return { ttft, tpot };
});

const metadataSections = computed(() => {
  const sections: any[] = [];

  const requestItems: any[] = [
    { key: "URL", value: record.value.request?.url || "" },
    { key: "Method", value: record.value.request?.method || "GET" },
  ];

  if (record.value.response?.status != null) {
    requestItems.push({ key: "Status", value: String(record.value.response.status) });
  }

  requestItems.push({ key: "SSE", value: isStream.value ? "true" : "false" });

  if (parsed.value.model) {
    requestItems.push({ key: "Model", value: parsed.value.model });
  }

  if (parsed.value.provider) {
    requestItems.push({ key: "Provider", value: parsed.value.provider });
  }

  requestItems.push({ key: "Type", value: isUserCall.value ? "USER" : "AGENT" });

  sections.push({
    title: "Request",
    layout: "inline",
    items: requestItems,
  });

  if (parsed.value.usage) {
    sections.push({
      title: "Token Usage",
      layout: "inline",
      items: [
        { key: "Input (miss)", value: formatNumber(parsed.value.usage.inputMissTokens || 0) },
        { key: "Input (hit)", value: formatNumber(parsed.value.usage.inputHitTokens || 0) },
        { key: "Output", value: formatNumber(parsed.value.usage.outputTokens || 0) },
        { key: "Total", value: formatNumber(totalTokens.value), modifier: "highlight" },
        { key: "Hit Rate", value: hitRate.value },
      ],
    });
  }

  const timeItems: any[] = [
    { key: "Request", value: formatTime(record.value.requestAt) },
    { key: "Response", value: formatTime(record.value.responseAt) },
  ];

  if (interDuration.value != null) {
    timeItems.push({ key: "Gap", value: formatDuration(interDuration.value) });
  }

  timeItems.push({ key: "Duration", value: execDuration.value });

  if (latency.value) {
    timeItems.push({ key: "TTFT", value: formatLatency(latency.value.ttft) });
    if (latency.value.tpot != null) {
      timeItems.push({ key: "TPOT", value: formatLatency(latency.value.tpot) });
    }
  }

  sections.push({
    title: "Time Usage",
    layout: "inline",
    items: timeItems,
  });

  return sections;
});

async function loadRecord() {
  loading.value = true;
  error.value = "";
  try {
    const [rec, prs, tl, sess] = await Promise.all([
      api<RecordData>(`sessions/${encodeURIComponent(props.sessionId)}/records/${props.recordId}`),
      api<ParsedData>(`sessions/${encodeURIComponent(props.sessionId)}/records/${props.recordId}/parsed`),
      api<TimelineData>(`sessions/${encodeURIComponent(props.sessionId)}/timeline`),
      api<{ session?: { title?: string } }>(`sessions/${encodeURIComponent(props.sessionId)}`),
    ]);

    record.value = rec;
    parsed.value = prs;
    session.value = sess.session || {};

    const changes = tl.changes || [];
    changeData.value = changes.find((c) => c.requestId === rec.id) || null;
  } catch (e) {
    error.value = `Failed to load record: ${esc((e as Error).message)}`;
  } finally {
    loading.value = false;
  }
}

onMounted(loadRecord);
</script>

<style scoped>
.view-toggle {
  display: flex;
  gap: 4px;
  margin-top: 16px;
  margin-bottom: 16px;
  padding: 4px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
  width: fit-content;
}

.view-toggle button {
  padding: 6px 16px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: background 0.1s, color 0.1s;
}

.view-toggle button:hover {
  color: var(--text-primary);
}

.view-toggle button.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-weight: 700;
}

.record-view-content {
  margin-top: 8px;
}
</style>
