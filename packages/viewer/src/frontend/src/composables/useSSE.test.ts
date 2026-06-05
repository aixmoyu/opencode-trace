import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useSSE } from "./useSSE";

interface FakeEventSource {
  url: string;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  listeners: Map<string, Set<(e: Event) => void>>;
  closed: boolean;
  close: () => void;
}

let instances: FakeEventSource[] = [];

class MockEventSource {
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  listeners = new Map<string, Set<(e: Event) => void>>();
  closed = false;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    instances.push(this as unknown as FakeEventSource);
  }

  addEventListener(type: string, listener: (e: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(_event: Event): boolean {
    return true;
  }

  close() {
    this.closed = true;
  }
}

function fire(es: FakeEventSource, type: string, data?: string) {
  const set = es.listeners.get(type);
  if (!set) return;
  for (const l of set) {
    l(data !== undefined ? new MessageEvent(type, { data }) : new Event(type));
  }
}

function captureHarness() {
  let harness!: {
    refreshKey: Ref<number>;
    lastEvent: Ref<unknown>;
    connected: Ref<boolean>;
  };
  const Comp = defineComponent({
    setup() {
      harness = useSSE();
      return () => h("div");
    },
  });
  const wrapper = mount(Comp);
  return { harness, wrapper };
}

describe("useSSE", () => {
  beforeEach(() => {
    instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an EventSource on mount to /api/events", () => {
    const { wrapper } = captureHarness();
    expect(instances).toHaveLength(1);
    expect(instances[0].url).toBe("/api/events");
    wrapper.unmount();
  });

  it("closes the EventSource and resets connected on unmount", () => {
    const { harness, wrapper } = captureHarness();
    // open first
    instances[0].onopen?.(new Event("open"));
    expect(harness.connected.value).toBe(true);
    wrapper.unmount();
    expect(instances[0].closed).toBe(true);
    expect(harness.connected.value).toBe(false);
  });

  it("sets connected=true on open event and =false on error", () => {
    const { harness } = captureHarness();
    const es = instances[0];
    es.onopen?.(new Event("open"));
    expect(harness.connected.value).toBe(true);
    es.onerror?.(new Event("error"));
    expect(harness.connected.value).toBe(false);
  });

  it("increments refreshKey on record:added and parses data JSON", async () => {
    const { harness } = captureHarness();
    const es = instances[0];
    expect(harness.refreshKey.value).toBe(0);
    fire(es, "record:added", JSON.stringify({ id: 7, n: 1 }));
    expect(harness.refreshKey.value).toBe(1);
    const ev = harness.lastEvent.value as { type: string; data: unknown } | null;
    expect(ev?.type).toBe("record:added");
    expect(ev?.data).toEqual({ id: 7, n: 1 });
  });

  it("falls back to raw data when record:added payload is not valid JSON", () => {
    const { harness } = captureHarness();
    const es = instances[0];
    fire(es, "record:added", "not-json");
    const ev = harness.lastEvent.value as { type: string; data: unknown } | null;
    expect(ev?.data).toBe("not-json");
  });

  it("increments refreshKey for record:deleted, record:updated, session:created, session:deleted", () => {
    const { harness } = captureHarness();
    const es = instances[0];
    fire(es, "record:deleted");
    fire(es, "record:updated");
    fire(es, "session:created");
    fire(es, "session:deleted");
    expect(harness.refreshKey.value).toBe(4);
  });

  it("handles 'connected' event payload and marks connected=true", () => {
    const { harness } = captureHarness();
    const es = instances[0];
    fire(es, "connected", "hello");
    expect(harness.connected.value).toBe(true);
    const ev = harness.lastEvent.value as { type: string; data: unknown } | null;
    expect(ev?.type).toBe("connected");
    expect(ev?.data).toBe("hello");
  });

  it("survives EventSource throwing on construction (e.g. SSR / disabled)", async () => {
    vi.stubGlobal(
      "EventSource",
      class {
        constructor() {
          throw new Error("not available");
        }
      },
    );
    const { harness, wrapper } = captureHarness();
    expect(harness.connected.value).toBe(false);
    wrapper.unmount();
  });

  it("simulates a reconnection by closing then opening a new EventSource", async () => {
    const { harness, wrapper } = captureHarness();
    const first = instances[0];
    first.onopen?.(new Event("open"));
    expect(harness.connected.value).toBe(true);
    first.onerror?.(new Event("error"));
    expect(harness.connected.value).toBe(false);
    wrapper.unmount();
    // A second consumer opens a fresh EventSource
    const second = captureHarness();
    expect(instances).toHaveLength(2);
    instances[1].onopen?.(new Event("open"));
    expect(second.harness.connected.value).toBe(true);
    second.wrapper.unmount();
  });
});
