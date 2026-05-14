<template>
  <Teleport to="body">
    <div class="toast-container" v-if="toasts.length > 0">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        :class="['toast', toast.type]"
      >
        <span>{{ toast.message }}</span>
        <button
          v-if="toast.actionLabel"
          class="toast-action"
          @click="toast.onAction?.(); removeToast(toast.id)"
        >
          {{ toast.actionLabel }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast } from "../composables/useToast";

const { toasts, removeToast } = useToast();
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  pointer-events: auto;
  animation: toast-in 0.2s ease-out;
  border: 1px solid;
}

.toast.success {
  background: rgba(48, 209, 88, 0.12);
  border-color: var(--success);
  color: var(--success);
}

.toast.error {
  background: rgba(255, 59, 48, 0.12);
  border-color: var(--danger);
  color: var(--danger);
}

.toast.info {
  background: var(--bg-secondary);
  border-color: var(--border);
  color: var(--text-primary);
}

.toast.warning {
  background: rgba(255, 159, 10, 0.12);
  border-color: var(--warning);
  color: var(--warning);
}

.toast-action {
  padding: 4px 10px;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 700;
  background: var(--bg-tertiary);
  white-space: nowrap;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
