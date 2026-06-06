import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { TracePlugin } from "./plugin-instance.js";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { logger } from "@opencode-trace/core";
import { promises as fsp } from "node:fs";

async function waitForFile(
  filePath: string,
  timeoutMs: number = 5000,
): Promise<void> {
  const startTime = Date.now();
  while (true) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        if (content && content.length > 0) {
          JSON.parse(content);
          return;
        }
      } catch {}
    }
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Timeout waiting for valid file ${filePath} after ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("TracePlugin", () => {
  let tempDir: string;
  let plugin: TracePlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-test-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("constructor initializes write queue", () => {
    expect(plugin).toBeDefined();
    expect(plugin["writeQueue"]).toBeDefined();
  });

  test("installInterceptor installs traced fetch", () => {
    const originalFetch = globalThis.fetch;
    plugin.installInterceptor();

    expect(globalThis.fetch).not.toBe(originalFetch);
  });

  test("uninstallInterceptor restores original fetch", () => {
    const originalFetch = globalThis.fetch;
    plugin.installInterceptor();
    plugin.uninstallInterceptor();

    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("installInterceptor is idempotent (can be called twice)", () => {
    const originalFetch = globalThis.fetch;
    plugin.installInterceptor();
    const firstInterceptor = globalThis.fetch;

    plugin.installInterceptor(); // Should not change
    expect(globalThis.fetch).toBe(firstInterceptor);

    plugin.uninstallInterceptor();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("uninstallInterceptor is safe when not installed", () => {
    const originalFetch = globalThis.fetch;
    plugin.uninstallInterceptor(); // Should not throw or change

    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("can reinstall after uninstall", () => {
    const originalFetch = globalThis.fetch;
    plugin.installInterceptor();
    plugin.uninstallInterceptor();

    plugin.installInterceptor(); // Should work again
    expect(globalThis.fetch).not.toBe(originalFetch);

    plugin.uninstallInterceptor();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("tracedFetch writes records via writeQueue", async () => {
    // Mock fetch BEFORE installing interceptor so origFetch captures the mock
    const mockFetch = async () => {
      return new Response(JSON.stringify({ result: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    globalThis.fetch = mockFetch;

    plugin.installInterceptor();

    const sessionId = "test-session";
    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ test: true }),
    });

    const response = await plugin.tracedFetch(request);

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    expect(existsSync(filePath)).toBe(true);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.request.method).toBe("POST");
    expect(content.response.status).toBe(200);
  });

  test("sanitizeStackTrace removes sensitive information", () => {
    const sanitizeStackTrace = plugin["sanitizeStackTrace"];
    const userHome = homedir();

    const stack = `Error at ${userHome}/sensitive/path/file.ts:10:5
Connection to 192.168.1.100:8080 failed
Server running on 127.0.0.1:3000`;

    const sanitized = sanitizeStackTrace(stack);

    expect(sanitized).toContain("[HOME]");
    expect(sanitized).toContain("[IP]");
    expect(sanitized).toContain(":[PORT]");
    expect(sanitized).not.toContain(userHome);
    expect(sanitized).not.toContain("192.168.1.100");
    expect(sanitized).not.toContain("127.0.0.1");
    expect(sanitized).not.toContain(":8080");
    expect(sanitized).not.toContain(":3000");
  });

  test("sanitizeStackTrace redacts ports in Windows paths", () => {
    const sanitizeStackTrace = plugin["sanitizeStackTrace"];
    const userHome = homedir();

    const windowsStack = `Error at ${userHome}\\project\\file.ts:10:5
Connection to 10.0.0.1:8080 failed
Listening on 0.0.0.0:3000`;

    const sanitized = sanitizeStackTrace(windowsStack);

    expect(sanitized).toContain("[HOME]");
    expect(sanitized).toContain("[IP]");
    expect(sanitized).toContain(":[PORT]");
    expect(sanitized).not.toContain("10.0.0.1");
    expect(sanitized).not.toContain("0.0.0.0");
    expect(sanitized).not.toContain(":8080");
    expect(sanitized).not.toContain(":3000");
  });
});

describe("TracePlugin - constructor & init", () => {
  let globalDir: string;
  let localDir: string;

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), "plugin-global-"));
    localDir = mkdtempSync(join(tmpdir(), "plugin-local-"));
  });

  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  test("throws TypeError when localDir is missing", () => {
    expect(() => new TracePlugin({ globalDir } as never)).toThrow(TypeError);
    expect(() => new TracePlugin({} as never)).toThrow(/localDir is required/);
  });

  test("defaults globalDir to ~/.opencode-trace when omitted", () => {
    const p = new TracePlugin({ localDir });
    const status = p.getScopeStatus();
    expect(status.globalDir).toBe(join(homedir(), ".opencode-trace"));
    expect(status.localDir).toBe(localDir);
  });

  test("initStateManager creates both config managers and config files", async () => {
    const p = new TracePlugin({ globalDir, localDir });
    expect(p.getStateManager()).toBeNull();
    expect(p.getGlobalConfigManager()).toBeNull();
    expect(p.getLocalConfigManager()).toBeNull();

    await p.initStateManager();

    expect(p.getStateManager()).not.toBeNull();
    expect(p.getGlobalConfigManager()).not.toBeNull();
    expect(p.getLocalConfigManager()).not.toBeNull();
    expect(p.getStateManager()).toBe(p.getGlobalConfigManager());
    expect(existsSync(join(globalDir, "config.json"))).toBe(true);
    expect(existsSync(join(localDir, "config.json"))).toBe(true);
  });
});

describe("TracePlugin - shouldRecord (scope resolution)", () => {
  let globalDir: string;
  let localDir: string;
  let plugin: TracePlugin;

  beforeEach(async () => {
    globalDir = mkdtempSync(join(tmpdir(), "plugin-sr-g-"));
    localDir = mkdtempSync(join(tmpdir(), "plugin-sr-l-"));
    plugin = new TracePlugin({ globalDir, localDir });
    await plugin.initStateManager();
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  test("returns true when state managers not initialized (defensive default)", () => {
    const fresh = new TracePlugin({ globalDir, localDir });
    expect(fresh.shouldRecord("s1")).toBe(true);
    expect(fresh.shouldRecord()).toBe(true);
  });

  test("global enabled → true regardless of local/session", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const lcm = plugin.getLocalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "true");
    lcm.setGlobalState("global_trace_enabled", "false");
    gcm.setSessionEnabled("s1", false);

    expect(plugin.shouldRecord("s1")).toBe(true);
    expect(plugin.shouldRecord()).toBe(true);
  });

  test("global disabled + local enabled → true", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const lcm = plugin.getLocalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "false");
    lcm.setGlobalState("global_trace_enabled", "true");
    gcm.setSessionEnabled("s1", false);

    expect(plugin.shouldRecord("s1")).toBe(true);
    expect(plugin.shouldRecord()).toBe(true);
  });

  test("global disabled + local disabled + session enabled → true", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const lcm = plugin.getLocalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "false");
    lcm.setGlobalState("global_trace_enabled", "false");
    gcm.setSessionEnabled("s1", true);

    expect(plugin.shouldRecord("s1")).toBe(true);
  });

  test("global disabled + local disabled + session disabled → false", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const lcm = plugin.getLocalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "false");
    lcm.setGlobalState("global_trace_enabled", "false");
    gcm.setSessionEnabled("s1", false);

    expect(plugin.shouldRecord("s1")).toBe(false);
  });

  test("global disabled + local disabled + no sessionId → false", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const lcm = plugin.getLocalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "false");
    lcm.setGlobalState("global_trace_enabled", "false");

    expect(plugin.shouldRecord(undefined)).toBe(false);
    expect(plugin.shouldRecord()).toBe(false);
  });

  test("global disabled + local disabled + unknown session → false (default trace_enabled=null)", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const lcm = plugin.getLocalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "false");
    lcm.setGlobalState("global_trace_enabled", "false");

    expect(plugin.shouldRecord("never-seen")).toBe(false);
  });

  test("global disabled + local disabled + session unset → false", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const lcm = plugin.getLocalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "false");
    lcm.setGlobalState("global_trace_enabled", "false");

    expect(plugin.shouldRecord("s1")).toBe(false);
  });
});

