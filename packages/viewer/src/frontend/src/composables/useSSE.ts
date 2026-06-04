import { ref, onMounted, onUnmounted, type Ref } from "vue";

export interface SSEEvent {
  type: string;
  data: unknown;
}

/**
 * EventSource composable that connects to the viewer's SSE endpoint.
 * Exposes a reactive `refreshKey` that increments on each event,
 * allowing views to trigger re-fetches by watching it.
 */
export function useSSE(): {
  refreshKey: Ref<number>;
  lastEvent: Ref<SSEEvent | null>;
  connected: Ref<boolean>;
} {
  const refreshKey = ref(0);
  const lastEvent = ref<SSEEvent | null>(null);
  const connected = ref(false);
  let eventSource: EventSource | null = null;

  function increment() {
    refreshKey.value++;
  }

  onMounted(() => {
    try {
      eventSource = new EventSource("/api/events");

      eventSource.onopen = () => {
        connected.value = true;
      };

      eventSource.onerror = () => {
        connected.value = false;
      };

      // Record events — session list refresh
      eventSource.addEventListener("record:added", (e) => {
        try {
          lastEvent.value = { type: "record:added", data: JSON.parse(e.data) };
        } catch {
          lastEvent.value = { type: "record:added", data: e.data };
        }
        increment();
      });
      eventSource.addEventListener("record:deleted", () => increment());
      eventSource.addEventListener("record:updated", () => increment());

      // Session events — session list refresh
      eventSource.addEventListener("session:created", () => increment());
      eventSource.addEventListener("session:deleted", () => increment());

      // Connected event
      eventSource.addEventListener("connected", (e) => {
        connected.value = true;
        lastEvent.value = { type: "connected", data: e.data };
      });
    } catch {
      // SSE not available — views will work without real-time updates
      connected.value = false;
    }
  });

  onUnmounted(() => {
    eventSource?.close();
    eventSource = null;
    connected.value = false;
  });

  return { refreshKey, lastEvent, connected };
}
