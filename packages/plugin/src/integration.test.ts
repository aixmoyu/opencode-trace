import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { TracePlugin } from "./plugin-instance.js";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function waitForFiles(dir: string, count: number, timeoutMs: number = 5000): Promise<void> {
  const startTime = Date.now();
  while (true) {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith(".json"));
      if (files.length >= count) {
        let allValid = true;
        for (const file of files) {
          try {
            const content = readFileSync(join(dir, file), "utf-8");
            if (!content || content.length === 0) {
              allValid = false;
              break;
            }
            JSON.parse(content);
          } catch {
            allValid = false;
            break;
          }
        }
        if (allValid) return;
      }
    }
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for ${count} valid files in ${dir} after ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
}

describe("Integration: TracePlugin full flow", () => {
  let tempDir: string;
  let plugin: TracePlugin;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-test-"));
    plugin = new TracePlugin(tempDir);
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("multiple concurrent requests are recorded in order", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const req = new Request(input);
      await new Promise(resolve => setTimeout(resolve, 50));
      return new Response(JSON.stringify({url: req.url}), {status: 200});
    };

    plugin.installInterceptor();
    await plugin.initStateManager();

    const sessionId = "concurrent-test";
    plugin["stateManager"]!.startSession(sessionId);

    const requests = Array.from({length: 5}, (_, i) => 
      plugin.tracedFetch(`https://example.com/${i}`, {
        method: "GET",
        headers: {"x-opencode-session": sessionId}
      })
    );

    const responses = await Promise.all(requests);
    expect(responses.every(r => r.status === 200)).toBe(true);

    const sessionDir = join(tempDir, sessionId);
    await waitForFiles(sessionDir, 5);

    const files = readdirSync(sessionDir).filter(f => f.endsWith(".json")).sort();
    expect(files.length).toBe(5);

    for (let i = 0; i < 5; i++) {
      const content = JSON.parse(readFileSync(join(sessionDir, files[i]), "utf-8"));
      expect(content.id).toBe(i + 1);
    }

    globalThis.fetch = originalFetch;
  });
});