describe("TracePlugin - resolveTraceDir (storage preference)", () => {
  let globalDir: string;
  let localDir: string;
  let plugin: TracePlugin;

  beforeEach(async () => {
    globalDir = mkdtempSync(join(tmpdir(), "plugin-rd-g-"));
    localDir = mkdtempSync(join(tmpdir(), "plugin-rd-l-"));
    plugin = new TracePlugin({ globalDir, localDir });
    await plugin.initStateManager();
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  test("returns globalDir when managers not initialized", () => {
    const fresh = new TracePlugin({ globalDir, localDir });
    expect(fresh.resolveTraceDir("s1")).toBe(globalDir);
    expect(fresh.resolveTraceDir()).toBe(globalDir);
  });

  test("no session pref + global pref 'global' → globalDir", () => {
    plugin.getGlobalConfigManager()!.setStoragePreference("global");
    expect(plugin.resolveTraceDir("s1")).toBe(globalDir);
    expect(plugin.resolveTraceDir()).toBe(globalDir);
  });

  test("no session pref + global pref 'local' → localDir", () => {
    plugin.getGlobalConfigManager()!.setStoragePreference("local");
    expect(plugin.resolveTraceDir("s1")).toBe(localDir);
    expect(plugin.resolveTraceDir()).toBe(localDir);
  });

  test("session pref 'global' overrides global pref 'local' → globalDir", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    gcm.setStoragePreference("local");
    gcm.setSessionStoragePreference("s1", "global");

    expect(plugin.resolveTraceDir("s1")).toBe(globalDir);
    expect(plugin.resolveTraceDir("other")).toBe(localDir);
  });

  test("session pref 'local' overrides global pref 'global' → localDir", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    gcm.setStoragePreference("global");
    gcm.setSessionStoragePreference("s1", "local");

    expect(plugin.resolveTraceDir("s1")).toBe(localDir);
    expect(plugin.resolveTraceDir("other")).toBe(globalDir);
  });
});

