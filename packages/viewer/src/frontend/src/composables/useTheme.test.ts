import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

async function loadFresh(useThrowingLs = false) {
  vi.resetModules();
  // Stub localStorage *before* loading the module so the module-level ref
  // sees a fresh storage on first read inside initTheme().
  if (useThrowingLs) {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
      clear: () => {},
    });
  } else {
    vi.stubGlobal("localStorage", makeLocalStorage());
  }
  document.documentElement.removeAttribute("data-theme");
  const mod = await import("./useTheme");
  return mod.useTheme();
}

describe("useTheme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
  });

  it("returns theme, toggleTheme and initTheme", async () => {
    const api = await loadFresh();
    expect(api.theme).toBeDefined();
    expect(typeof api.toggleTheme).toBe("function");
    expect(typeof api.initTheme).toBe("function");
  });

  it("initTheme() leaves the module default 'dark' when storage is empty", async () => {
    const api = await loadFresh();
    api.initTheme();
    expect(api.theme.value).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("initTheme() reads a previously saved theme from localStorage", async () => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    window.localStorage.setItem("ot-theme", "light");
    const mod = await import("./useTheme");
    const api = mod.useTheme();
    api.initTheme();
    expect(api.theme.value).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("initTheme() applies a different saved value (light → dark after save)", async () => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    window.localStorage.setItem("ot-theme", "dark");
    const mod = await import("./useTheme");
    const api = mod.useTheme();
    // Pre-mutate to make sure initTheme actually reads from storage
    api.theme.value = "light";
    api.initTheme();
    expect(api.theme.value).toBe("dark");
  });

  it("toggleTheme() flips the current theme", async () => {
    const api = await loadFresh();
    api.initTheme();
    const before = api.theme.value;
    api.toggleTheme();
    const after = api.theme.value;
    expect(after).not.toBe(before);
    expect(after).toBe(before === "dark" ? "light" : "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe(after);
  });

  it("toggleTheme() toggles twice back to the original value", async () => {
    const api = await loadFresh();
    api.initTheme();
    const before = api.theme.value;
    api.toggleTheme();
    api.toggleTheme();
    expect(api.theme.value).toBe(before);
  });

  it("toggleTheme() persists the new theme to localStorage", async () => {
    const api = await loadFresh();
    api.initTheme();
    api.toggleTheme();
    const stored = window.localStorage.getItem("ot-theme");
    expect(stored).toBe(api.theme.value);
  });

  it("applyTheme is also triggered by the internal watch on theme changes", async () => {
    const api = await loadFresh();
    api.initTheme();
    api.theme.value = "light";
    await Promise.resolve();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("survives a localStorage that throws on read (private mode etc.)", async () => {
    const api = await loadFresh(true);
    expect(() => api.initTheme()).not.toThrow();
    // Without a stored value the module default 'dark' is kept
    expect(api.theme.value).toBe("dark");
  });

  it("survives a localStorage that throws on write (toggle)", async () => {
    const api = await loadFresh(true);
    api.initTheme();
    expect(() => api.toggleTheme()).not.toThrow();
    // The ref still flips
    expect(api.theme.value).toBe("light");
  });

  it("reuses a saved theme across subsequent consumers of useTheme()", async () => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    window.localStorage.setItem("ot-theme", "light");
    const mod = await import("./useTheme");
    const first = mod.useTheme();
    first.initTheme();
    expect(first.theme.value).toBe("light");

    // A second consumer should see the same module-level ref value
    const second = mod.useTheme();
    expect(second.theme.value).toBe("light");
  });
});
