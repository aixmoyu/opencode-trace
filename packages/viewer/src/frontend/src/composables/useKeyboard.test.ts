import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useKeyboard } from "./useKeyboard";

interface FakeEventSource {
  url: string;
  withCredentials: boolean;
  readyState: number;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  listeners: Map<string, Set<EventListener>>;
  closed: boolean;
  close: () => void;
}

let instances: FakeEventSource[] = [];

class MockEventSource {
  url: string;
  withCredentials = false;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  listeners = new Map<string, Set<EventListener>>();
  closed = false;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    instances.push(this as unknown as FakeEventSource);
  }

  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event) {
    return true;
  }

  close() {
    this.closed = true;
    this.readyState = MockEventSource.CLOSED;
  }
}

function fire(es: FakeEventSource, type: string, data?: string) {
  const set = es.listeners.get(type);
  if (!set) return;
  for (const l of set) {
    if (data !== undefined) {
      l(new MessageEvent(type, { data }));
    } else {
      l(new Event(type));
    }
  }
}

function makeMessageEvent(data: string): MessageEvent {
  return new MessageEvent("record:added", { data });
}

describe("useKeyboard", () => {
  beforeEach(() => {
    instances = [];
    // Replace the jsdom EventSource with our mock for the duration of the test
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function dispatchKey(key: string, target?: EventTarget | null) {
    const ev = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    const t = target ?? document.body;
    t.dispatchEvent(ev);
    return ev;
  }

  it("registers a keydown handler on mount and removes it on unmount", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const seen: string[] = [];
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "?": () => seen.push("?") });
        return () => h("div");
      },
    });

    const wrapper = mount(Comp);
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

    dispatchKey("?");
    expect(seen).toEqual(["?"]);

    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

    // After unmount, the handler should be gone
    dispatchKey("?");
    expect(seen).toEqual(["?"]);
  });

  it("invokes the matching handler for a simple key", () => {
    const handler = vi.fn();
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "/": handler });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    dispatchKey("/");
    expect(handler).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("does not invoke handler for unregistered keys", () => {
    const handler = vi.fn();
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "?": handler });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    dispatchKey("a");
    expect(handler).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("matches key combos stored under composite keys like 'Cmd+K' / 'Ctrl+Shift+P'", () => {
    // useKeyboard maps by e.key directly; we verify that consumers can pass composite keys
    // and the handler is registered under the literal combo string. The OS produces
    // e.key === 'k' for Cmd+K, so consumers typically translate. Here we just verify
    // the handler map is honored.
    const k = vi.fn();
    const ctrlShiftP = vi.fn();
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "k": k, "Ctrl+Shift+P": ctrlShiftP });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    dispatchKey("k");
    dispatchKey("Ctrl+Shift+P");
    expect(k).toHaveBeenCalledOnce();
    expect(ctrlShiftP).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("ignores key events when focus is inside an <input> unless the key is Escape", () => {
    const handler = vi.fn();
    const escHandler = vi.fn();
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "k": handler, "Escape": escHandler });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    dispatchKey("k", input);
    expect(handler).not.toHaveBeenCalled();

    dispatchKey("Escape", input);
    expect(escHandler).toHaveBeenCalledOnce();

    document.body.removeChild(input);
    wrapper.unmount();
  });

  it("ignores key events when focus is inside a <textarea>", () => {
    const handler = vi.fn();
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "k": handler });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();

    dispatchKey("k", ta);
    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(ta);
    wrapper.unmount();
  });

  it("ignores key events when focus is inside a <select>", () => {
    const handler = vi.fn();
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "k": handler });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    const sel = document.createElement("select");
    document.body.appendChild(sel);
    sel.focus();
    dispatchKey("k", sel);
    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(sel);
    wrapper.unmount();
  });

  it("ignores key events when focus is inside a contentEditable element", () => {
    const handler = vi.fn();
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "k": handler });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    ce.tabIndex = -1;
    document.body.appendChild(ce);
    // jsdom does not propagate the contentEditable attribute to the
    // isContentEditable IDL property, so we install the property directly.
    Object.defineProperty(ce, "isContentEditable", {
      configurable: true,
      get: () => true,
    });
    ce.focus();
    // Sanity: make sure our focus attempt took effect in jsdom
    if (document.activeElement !== ce) {
      // If jsdom refuses to focus a plain div, manually mark it as active
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        get: () => ce,
      });
    }
    dispatchKey("k", ce);
    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(ce);
    wrapper.unmount();
  });

  it("prevents default when a key matches and not in an input", () => {
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "/": () => {} });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    const ev = dispatchKey("/");
    expect(ev.defaultPrevented).toBe(true);
    wrapper.unmount();
  });

  it("does not prevent default when inside an input (except for Escape which still prevents)", () => {
    const Comp = defineComponent({
      setup() {
        useKeyboard({ "k": () => {}, "Escape": () => {} });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const evK = dispatchKey("k", input);
    expect(evK.defaultPrevented).toBe(false);

    const evEsc = dispatchKey("Escape", input);
    expect(evEsc.defaultPrevented).toBe(true);

    document.body.removeChild(input);
    wrapper.unmount();
  });
});