describe("TracePlugin - getScopeStatus", () => {
  let globalDir: string;
  let localDir: string;

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), "plugin-ss-g-"));
    localDir = mkdtempSync(join(tmpdir(), "plugin-ss-l-"));
  });

  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  test("returns defaults when state manager not initialized", () => {
    const p = new TracePlugin({ globalDir, localDir });
    const status = p.getScopeStatus("s1");
    expect(status.globalEnabled).toBe(false);
    expect(status.localEnabled).toBe(false);
    expect(status.sessionEnabled).toBeNull();
    expect(status.effectiveEnabled).toBe(true);
    expect(status.storageLocation).toBe("global");
    expect(status.globalDir).toBe(globalDir);
    expect(status.localDir).toBe(localDir);
  });

  test("reports sessionEnabled=null when no sessionId provided", async () => {
    const p = new TracePlugin({ globalDir, localDir });
    await p.initStateManager();
    const status = p.getScopeStatus();
    expect(status.sessionEnabled).toBeNull();
  });

  test("reports full status with all scopes engaged", async () => {
    const p = new TracePlugin({ globalDir, localDir });
    await p.initStateManager();
    const gcm = p.getGlobalConfigManager()!;
    const lcm = p.getLocalConfigManager()!;

    gcm.setGlobalState("global_trace_enabled", "true");
    lcm.setGlobalState("global_trace_enabled", "false");
    gcm.setStoragePreference("local");
    gcm.setSessionEnabled("s1", true);

    const status = p.getScopeStatus("s1");
    expect(status.globalEnabled).toBe(true);
    expect(status.localEnabled).toBe(false);
    expect(status.sessionEnabled).toBe(true);
    expect(status.effectiveEnabled).toBe(true);
    expect(status.storageLocation).toBe("local");
  });

  test("reports storageLocation='global' when resolveTraceDir picks global", async () => {
    const p = new TracePlugin({ globalDir, localDir });
    await p.initStateManager();
    p.getGlobalConfigManager()!.setStoragePreference("global");
    const status = p.getScopeStatus("s1");
    expect(status.storageLocation).toBe("global");
  });
});

