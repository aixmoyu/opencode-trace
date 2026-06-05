import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { TracePlugin } from "./plugin-instance.js";
import entrypoint, { _resetForTesting } from "./trace.js";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  promises as fs,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => {
      const testDir = process.env._INTEGRATION_TEST_DIR_;
      if (testDir) return testDir;
      return original.homedir();
    },
  };
});

async function waitForFiles(
  dir: string,
  count: number,
  timeoutMs: number = 5000,
): Promise<void> {
  const startTime = Date.now();
  while (true) {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
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
      throw new Error(
        `Timeout waiting for ${count} valid files in ${dir} after ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

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

describe("Integration: TracePlugin full flow", () => {
  let tempDir: string;
  let plugin: TracePlugin;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-test-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("multiple concurrent requests are recorded in order", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const req = new Request(input);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(JSON.stringify({ url: req.url }), { status: 200 });
    };

    plugin.installInterceptor();
    await plugin.initStateManager();

    const sessionId = "concurrent-test";
    plugin.getStateManager()!.startSession(sessionId);
    plugin.getGlobalConfigManager()!.setSessionEnabled(sessionId, true);

    const requests = Array.from({ length: 5 }, (_, i) =>
      plugin.tracedFetch(`https://example.com/${i}`, {
        method: "GET",
        headers: { "x-opencode-session": sessionId },
      }),
    );

    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.status === 200)).toBe(true);

    await plugin.flush();

    const sessionDir = join(tempDir, sessionId);

    const files = readdirSync(sessionDir)
      .filter((f) => /^\d+\.json$/.test(f))
      .sort();
    expect(files.length).toBe(5);

    for (let i = 0; i < 5; i++) {
      const content = JSON.parse(
        readFileSync(join(sessionDir, files[i]), "utf-8"),
      );
      expect(content.id).toBe(i + 1);
    }

    globalThis.fetch = originalFetch;
  });
});

// =============================================================================
// ST1: Real plugin SDK hooks lifecycle via entrypoint(input)
// =============================================================================
// Constructs the plugin through the real SDK entrypoint with a mocked
// PluginInput, then exercises the actually-wired hooks (`event`,
// `tool.execute.after`, `config`, `tool.trace_on/trace_off/trace_status`).
// Verifies real side effects on disk: session dir, metadata.json, config.json,
// subSessions array, and effective enabled state.
//
// The plugin DOES wire `chat.message`, `chat.params`, and `tool.execute.before`
// (they just `logger.info` and return — they do not change the existing flow).
// =============================================================================
describe("ST1: real plugin SDK hooks lifecycle (entrypoint + PluginInput)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-st1-"));
    process.env._INTEGRATION_TEST_DIR_ = tempDir;
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    delete process.env._INTEGRATION_TEST_DIR_;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("entrypoint.server returns wired hooks, and the wired hooks have real side effects", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: tempDir,
      worktree: tempDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    // Wired hooks per trace.ts
    expect(hooks.event).toBeDefined();
    expect(hooks["tool.execute.after"]).toBeDefined();
    expect(hooks.config).toBeDefined();
    expect(hooks["command.execute.before"]).toBeDefined();
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!.trace_on).toBeDefined();
    expect(hooks.tool!.trace_off).toBeDefined();
    expect(hooks.tool!.trace_status).toBeDefined();

    // Wired: chat.message / chat.params / tool.execute.before (logger.info only,
    // no state change). Assert they exist and are functions.
    expect(typeof (hooks as any)["chat.message"]).toBe("function");
    expect(typeof (hooks as any)["chat.params"]).toBe("function");
    expect(typeof (hooks as any)["tool.execute.before"]).toBe("function");

    // Step 1: `event` hook with session.created creates the session dir and metadata.
    const parentId = "st1-parent-session";
    await hooks.event!({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: parentId,
            projectID: "p",
            directory: tempDir,
            title: "ST1 Parent",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    const globalTraceDir = join(tempDir, ".opencode-trace");
    const parentSessionDir = join(globalTraceDir, parentId);
    expect(existsSync(parentSessionDir)).toBe(true);

    const parentMetaPath = join(parentSessionDir, "metadata.json");
    expect(existsSync(parentMetaPath)).toBe(true);
    const parentMeta = JSON.parse(readFileSync(parentMetaPath, "utf-8"));
    expect(parentMeta.title).toBe("ST1 Parent");
    expect(parentMeta.folderPath).toBe(tempDir);

    // global config.json is initialized by initStateManager()
    expect(existsSync(join(globalTraceDir, "config.json"))).toBe(true);

    // Step 2: `config` hook registers the /trace command
    const cfgIn: any = {};
    await hooks.config!(cfgIn);
    expect(cfgIn.command?.trace?.description).toMatch(/Control trace recording/);

    // Step 3: tool.trace_on enables session
    const onResult = await hooks.tool!.trace_on!.execute(
      {},
      { sessionID: parentId } as any,
    );
    expect(String(onResult)).toContain("Trace enabled for session");

    // Step 4: tool.trace_status reflects new effective state for session
    const statusResult = await hooks.tool!.trace_status!.execute(
      {},
      { sessionID: parentId } as any,
    );
    expect(String(statusResult)).toContain("Trace Status");
    expect(String(statusResult)).toContain("Session : ON");
    expect(String(statusResult)).toMatch(/Effective: (RECORDING|PAUSED)/);

    // Step 5: tool.trace_off disables the session again
    const offResult = await hooks.tool!.trace_off!.execute(
      {},
      { sessionID: parentId } as any,
    );
    expect(String(offResult)).toContain("Trace disabled for session");
  });
});

