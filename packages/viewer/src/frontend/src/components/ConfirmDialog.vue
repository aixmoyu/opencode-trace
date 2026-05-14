<template>
  <Teleport to="body">
    <div
      class="confirm-overlay"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="messageId"
      @keydown="onKeydown"
    >
      <div class="confirm-dialog">
        <div :id="titleId" class="confirm-title">{{ title }}</div>
        <div :id="messageId" class="confirm-message">{{ message }}</div>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" ref="cancelBtnRef" @click="$emit('cancel')">Cancel</button>
          <button class="confirm-btn danger" @click="$emit('confirm')">Delete</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";

defineProps<{
  title: string;
  message: string;
}>();

defineEmits<{
  confirm: [];
  cancel: [];
}>();

const titleId = "confirm-title";
const messageId = "confirm-message";
const cancelBtnRef = ref<HTMLButtonElement | null>(null);

onMounted(() => {
  cancelBtnRef.value?.focus();
});

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    // handled by useKeyboard in parent
  }
}
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}

.confirm-dialog {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  max-width: 420px;
  width: 90%;
}

.confirm-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 8px;
}

.confirm-message {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 20px;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.confirm-btn {
  padding: 8px 20px;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  transition: background 0.1s;
}

.confirm-btn.cancel {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.confirm-btn.cancel:hover {
  background: var(--bg-hover);
}

.confirm-btn.danger {
  background: var(--danger);
  color: var(--oc-light);
}

.confirm-btn.danger:hover {
  background: var(--danger-hover);
}
</style>