describe("TracePlugin - session metadata operations via ConfigManager", () => {
  let globalDir: string;
  let localDir: string;
  let plugin: TracePlugin;

  beforeEach(async () => {
    globalDir = mkdtempSync(join(tmpdir(), "plugin-meta-g-"));
    localDir = mkdtempSync(join(tmpdir(), "plugin-meta-l-"));
    plugin = new TracePlugin({ globalDir, localDir });
    await plugin.initStateManager();
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  test("setSessionEnabled / getSessionEnabled write to session metadata file", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const sessionId = "meta-session";

    expect(gcm.getSessionEnabled(sessionId)).toBeNull();

    gcm.setSessionEnabled(sessionId, false);
    expect(gcm.getSessionEnabled(sessionId)).toBe(false);

    const metaPath = join(globalDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.trace_enabled).toBe(false);

    gcm.setSessionEnabled(sessionId, true);
    expect(gcm.getSessionEnabled(sessionId)).toBe(true);
    const meta2 = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta2.trace_enabled).toBe(true);
  });

  test("setSessionStoragePreference / getSessionStoragePreference round-trip", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    const sessionId = "storage-session";

    expect(gcm.getSessionStoragePreference(sessionId)).toBeNull();

    gcm.setSessionStoragePreference(sessionId, "local");
    expect(gcm.getSessionStoragePreference(sessionId)).toBe("local");

    gcm.setSessionStoragePreference(sessionId, "global");
    expect(gcm.getSessionStoragePreference(sessionId)).toBe("global");

    const metaPath = join(globalDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.storage_preference).toBe("global");
  });

  test("setStoragePreference / getStoragePreference write to global config", () => {
    const gcm = plugin.getGlobalConfigManager()!;

    expect(gcm.getStoragePreference()).toBe("global");

    gcm.setStoragePreference("local");
    expect(gcm.getStoragePreference()).toBe("local");

    const config = JSON.parse(
      readFileSync(join(globalDir, "config.json"), "utf-8"),
    );
    expect(config.storage_preference).toBe("local");
  });

  test("addSubSession links parent to child and dedups duplicates", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    gcm.startSession("parent-session");
    gcm.startSession("child-1");
    gcm.startSession("child-2");

    gcm.addSubSession("parent-session", "child-1");
    gcm.addSubSession("parent-session", "child-2");
    gcm.addSubSession("parent-session", "child-1");

    const metaPath = join(globalDir, "parent-session", "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.subSessions).toEqual(["child-1", "child-2"]);
  });

  test("updateSessionMetadata sets parentID on child for sub-session linking", () => {
    const gcm = plugin.getGlobalConfigManager()!;
    gcm.startSession("parent-id");
    gcm.startSession("child-id");
    gcm.updateSessionMetadata("child-id", { parentID: "parent-id" });

    const metaPath = join(globalDir, "child-id", "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.parentID).toBe("parent-id");
  });
});

