import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { TracePlugin } from "./plugin-instance.js";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

async function waitForFile(filePath: string, timeoutMs: number = 5000): Promise<void> {
  const startTime = Date.now();
  while (true) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        if (content && content.length > 0) {
          JSON.parse(content);
          return;
        }
      } catch {
      }
    }
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for valid file ${filePath} after ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
}

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
    
    expect(sanitized).toContain('[HOME]');
    expect(sanitized).toContain('[IP]');
    expect(sanitized).toContain(':[PORT]');
    expect(sanitized).not.toContain(userHome);
    expect(sanitized).not.toContain('192.168.1.100');
    expect(sanitized).not.toContain('127.0.0.1');
    expect(sanitized).not.toContain(':8080');
    expect(sanitized).not.toContain(':3000');
  });

  test("sanitizeStackTrace redacts ports in Windows paths", () => {
    const sanitizeStackTrace = plugin["sanitizeStackTrace"];
    const userHome = homedir();
    
    const windowsStack = `Error at ${userHome}\\project\\file.ts:10:5
Connection to 10.0.0.1:8080 failed
Listening on 0.0.0.0:3000`;
    
    const sanitized = sanitizeStackTrace(windowsStack);
    
    expect(sanitized).toContain('[HOME]');
    expect(sanitized).toContain('[IP]');
    expect(sanitized).toContain(':[PORT]');
    expect(sanitized).not.toContain('10.0.0.1');
    expect(sanitized).not.toContain('0.0.0.0');
    expect(sanitized).not.toContain(':8080');
    expect(sanitized).not.toContain(':3000');
  });
});