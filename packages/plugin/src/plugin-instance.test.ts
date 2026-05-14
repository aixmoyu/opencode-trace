import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { TracePlugin } from "./plugin-instance.js";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("TracePlugin", () => {
  let tempDir: string;
  let plugin: TracePlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plugin-test-"));
    plugin = new TracePlugin(tempDir);
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("constructor initializes write and state queues", () => {
    expect(plugin).toBeDefined();
    expect(plugin["writeQueue"]).toBeDefined();
    expect(plugin["stateQueue"]).toBeDefined();
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
      return new Response(JSON.stringify({result: "ok"}), {
        status: 200,
        headers: {"content-type": "application/json"}
      });
    };
    globalThis.fetch = mockFetch;
    
    plugin.installInterceptor();
    
    const sessionId = "test-session";
    const request = new Request("https://example.com", {
      method: "POST",
      headers: {
        "x-opencode-session": sessionId,
        "content-type": "application/json"
      },
      body: JSON.stringify({test: true})
    });

    const response = await plugin.tracedFetch(request);
    
    await new Promise(resolve => setTimeout(resolve, 100));

    const filePath = join(tempDir, sessionId, "1.json");
    expect(existsSync(filePath)).toBe(true);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content.request.method).toBe("POST");
    expect(content.response.status).toBe(200);
  });

  test("sanitizeStackTrace removes sensitive information", () => {
    const sanitizeStackTrace = plugin["sanitizeStackTrace"];
    
    const stack = `Error at /home/li/sensitive/path/file.ts:10:5
Error at /Users/john/private/project/src/index.ts:20:10
Connection to 192.168.1.100:8080 failed
Server running on 127.0.0.1:3000`;
    
    const sanitized = sanitizeStackTrace(stack);
    
    expect(sanitized).toContain('/home/[USER]');
    expect(sanitized).toContain('/Users/[USER]');
    expect(sanitized).toContain('[IP]');
    expect(sanitized).toContain(':[PORT]');
    expect(sanitized).not.toContain('/home/li');
    expect(sanitized).not.toContain('/Users/john');
    expect(sanitized).not.toContain('192.168.1.100');
    expect(sanitized).not.toContain('127.0.0.1');
    expect(sanitized).not.toContain(':8080');
    expect(sanitized).not.toContain(':3000');
  });
});