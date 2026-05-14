<template>
  <Teleport to="body">
    <div
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      @click.self="$emit('close')"
      @keydown.escape="$emit('close')"
    >
      <div class="modal-content">
        <div class="modal-header">
          <h3 id="import-modal-title">Import Session</h3>
          <button class="modal-close" aria-label="Close import modal" @click="$emit('close')">&times;</button>
        </div>
        <div class="modal-body">
          <label class="file-label">
            <span class="file-label-text">Select ZIP file:</span>
            <div class="file-input-wrapper">
              <input type="file" accept=".zip" aria-label="Select ZIP file to import" @change="handleFile" class="file-input-native" />
              <span class="file-input-button">Choose File</span>
            </div>
          </label>
          <div class="import-status">
            <div v-if="uploading" class="loading"><div class="spinner"></div> Uploading...</div>
            <div v-else-if="statusMessage" :class="['status-msg', statusType]">{{ statusMessage }}</div>
          </div>
          <div v-if="conflicts.length > 0" class="conflict-panel">
            <h4>Session Conflicts Detected</h4>
            <div class="conflict-list">
              <div v-for="c in conflicts" :key="c.id" class="conflict-item">
                <span class="conflict-id">{{ c.id }}</span>
                <span class="conflict-title">{{ c.title || '' }}</span>
              </div>
            </div>
            <div class="conflict-actions">
              <button class="action-rename" @click="resolveConflicts('rename')">Rename All</button>
              <button class="action-skip" @click="resolveConflicts('skip')">Skip All</button>
              <button class="action-cancel" @click="$emit('close')">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { esc } from "../utils/format";

const emit = defineEmits<{
  close: [];
  imported: [];
}>();

interface Conflict {
  id: string;
  title?: string;
}

const uploading = ref(false);
const statusMessage = ref("");
const statusType = ref<"success" | "error" | "warning">("success");
const conflicts = ref<Conflict[]>([]);
let pendingFile: File | null = null;

async function handleFile(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  pendingFile = file;
  uploading.value = true;
  statusMessage.value = "";
  conflicts.value = [];

  try {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/sessions/import", { method: "POST", body: formData });
    const result = await res.json();

    if (result.conflicts && result.conflicts.length > 0) {
      conflicts.value = result.conflicts;
      statusMessage.value = `${result.conflicts.length} session(s) already exist.`;
      statusType.value = "warning";
    } else if (result.imported) {
      statusMessage.value = `Imported ${result.imported} session(s)!`;
      statusType.value = "success";
      setTimeout(() => emit("imported"), 1500);
    } else {
      statusMessage.value = `Import failed: ${esc(result.error || "Unknown error")}`;
      statusType.value = "error";
    }
  } catch (e) {
    statusMessage.value = `Import failed: ${esc((e as Error).message)}`;
    statusType.value = "error";
  } finally {
    uploading.value = false;
  }
}

async function resolveConflicts(action: string) {
  if (!pendingFile) return;

  uploading.value = true;
  statusMessage.value = "";

  try {
    const formData = new FormData();
    formData.append("file", pendingFile);
    formData.append("conflictStrategy", action);

    const res = await fetch("/api/sessions/import", { method: "POST", body: formData });
    const result = await res.json();

    if (result.imported) {
      conflicts.value = [];
      statusMessage.value = `Imported ${result.imported} session(s)!`;
      statusType.value = "success";
      setTimeout(() => emit("imported"), 1500);
    } else {
      statusMessage.value = `Import failed: ${esc(result.error || "Unknown error")}`;
      statusType.value = "error";
    }
  } catch (e) {
    statusMessage.value = `Import failed: ${esc((e as Error).message)}`;
    statusType.value = "error";
  } finally {
    uploading.value = false;
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}

.modal-content {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  max-width: 480px;
  width: 90%;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.modal-header h3 {
  font-size: 16px;
  font-weight: 700;
}

.modal-close {
  font-size: 20px;
  padding: 4px 8px;
  border-radius: var(--radius);
}

.modal-close:hover {
  background: var(--bg-hover);
}

.modal-body {
  padding: 20px;
}

.file-label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.file-label-text {
  font-size: 14px;
  font-weight: 500;
}

.file-input-wrapper {
  position: relative;
  display: inline-block;
}

.file-input-native {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.file-input-button {
  display: inline-block;
  padding: 10px 18px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s;
  border: 1px solid var(--border);
}

.file-input-button:hover {
  background: var(--bg-hover);
}

.file-input-native:focus-visible + .file-input-button {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.import-status {
  min-height: 24px;
}

.status-msg {
  font-size: 14px;
  padding: 8px 12px;
  border-radius: var(--radius);
}

.status-msg.success {
  background: rgba(48, 209, 88, 0.12);
  color: var(--success);
}

.status-msg.error {
  background: rgba(255, 59, 48, 0.12);
  color: var(--danger);
}

.status-msg.warning {
  background: rgba(255, 159, 10, 0.12);
  color: var(--warning);
}

.conflict-panel {
  margin-top: 16px;
}

.conflict-panel h4 {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
}

.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.conflict-item {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
  font-size: 13px;
}

.conflict-id {
  font-weight: 500;
  color: var(--text-primary);
}

.conflict-title {
  color: var(--text-secondary);
}

.conflict-actions {
  display: flex;
  gap: 8px;
}

.conflict-actions button {
  padding: 6px 14px;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 500;
}

.action-rename {
  background: var(--accent);
  color: var(--oc-light);
}

.action-rename:hover {
  background: var(--accent-hover);
}

.action-skip {
  background: var(--bg-tertiary);
}

.action-skip:hover {
  background: var(--bg-hover);
}

.action-cancel {
  background: var(--bg-tertiary);
}

.action-cancel:hover {
  background: var(--bg-hover);
}
</style>