describe("TracePlugin - config corruption recovery", () => {
  test("initStateManager falls back to defaults when config.json is invalid JSON", async () => {
    const globalDir = mkdtempSync(join(tmpdir(), "plugin-corrupt-g-"));
    const localDir = mkdtempSync(join(tmpdir(), "plugin-corrupt-l-"));
    try {
      writeFileSync(
        join(globalDir, "config.json"),
        "{ this is not valid json",
        "utf-8",
      );
      writeFileSync(
        join(localDir, "config.json"),
        "{{{",
        "utf-8",
      );

      const errorSpy = vi.spyOn(logger, "error").mockImplementation(
        ((..._args: unknown[]) => logger) as never,
      );

      const p = new TracePlugin({ globalDir, localDir });
      await p.initStateManager();

      const gcm = p.getGlobalConfigManager()!;
      expect(gcm.getGlobalState("global_trace_enabled")).toBe("true");
      expect(gcm.getGlobalState("plugin_enabled")).toBe("true");
      expect(gcm.getStoragePreference()).toBe("global");
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((m) => /config\.json/i.test(m))).toBe(true);

      errorSpy.mockRestore();
    } finally {
      rmSync(globalDir, { recursive: true, force: true });
      rmSync(localDir, { recursive: true, force: true });
    }
  });
});

describe("TracePlugin - tracedFetch edge cases", () => {
  let tempDir: string;
  let plugin: TracePlugin;
  let savedFetch: typeof fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-edge-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    savedFetch = globalThis.fetch;
  });

  afterEach(async () => {
    plugin.uninstallInterceptor();
    globalThis.fetch = savedFetch;
    await plugin.flush();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("delegates without recording when no session header is present", async () => {
    let invoked = false;
    globalThis.fetch = async () => {
      invoked = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    plugin.installInterceptor();

    const res = await plugin.tracedFetch("https://example.com");
    expect(invoked).toBe(true);
    expect(res.status).toBe(200);

    await plugin.flush();
    const sessionDirs = readdirSync(tempDir).filter((e) => {
      try {
        return statSync(join(tempDir, e)).isDirectory();
      } catch {
        return false;
      }
    });
    expect(sessionDirs.length).toBe(0);
  });

  test("delegates without recording when shouldRecord returns false", async () => {
    await plugin.initStateManager();
    const gcm = plugin.getGlobalConfigManager()!;
    gcm.setGlobalState("global_trace_enabled", "false");
    gcm.setSessionEnabled("blocked", false);

    let invoked = false;
    globalThis.fetch = async () => {
      invoked = true;
      return new Response("ok", { status: 200 });
    };
    plugin.installInterceptor();

    const req = new Request("https://example.com", {
      headers: { "x-opencode-session": "blocked" },
    });
    const res = await plugin.tracedFetch(req);
    expect(invoked).toBe(true);
    expect(res.status).toBe(200);

    await plugin.flush();
    const sessionDir = join(tempDir, "blocked");
    if (existsSync(sessionDir)) {
      const recordFiles = readdirSync(sessionDir).filter((f) =>
        /^\d+\.json$/.test(f),
      );
      expect(recordFiles.length).toBe(0);
    }
  });

  test("records error and rethrows when delegate fetch throws Error", async () => {
    const fetchError = new Error("Network down");
    globalThis.fetch = async () => {
      throw fetchError;
    };
    plugin.installInterceptor();

    const sessionId = "err-session";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ q: 1 }),
    });

    await expect(plugin.tracedFetch(req)).rejects.toThrow("Network down");

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.response).toBeNull();
    expect(content.error).toBeTruthy();
    expect(content.error.message).toBe("Network down");
  });

  test("records error and rethrows when delegate throws non-Error value", async () => {
    globalThis.fetch = async () => {
      throw "boom-string";
    };
    plugin.installInterceptor();

    const sessionId = "str-err-session";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: { "x-opencode-session": sessionId },
      body: "{}",
    });

    await expect(plugin.tracedFetch(req)).rejects.toBe("boom-string");

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.error).toBeTruthy();
    expect(content.error.message).toBe("boom-string");
    expect(content.error.stack).toBeUndefined();
  });

  test("wraps streaming response and captures latency metadata", async () => {
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: chunk1\n\n"));
          controller.enqueue(encoder.encode("data: chunk2\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    plugin.installInterceptor();

    const sessionId = "stream-session";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ stream: true, model: "test" }),
    });

    const res = await plugin.tracedFetch(req);
    expect(res.status).toBe(200);
    await res.text();

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.requestSentAt).toBeTypeOf("number");
    expect(content.firstTokenAt).toBeTypeOf("number");
    expect(content.lastTokenAt).toBeTypeOf("number");
    expect(content.firstTokenAt).toBeGreaterThanOrEqual(content.requestSentAt);
    expect(content.lastTokenAt).toBeGreaterThanOrEqual(content.firstTokenAt);
  });

  test("captures request body when not valid JSON (raw string)", async () => {
    globalThis.fetch = async () =>
      new Response("plain", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    plugin.installInterceptor();

    const sessionId = "raw-session";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "text/plain",
      },
      body: "hello world",
    });

    const res = await plugin.tracedFetch(req);
    expect(res.status).toBe(200);

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.request.body).toBe("hello world");
  });

  test("classifyPurpose returns '' for body with non-empty tools array", () => {
    const classify = plugin["classifyPurpose"].bind(plugin);
    expect(classify({ tools: [{ name: "tool1" }] })).toBe("");
    expect(classify({ tools: [] })).toBe("[meta]");
    expect(classify({})).toBe("[meta]");
    expect(classify(null)).toBe("[meta]");
    expect(classify("text")).toBe("[meta]");
    expect(classify([1, 2, 3])).toBe("[meta]");
  });
});

