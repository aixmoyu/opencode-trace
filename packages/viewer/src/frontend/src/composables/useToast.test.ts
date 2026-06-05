import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useToast, toastState } from "./useToast";

function withSetup<T>(fn: () => T): { result: T; unmount: () => void } {
  let captured: T | undefined;
  const Comp = defineComponent({
    setup() {
      captured = fn();
      return () => h("div");
    },
  });
  const wrapper = mount(Comp);
  return {
    result: captured as T,
    unmount: () => wrapper.unmount(),
  };
}

describe("useToast", () => {
  beforeEach(() => {
    // Reset shared module state between tests
    toastState.value = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes toasts ref, showToast and removeToast", () => {
    const { result } = withSetup(() => useToast());
    expect(result.toasts).toBeDefined();
    expect(typeof result.showToast).toBe("function");
    expect(typeof result.removeToast).toBe("function");
  });

  it("showToast appends a toast with default type 'info'", () => {
    const { result } = withSetup(() => useToast());
    result.showToast("hi");
    expect(result.toasts.value).toHaveLength(1);
    expect(result.toasts.value[0].message).toBe("hi");
    expect(result.toasts.value[0].type).toBe("info");
    expect(typeof result.toasts.value[0].id).toBe("number");
  });

  it("showToast respects the explicit type", () => {
    const { result } = withSetup(() => useToast());
    result.showToast("oops", "error");
    expect(result.toasts.value[0].type).toBe("error");
  });

  it("supports multiple simultaneous toasts with unique ids", () => {
    const { result } = withSetup(() => useToast());
    result.showToast("first");
    result.showToast("second");
    result.showToast("third");
    expect(result.toasts.value).toHaveLength(3);
    const ids = result.toasts.value.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("auto-dismisses toasts after the default duration (3000ms)", () => {
    const { result } = withSetup(() => useToast());
    result.showToast("bye");
    expect(result.toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(2999);
    expect(result.toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(result.toasts.value).toHaveLength(0);
  });

  it("auto-dismisses after a custom duration", () => {
    const { result } = withSetup(() => useToast());
    result.showToast("fast", "info", undefined, undefined, 500);
    expect(result.toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(result.toasts.value).toHaveLength(0);
  });

  it("removeToast removes a specific toast by id", () => {
    const { result } = withSetup(() => useToast());
    result.showToast("a");
    result.showToast("b");
    const target = result.toasts.value[0].id;
    const other = result.toasts.value[1].id;
    result.removeToast(target);
    expect(result.toasts.value.map((t) => t.id)).toEqual([other]);
  });

  it("shared module state: toasts are visible to a second useToast consumer", async () => {
    const first = withSetup(() => useToast());
    first.result.showToast("shared");
    expect(toastState.value).toHaveLength(1);

    const second = withSetup(() => useToast());
    expect(second.result.toasts.value).toHaveLength(1);
    expect(second.result.toasts.value[0].message).toBe("shared");
    await nextTick();
    first.unmount();
    second.unmount();
  });

  it("preserves action label and onAction callback when provided", () => {
    const { result } = withSetup(() => useToast());
    const cb = vi.fn();
    result.showToast("retry please", "warning", cb, "Retry");
    const t = result.toasts.value[0];
    expect(t.actionLabel).toBe("Retry");
    expect(t.onAction).toBe(cb);
    t.onAction?.();
    expect(cb).toHaveBeenCalledOnce();
  });
});
