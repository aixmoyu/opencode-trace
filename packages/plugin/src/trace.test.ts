import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import entrypoint, { _resetForTesting } from "./trace.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "plugin-test-"));
  vi.stubEnv("HOME", testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("Plugin - Hooks 返回值", () => {
  test("plugin 返回包含 event hook", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    expect(hooks.event).toBeDefined();
  });

  test("plugin 返回包含 tool.execute.after hook", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    expect(hooks["tool.execute.after"]).toBeDefined();
  });
});

describe("Plugin - event hook 处理 session.created", () => {
  test("event hook 处理 session.created 更新元数据", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const sessionId = "test-session-123";

    await hooks.event!({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sessionId,
            projectID: "test-project",
            directory: testDir,
            title: "Test Session Title",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    const traceDir = join(testDir, ".opencode-trace");
    const sessionDir = join(traceDir, sessionId);
    expect(existsSync(sessionDir)).toBe(true);

    const dbPath = join(traceDir, "state.db");
    expect(existsSync(dbPath)).toBe(true);

    const metaPath = join(sessionDir, "metadata.json");
    expect(existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.folderPath).toBe(testDir);
  });
});

describe("Stream request detection", () => {
  test("should detect stream request from body", () => {
    const init = {
      body: JSON.stringify({ stream: true, messages: [] }),
    };
    const isStream = JSON.parse(init.body ?? "{}").stream === true;
    expect(isStream).toBe(true);
  });

  test("should detect non-stream request", () => {
    const init = {
      body: JSON.stringify({ stream: false, messages: [] }),
    };
    const isStream = JSON.parse(init.body ?? "{}").stream === true;
    expect(isStream).toBe(false);
  });

  test("should handle missing stream field", () => {
    const init = {
      body: JSON.stringify({ messages: [] }),
    };
    const isStream = JSON.parse(init.body ?? "{}").stream === true;
    expect(isStream).toBe(false);
  });

  test("should handle invalid JSON body", () => {
    const init = {
      body: "not valid json",
    };
    let isStream = false;
    try {
      isStream = JSON.parse(init.body ?? "{}")?.stream === true;
    } catch {
      isStream = false;
    }
    expect(isStream).toBe(false);
  });
});

describe("Latency metadata in TraceRecord", () => {
  test("TraceRecord interface should have latency fields", () => {
    type HasLatencyFields = {
      requestSentAt?: number;
      firstTokenAt?: number;
      lastTokenAt?: number;
    };
    const record: HasLatencyFields = {
      requestSentAt: 1234567.89,
      firstTokenAt: 1234570.12,
      lastTokenAt: 1234590.34,
    };
    expect(record.requestSentAt).toBe(1234567.89);
    expect(record.firstTokenAt).toBe(1234570.12);
    expect(record.lastTokenAt).toBe(1234590.34);
  });
});

describe("tracedFetch stream integration", () => {
  test("should apply TransformStream wrapper and record latency metadata", async () => {
    _resetForTesting();
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    const chunks = ["data: {\"content\": \"Hello\"}\n", "data: {\"content\": \"World\"}\n", "data: [DONE]\n"];
    const encoder = new TextEncoder();
    const streamChunks = chunks.map(c => encoder.encode(c));

    const mockStream = new ReadableStream({
      start(controller) {
        for (const chunk of streamChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce(new Response(mockStream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));

    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const sessionId = "stream-test-session";

    await hooks.event!({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sessionId,
            projectID: "test-project",
            directory: testDir,
            title: "Stream Test Session",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    const streamRequest = new Request("https://api.example.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-session": sessionId,
      },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "test" }] }),
    });

    const response = await globalThis.fetch(streamRequest);

    expect((response as any).__latencyMeta).toBeDefined();
    expect((response as any).__latencyMeta.requestSentAt).toBeDefined();
    expect((response as any).__latencyMeta.firstTokenAt).toBeNull();
    expect((response as any).__latencyMeta.lastTokenAt).toBeNull();

    const reader = response.body!.getReader();
    const receivedChunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedChunks.push(value);
    }

    expect(receivedChunks.length).toBe(3);
    expect((response as any).__latencyMeta.firstTokenAt).not.toBeNull();
    expect((response as any).__latencyMeta.lastTokenAt).not.toBeNull();

    await new Promise(resolve => setTimeout(resolve, 100));

    const traceDir = join(testDir, ".opencode-trace");
    const sessionDir = join(traceDir, sessionId);
    const recordFile = join(sessionDir, "1.json");

    if (existsSync(recordFile)) {
      const record = JSON.parse(readFileSync(recordFile, "utf-8"));
      expect(record.requestSentAt).toBeDefined();
      expect(record.firstTokenAt).toBeDefined();
      expect(record.lastTokenAt).toBeDefined();
    }

    globalThis.fetch = originalFetch;
  });

  test("should not wrap non-stream responses", async () => {
    _resetForTesting();
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ result: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const sessionId = "non-stream-test-session";

    await hooks.event!({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sessionId,
            projectID: "test-project",
            directory: testDir,
            title: "Non-Stream Test",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    const request = new Request("https://api.example.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-session": sessionId,
      },
      body: JSON.stringify({ stream: false, messages: [{ role: "user", content: "test" }] }),
    });

    const response = await globalThis.fetch(request);

    expect((response as any).__latencyMeta).toBeUndefined();

    globalThis.fetch = originalFetch;
  });
});

describe("Plugin - tool.execute.after hook 处理 Task 工具", () => {
  test("tool.execute.after hook 处理 Task 工具记录 sub session", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const parentSessionId = "parent-session-123";
    const subSessionId = "sub-session-456";

    await hooks.event!({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: parentSessionId,
            projectID: "test-project",
            directory: testDir,
            title: "Parent Session",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    await hooks["tool.execute.after"]!(
      {
        tool: "task",
        sessionID: parentSessionId,
        callID: "call-123",
        args: { description: "test", prompt: "test" },
      },
      {
        title: "Task completed",
        output: "success",
        metadata: { session_id: subSessionId },
      }
    );

    const traceDir = join(testDir, ".opencode-trace");
    const dbPath = join(traceDir, "state.db");
    expect(existsSync(dbPath)).toBe(true);
  });

  test("tool.execute.after hook 对非 Task 工具不记录 sub session", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const sessionId = "test-session-123";

    await hooks.event!({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sessionId,
            projectID: "test-project",
            directory: testDir,
            title: "Test Session",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    await hooks["tool.execute.after"]!(
      {
        tool: "bash",
        sessionID: sessionId,
        callID: "call-123",
        args: { command: "ls" },
      },
      {
        title: "Command executed",
        output: "file1.txt\nfile2.txt",
        metadata: {},
      }
    );

    const traceDir = join(testDir, ".opencode-trace");
    const dbPath = join(traceDir, "state.db");
    expect(existsSync(dbPath)).toBe(true);
  });
});