describe("TracePlugin - buildTimelineEntry provider & token extraction", () => {
  let tempDir: string;
  let plugin: TracePlugin;
  let savedFetch: typeof fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-tl-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    savedFetch = globalThis.fetch;
  });

  afterEach(async () => {
    plugin.uninstallInterceptor();
    globalThis.fetch = savedFetch;
    await plugin.flush();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function waitForNdjsonLine(
    path: string,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (existsSync(path)) {
        const raw = readFileSync(path, "utf-8");
        const firstLine = raw.split("\n").find((l) => l.trim());
        if (firstLine) {
          try {
            return JSON.parse(firstLine);
          } catch {}
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timeout waiting for ndjson line in ${path}`);
  }

  test("extracts openai provider with prompt/completion tokens", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          model: "gpt-4",
          usage: { prompt_tokens: 120, completion_tokens: 60 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    plugin.installInterceptor();

    const req = new Request("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "x-opencode-session": "oai", "content-type": "application/json" },
      body: "{}",
    });
    await plugin.tracedFetch(req);

    const entry = await waitForNdjsonLine(
      join(tempDir, "oai", "timeline.ndjson"),
    );
    expect(entry.provider).toBe("openai");
    expect(entry.model).toBe("gpt-4");
    expect(entry.inputTokens).toBe(120);
    expect(entry.outputTokens).toBe(60);
  });

  test("extracts anthropic provider with input/output tokens", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          model: "claude-3-opus",
          usage: { input_tokens: 200, output_tokens: 80 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    plugin.installInterceptor();

    const req = new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-opencode-session": "ant", "content-type": "application/json" },
      body: "{}",
    });
    await plugin.tracedFetch(req);

    const entry = await waitForNdjsonLine(
      join(tempDir, "ant", "timeline.ndjson"),
    );
    expect(entry.provider).toBe("anthropic");
    expect(entry.model).toBe("claude-3-opus");
    expect(entry.inputTokens).toBe(200);
    expect(entry.outputTokens).toBe(80);
  });

  test("provider is null for unknown URL, tokens null when usage absent", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    plugin.installInterceptor();

    const req = new Request("https://example.com/api", {
      method: "POST",
      headers: { "x-opencode-session": "unk", "content-type": "application/json" },
      body: "{}",
    });
    await plugin.tracedFetch(req);

    const entry = await waitForNdjsonLine(
      join(tempDir, "unk", "timeline.ndjson"),
    );
    expect(entry.provider).toBeNull();
    expect(entry.model).toBeNull();
    expect(entry.inputTokens).toBeNull();
    expect(entry.outputTokens).toBeNull();
  });
});

describe("TracePlugin - flush, wrap, getInterceptor, getSessionId", () => {
  let tempDir: string;
  let plugin: TracePlugin;
  let savedFetch: typeof fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-misc-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    savedFetch = globalThis.fetch;
  });

  afterEach(async () => {
    plugin.uninstallInterceptor();
    globalThis.fetch = savedFetch;
    await plugin.flush();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("flush awaits underlying writeQueue.flush()", async () => {
    const spy = vi
      .spyOn(plugin["writeQueue"], "flush")
      .mockResolvedValue(undefined);
    await plugin.flush();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("wrap returns a function that uses the provided fetch as origFetch", async () => {
    let providedCalled = 0;
    const provided = (async () => {
      providedCalled++;
      return new Response("from-provided", { status: 201 });
    }) as typeof fetch;

    const wrapped = plugin.wrap(provided);
    const res = await wrapped("https://example.com");
    expect(providedCalled).toBe(1);
    expect(res.status).toBe(201);
  });

  test("getInterceptor returns a function that uses origFetch captured at construction", async () => {
    let origCalled = 0;
    const fakeOrig = (async () => {
      origCalled++;
      return new Response("from-orig", { status: 202 });
    }) as typeof fetch;

    globalThis.fetch = fakeOrig;
    const p = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    globalThis.fetch = savedFetch;

    const interceptor = p.getInterceptor();
    const res = await interceptor("https://example.com");
    expect(origCalled).toBe(1);
    expect(res.status).toBe(202);
  });

  test("getSessionId reads from x-session-affinity header", async () => {
    globalThis.fetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    plugin.installInterceptor();

    const req = new Request("https://example.com", {
      method: "POST",
      headers: { "x-session-affinity": "affinity-session" },
      body: "{}",
    });
    await plugin.tracedFetch(req);

    const filePath = join(tempDir, "affinity-session", "1.json");
    await waitForFile(filePath, 5000);
    expect(existsSync(filePath)).toBe(true);
  });

  test("getSessionId reads from session_id header", async () => {
    globalThis.fetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    plugin.installInterceptor();

    const req = new Request("https://example.com", {
      method: "POST",
      headers: { session_id: "fallback-session" },
      body: "{}",
    });
    await plugin.tracedFetch(req);

    const filePath = join(tempDir, "fallback-session", "1.json");
    await waitForFile(filePath, 5000);
    expect(existsSync(filePath)).toBe(true);
  });

  test("sequence numbers increment per session", async () => {
    globalThis.fetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    plugin.installInterceptor();

    const sessionId = "seq-session";
    for (let i = 0; i < 3; i++) {
      const req = new Request(`https://example.com/${i}`, {
        method: "POST",
        headers: { "x-opencode-session": sessionId },
        body: "{}",
      });
      await plugin.tracedFetch(req);
    }

    await waitForFile(join(tempDir, sessionId, "3.json"), 5000);
    expect(existsSync(join(tempDir, sessionId, "1.json"))).toBe(true);
    expect(existsSync(join(tempDir, sessionId, "2.json"))).toBe(true);
    expect(existsSync(join(tempDir, sessionId, "3.json"))).toBe(true);
  });
});