// =============================================================================
// ST2: SSE (text/event-stream) roundtrip
// =============================================================================
// Mocks fetch to return a `ReadableStream` of SSE chunks, calls tracedFetch
// with `stream: true` body, and verifies:
//   - Response stream is still drainable by the caller and yields the same chunks
//   - __latencyMeta is attached to the wrapped Response
//   - firstTokenAt/lastTokenAt become populated as chunks flow through
//   - Persisted {seq}.json record carries those latency fields
//
// NOTE: The plugin does NOT currently write a raw `1.sse` file even though the
// README documents one — only `{seq}.json` and `{seq}.parsed` are emitted.
// =============================================================================
describe("ST2: SSE stream roundtrip", () => {
  let tempDir: string;
  let plugin: TracePlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-st2-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    await plugin.initStateManager();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("stream body is drained by caller and latency fields land in {seq}.json", async () => {
    const encoder = new TextEncoder();
    const sseChunks = [
      'data: {"delta":"Hello"}\n\n',
      'data: {"delta":" world"}\n\n',
      "data: [DONE]\n\n",
    ];

    const mockFetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          for (const c of sseChunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    globalThis.fetch = mockFetch as any;

    plugin.installInterceptor();

    const sessionId = "st2-sse";
    plugin.getStateManager()!.startSession(sessionId);
    plugin.getGlobalConfigManager()!.setSessionEnabled(sessionId, true);

    const res = await plugin.tracedFetch(
      "https://api.example.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencode-session": sessionId,
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    // __latencyMeta should be present BEFORE consumption
    const latencyBefore = (res as any).__latencyMeta;
    expect(latencyBefore).toBeDefined();
    expect(typeof latencyBefore.requestSentAt).toBe("number");
    expect(latencyBefore.firstTokenAt).toBeNull();
    expect(latencyBefore.lastTokenAt).toBeNull();

    // Drain the body as a downstream caller would
    const reader = res.body!.getReader();
    const received: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(value!);
    }

    // Caller received the same chunks the mock emitted
    expect(received.length).toBe(sseChunks.length);
    const decoder = new TextDecoder();
    const reassembled = received.map((c) => decoder.decode(c)).join("");
    expect(reassembled).toBe(sseChunks.join(""));

    // After draining, latency fields should be populated
    const latencyAfter = (res as any).__latencyMeta;
    expect(latencyAfter.firstTokenAt).not.toBeNull();
    expect(latencyAfter.lastTokenAt).not.toBeNull();
    expect(latencyAfter.lastTokenAt).toBeGreaterThanOrEqual(
      latencyAfter.firstTokenAt,
    );

    await plugin.flush();

    const sessionDir = join(tempDir, sessionId);
    await waitForFiles(sessionDir, 1);
    const recordPath = join(sessionDir, "1.json");
    const record = JSON.parse(readFileSync(recordPath, "utf-8"));

    expect(record.id).toBe(1);
    expect(record.requestSentAt).toBeDefined();
    expect(typeof record.firstTokenAt).toBe("number");
    expect(typeof record.lastTokenAt).toBe("number");
    expect(record.lastTokenAt).toBeGreaterThanOrEqual(record.firstTokenAt);
  });
});

// =============================================================================
// ST3: parentID / subSessions chain from tool.execute.after
// =============================================================================
// Verifies what the `tool.execute.after` hook actually does for the "task" tool:
// it appends the child session id to the PARENT's metadata.json `subSessions`
// array, AND eagerly writes the child's metadata.json with `parentID` set so
// the child is linked immediately, regardless of whether `session.created`
// arrives for it later. We assert both behaviors so the contract is locked in.
// =============================================================================
describe("ST3: subSessions chain from tool.execute.after", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-st3-"));
    process.env._INTEGRATION_TEST_DIR_ = tempDir;
    _resetForTesting();
  });

  afterEach(() => {
    _resetForTesting();
    delete process.env._INTEGRATION_TEST_DIR_;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("tool.execute.after task appends to parent.subSessions AND eagerly sets child.parentID", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: tempDir,
      worktree: tempDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const parentId = "st3-parent";
    const childId = "st3-child";

    // Create the parent session via the event hook
    await hooks.event!({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: parentId,
            projectID: "p",
            directory: tempDir,
            title: "Parent",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    // Simulate a Task tool returning a child sessionID in its metadata
    await hooks["tool.execute.after"]!(
      {
        tool: "task",
        sessionID: parentId,
        callID: "call-1",
        args: { description: "spawn child", prompt: "go" },
      } as any,
      {
        title: "Task done",
        output: "ok",
        metadata: { session_id: childId },
      } as any,
    );

    const globalTraceDir = join(tempDir, ".opencode-trace");
    const parentMetaPath = join(globalTraceDir, parentId, "metadata.json");
    await waitForFile(parentMetaPath);
    const parentMeta = JSON.parse(readFileSync(parentMetaPath, "utf-8"));
    expect(Array.isArray(parentMeta.subSessions)).toBe(true);
    expect(parentMeta.subSessions).toContain(childId);

    // The child's metadata.json IS eagerly created by tool.execute.after with
    // parentID set, so the link is race-free and survives missing session.created.
    const childMetaPath = join(globalTraceDir, childId, "metadata.json");
    expect(existsSync(childMetaPath)).toBe(true);
    const eagerChildMeta = JSON.parse(readFileSync(childMetaPath, "utf-8"));
    expect(eagerChildMeta.parentID).toBe(parentId);

    // Now simulate the child's own session.created event carrying parentID.
    // This is idempotent: parentID is already correct, and addSubSession
    // dedupes so the parent's subSessions array still has the child exactly once.
    const childEvent: any = {
      type: "session.created",
      properties: {
        info: {
          id: childId,
          projectID: "p",
          directory: tempDir,
          title: "Child",
          parentID: parentId,
          version: "1.0",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    };
    await hooks.event!({ event: childEvent });

    const childMeta = JSON.parse(readFileSync(childMetaPath, "utf-8"));
    expect(childMeta.parentID).toBe(parentId);
    expect(childMeta.title).toBe("Child");

    // The parent still has the child listed exactly once (idempotent).
    const parentMeta2 = JSON.parse(readFileSync(parentMetaPath, "utf-8"));
    expect(parentMeta2.subSessions.filter((s: string) => s === childId).length).toBe(1);

    // Sanity: non-"task" tool with metadata.session_id does NOTHING.
    const noopChildId = "st3-noop-child";
    await hooks["tool.execute.after"]!(
      {
        tool: "bash",
        sessionID: parentId,
        callID: "call-2",
        args: { command: "ls" },
      } as any,
      {
        title: "Ran bash",
        output: "",
        metadata: { session_id: noopChildId },
      } as any,
    );
    const parentMeta3 = JSON.parse(readFileSync(parentMetaPath, "utf-8"));
    expect(parentMeta3.subSessions).not.toContain(noopChildId);
    const noopChildPath = join(globalTraceDir, noopChildId, "metadata.json");
    expect(existsSync(noopChildPath)).toBe(false);
  });
});

// =============================================================================
// ST4: corrupted {seq}.json record on disk does not crash later requests
// =============================================================================
// The plugin keeps `seq` in memory (this.ids Map), not on disk, so a corrupted
// file should not affect new writes. We do one successful request (seq=1),
// corrupt 1.json in-place, then trigger another request and verify seq=2 is
// written cleanly and the plugin process survives.
// =============================================================================
describe("ST4: corrupted record recovery", () => {
  let tempDir: string;
  let plugin: TracePlugin;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-st4-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    await plugin.initStateManager();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("a corrupted prior record does not break subsequent writes", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ ok: true, call: callCount }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;

    plugin.installInterceptor();

    const sessionId = "st4-corrupt";
    plugin.getStateManager()!.startSession(sessionId);
    plugin.getGlobalConfigManager()!.setSessionEnabled(sessionId, true);

    // First request — should land as 1.json with valid JSON
    const r1 = await plugin.tracedFetch("https://example.com/a", {
      method: "GET",
      headers: { "x-opencode-session": sessionId },
    });
    expect(r1.status).toBe(200);
    await plugin.flush();

    const sessionDir = join(tempDir, sessionId);
    await waitForFiles(sessionDir, 1);

    const file1 = join(sessionDir, "1.json");
    expect(existsSync(file1)).toBe(true);

    // Corrupt the existing 1.json
    writeFileSync(file1, "not valid json {{{ definitely broken", "utf-8");
    expect(() => JSON.parse(readFileSync(file1, "utf-8"))).toThrow();

    // Second request should produce 2.json cleanly without throwing
    const r2 = await plugin.tracedFetch("https://example.com/b", {
      method: "GET",
      headers: { "x-opencode-session": sessionId },
    });
    expect(r2.status).toBe(200);
    await plugin.flush();

    // Don't use waitForFiles here: 1.json is now corrupted, so the
    // "all files valid" precondition would never hold. Wait specifically
    // for 2.json instead.
    const file2 = join(sessionDir, "2.json");
    await waitForFile(file2);
    expect(existsSync(file2)).toBe(true);
    const record2 = JSON.parse(readFileSync(file2, "utf-8"));
    expect(record2.id).toBe(2);
    expect(record2.response.status).toBe(200);
    expect(record2.request.url).toBe("https://example.com/b");

    // The corrupted 1.json is left untouched — plugin never re-reads it
    const stillCorrupt = readFileSync(file1, "utf-8");
    expect(stillCorrupt).toBe("not valid json {{{ definitely broken");

    // No fallback dir created because no rename actually failed
    expect(existsSync(join(tempDir, "fallback"))).toBe(false);
  });
});

// =============================================================================
// ST5: Windows-style transient rename failure is retried by safeRename
// =============================================================================
// Spies on fs.promises.rename and throws an EPERM-like error on the first call,
// then lets the real rename through on subsequent calls. Verifies:
//   - The .tmp file ends up renamed to the final {seq}.json
//   - No .tmp leftover
//   - No fallback file (because retry succeeded)
//
// NOTE: safeRename currently retries SILENTLY — it does not call logger.warn
// on each retry. The task description anticipates a warn log; we assert the
// observed behavior and surface this gap in the report.
// =============================================================================
describe("ST5: Windows rename retry", () => {
  let tempDir: string;
  let plugin: TracePlugin;
  let originalFetch: typeof globalThis.fetch;
  let renameSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-st5-"));
    plugin = new TracePlugin({ globalDir: tempDir, localDir: tempDir });
    await plugin.initStateManager();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    plugin.uninstallInterceptor();
    globalThis.fetch = originalFetch;
    if (renameSpy) {
      renameSpy.mockRestore();
      renameSpy = null;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("fs.rename throwing EPERM once is recovered transparently by safeRename", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as any;

    // Spy on the real fs.promises.rename. Throw EPERM the first time it is
    // called for OUR session dir, then call through on every subsequent
    // invocation. Tests for OTHER sessions in parallel files share the same
    // singleton — so we scope by destination path.
    const realRename = fs.rename.bind(fs);
    const sessionId = "st5-rename-retry";
    const sessionDir = join(tempDir, sessionId);
    let throwsRemaining = 1;

    renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (src: any, dest: any) => {
        const destStr = String(dest);
        if (throwsRemaining > 0 && destStr.startsWith(sessionDir)) {
          throwsRemaining--;
          const err: NodeJS.ErrnoException = new Error(
            "EPERM: simulated transient lock",
          );
          err.code = "EPERM";
          throw err;
        }
        return realRename(src, dest);
      });

    plugin.installInterceptor();
    plugin.getStateManager()!.startSession(sessionId);
    plugin.getGlobalConfigManager()!.setSessionEnabled(sessionId, true);

    const res = await plugin.tracedFetch("https://example.com/x", {
      method: "GET",
      headers: { "x-opencode-session": sessionId },
    });
    expect(res.status).toBe(200);

    await plugin.flush();
    // Give safeRename's 50ms backoff a window plus a bit
    await new Promise((r) => setTimeout(r, 200));
    await waitForFiles(sessionDir, 1);

    // The first rename for our session was thrown
    const renameCalls = renameSpy.mock.calls.filter((c: unknown[]) =>
      String(c[1]).startsWith(sessionDir),
    );
    expect(renameCalls.length).toBeGreaterThanOrEqual(2);

    // Final {seq}.json exists and parses; no .tmp leftover
    const finalPath = join(sessionDir, "1.json");
    expect(existsSync(finalPath)).toBe(true);
    const rec = JSON.parse(readFileSync(finalPath, "utf-8"));
    expect(rec.id).toBe(1);
    expect(existsSync(join(sessionDir, "1.json.tmp"))).toBe(false);

    // Retry succeeded → no fallback file should have been emitted
    expect(existsSync(join(tempDir, "fallback"))).toBe(false);
  });
});
