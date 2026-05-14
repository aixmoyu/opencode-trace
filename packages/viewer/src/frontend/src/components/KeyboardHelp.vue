<template>
  <Teleport to="body">
    <div
      class="keyboard-help-overlay"
      aria-modal="true"
      role="dialog"
      aria-labelledby="keyboard-help-title"
      @click.self="$emit('close')"
      @keydown.escape="$emit('close')"
    >
      <div class="keyboard-help">
        <h3 id="keyboard-help-title">Keyboard Shortcuts</h3>
        <div class="shortcut-list">
          <div class="shortcut"><kbd>/</kbd> Focus search</div>
          <div class="shortcut"><kbd>E</kbd> Export session (on session view)</div>
          <div class="shortcut"><kbd>?</kbd> Show this help</div>
          <div class="shortcut"><kbd>Esc</kbd> Close dialogs</div>
        </div>
        <button class="help-close" ref="closeBtnRef" @click="$emit('close')">Close</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";

defineEmits<{
  close: [];
}>();

const closeBtnRef = ref<HTMLButtonElement | null>(null);

onMounted(() => {
  closeBtnRef.value?.focus();
});
</script>

<style scoped>
.keyboard-help-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}

.keyboard-help {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
  max-width: 380px;
  width: 90%;
}

.keyboard-help h3 {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 16px;
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-secondary);
}

.help-close {
  width: 100%;
  padding: 8px 20px;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 500;
  background: var(--bg-tertiary);
  transition: background 0.1s;
}

.help-close:hover {
  background: var(--bg-hover);
}
</style>