describe("TracePlugin - coverage gap tests", () => {
  let tempDir: string;
  let plugin: TracePlugin;
  let savedFetch: typeof fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-gap-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    savedFetch = globalThis.fetch;
  });

  afterEach(async () => {
    plugin.uninstallInterceptor();
    globalThis.fetch = savedFetch;
    await plugin.flush();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("recordResponse captures error with sanitized stack when res.clone() throws", async () => {
    const cloneSpy = vi.spyOn(Response.prototype, "clone").mockImplementation(() => {
      throw new Error("response body unusable");
    });

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    plugin.installInterceptor();

    const sessionId = "resp-clone-err";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ test: true }),
    });

    const res = await plugin.tracedFetch(req);
    expect(res.status).toBe(200);

    await plugin.flush();

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.response).toBeNull();
    expect(content.error).toBeTruthy();
    expect(content.error.message).toBe("response body unusable");
    expect(content.error.stack).toBeTruthy();

    cloneSpy.mockRestore();
  });

  test("recordResponse captures non-Error throw from res.clone()", async () => {
    const cloneSpy = vi.spyOn(Response.prototype, "clone").mockImplementation(() => {
      throw "raw-string-error";
    });

    globalThis.fetch = async () =>
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    plugin.installInterceptor();

    const sessionId = "resp-non-err";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: { "x-opencode-session": sessionId },
      body: "{}",
    });

    const res = await plugin.tracedFetch(req);
    expect(res.status).toBe(200);

    await plugin.flush();

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.response).toBeNull();
    expect(content.error.message).toBe("raw-string-error");
    expect(content.error.stack).toBeUndefined();

    cloneSpy.mockRestore();
  });

  test("wrapStreamResponse logs error and continues stream when SSE chunk write fails", async () => {
    const mockHandle = {
      write: vi.fn().mockRejectedValue(new Error("disk full")),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const _realOpen = fsp.open;
    const openSpy = vi.spyOn(fsp, "open").mockImplementation(
      async (path: any, flags?: any, mode?: any) => {
        if (String(path).includes(".sse")) {
          return mockHandle as any;
        }
        return _realOpen(path, flags, mode) as any;
      },
    );
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(
      ((..._args: unknown[]) => logger) as never,
    );

    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: chunk1\n\n"));
          controller.enqueue(encoder.encode("data: chunk2\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    plugin.installInterceptor();

    const sessionId = "sse-write-err";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ stream: true, model: "test" }),
    });

    const res = await plugin.tracedFetch(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data: chunk1");
    expect(text).toContain("data: chunk2");

    await plugin.flush();

    expect(
      errorSpy.mock.calls.some((c) =>
        /Failed to write SSE chunk/i.test(String(c[0])),
      ),
    ).toBe(true);

    openSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("wrapStreamResponse logs error when closing SSE file fails", async () => {
    const mockHandle = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new Error("close failed")),
    };
    const _realOpen = fsp.open;
    const openSpy = vi.spyOn(fsp, "open").mockImplementation(
      async (path: any, flags?: any, mode?: any) => {
        if (String(path).includes(".sse")) {
          return mockHandle as any;
        }
        return _realOpen(path, flags, mode) as any;
      },
    );
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(
      ((..._args: unknown[]) => logger) as never,
    );

    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: chunk1\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    plugin.installInterceptor();

    const sessionId = "sse-finalize-err";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ stream: true, model: "test" }),
    });

    const res = await plugin.tracedFetch(req);
    expect(res.status).toBe(200);
    await res.text();

    await plugin.flush();

    expect(
      errorSpy.mock.calls.some((c) =>
        /Failed to finalize SSE file/i.test(String(c[0])),
      ),
    ).toBe(true);

    openSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("captureRequestMeta falls back to empty body when clone().text() rejects", async () => {
    const textSpy = vi.spyOn(Request.prototype, "text").mockRejectedValue(
      new Error("body stream locked"),
    );
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(
      ((..._args: unknown[]) => logger) as never,
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    plugin.installInterceptor();

    const sessionId = "clone-err-session";
    const req = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ test: true }),
    });

    const res = await plugin.tracedFetch(req);
    expect(res.status).toBe(200);

    await plugin.flush();

    const filePath = join(tempDir, sessionId, "1.json");
    await waitForFile(filePath, 5000);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));

    expect(content.request.body).toBeNull();
    expect(content.purpose).toBe("[meta]");

    expect(
      errorSpy.mock.calls.some((c) =>
        /Failed to clone request body/i.test(String(c[0])),
      ),
    ).toBe(true);

    textSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
