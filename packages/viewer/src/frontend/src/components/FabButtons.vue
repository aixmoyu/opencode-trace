<template>
  <div class="fab-container">
    <button class="fab-scroll" @click="scrollToTop" aria-label="Scroll to top">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
    <button class="fab-scroll" @click="scrollToBottom" aria-label="Scroll to bottom">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
function scrollToTop() {
  const main = document.querySelector("main");
  main?.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToBottom() {
  const main = document.querySelector("main");
  if (main) {
    main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
  }
}
</script>

<style scoped>
.fab-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 50;
}

.fab-scroll {
  width: 40px;
  height: 40px;
  border-radius: var(--radius);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
}

.fab-scroll:hover {
  background: var(--bg-hover);
}
</style>
