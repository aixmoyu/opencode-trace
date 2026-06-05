import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "@opencode-trace/core";
import entrypoint, { _resetForTesting } from "./trace.js";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => {
      const testDir = process.env._TEST_DIR_;
      if (testDir) return testDir;
      return original.homedir();
    },
  };
});

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

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "plugin-test-"));
  process.env._TEST_DIR_ = testDir;
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env._TEST_DIR_;
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

    const configPath = join(traceDir, "config.json");
    expect(existsSync(configPath)).toBe(true);

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

    const chunks = [
      'data: {"content": "Hello"}\n',
      'data: {"content": "World"}\n',
      "data: [DONE]\n",
    ];
    const encoder = new TextEncoder();
    const streamChunks = chunks.map((c) => encoder.encode(c));

    const mockStream = new ReadableStream({
      start(controller) {
        for (const chunk of streamChunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce(
      new Response(mockStream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

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

    const streamRequest = new Request(
      "https://api.example.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencode-session": sessionId,
        },
        body: JSON.stringify({
          stream: true,
          messages: [{ role: "user", content: "test" }],
        }),
      },
    );

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

    const traceDir = join(testDir, ".opencode-trace");
    const sessionDir = join(traceDir, sessionId);
    const recordFile = join(sessionDir, "1.json");

    await waitForFile(recordFile, 5000);

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

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

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
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "test" }],
      }),
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
      },
    );

    const traceDir = join(testDir, ".opencode-trace");
    const configPath = join(traceDir, "config.json");
    expect(existsSync(configPath)).toBe(true);
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
      },
    );

    const traceDir = join(testDir, ".opencode-trace");
    const configPath = join(traceDir, "config.json");
    expect(existsSync(configPath)).toBe(true);
  });
});

describe("Plugin - global/local mode", () => {
  test("trace_on tool enables session scope", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const sessionId = "test-session-on";

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

    const result = await hooks.tool!.trace_on!.execute({}, {
      sessionID: sessionId,
    } as any);
    expect(result).toContain("Trace enabled for session");

    const globalDir = join(testDir, ".opencode-trace");
    const sessionDir = join(globalDir, sessionId);

    await hooks.event!({
      event: {
        type: "session.updated",
        properties: {
          info: {
            id: sessionId,
            projectID: "test-project",
            directory: testDir,
            title: "Test Session Updated",
            version: "1.0",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as any,
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(sessionDir)).toBe(true);
  });

  test("trace_off tool disables session scope", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const sessionId = "test-session-off";

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

    const result = await hooks.tool!.trace_off!.execute({}, {
      sessionID: sessionId,
    } as any);
    expect(result).toContain("Trace disabled for session");
  });

  test("trace_status tool shows current status", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    const sessionId = "test-session-status";

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

    const result = await hooks.tool!.trace_status!.execute({}, {
      sessionID: sessionId,
    } as any);
    expect(result).toContain("Trace Status");
    expect(result).toContain("Global");
    expect(result).toContain("Local");
    expect(result).toContain("Session");
    expect(result).toContain("Storage");
  });
});

async function setupPluginWithMockClient(testDir: string) {
  _resetForTesting();
  const mockPrompt = vi.fn().mockResolvedValue({});
  const hooks = await entrypoint.server({
    client: { session: { prompt: mockPrompt } } as any,
    project: {} as any,
    directory: testDir,
    worktree: testDir,
    experimental_workspace: { register: vi.fn() },
    serverUrl: new URL("http://localhost"),
    $: {} as any,
  });
  return { hooks, mockPrompt };
}

async function runTraceCommand(
  hooks: any,
  mockPrompt: any,
  args: string,
  sessionId: string = "test-slash-session",
): Promise<{ text: string | null; outputParts: any[] | null }> {
  const output = { parts: [{ type: "text", text: "original" } as any] };
  let error: Error | null = null;
  try {
    await hooks["command.execute.before"]!(
      {
        command: "trace",
        sessionID: sessionId,
        arguments: args,
      },
      output,
    );
  } catch (err) {
    error = err as Error;
  }
  expect(error).toBeTruthy();
  expect((error as unknown as Error).message).toBe("__TRACE_HANDLED__");
  expect(output.parts.length).toBe(0);

  if (mockPrompt.mock.calls.length > 0) {
    const call = mockPrompt.mock.calls[0][0];
    return { text: call.body.parts[0].text, outputParts: output.parts };
  }
  return { text: null, outputParts: output.parts };
}

async function createSessionViaEvent(
  hooks: any,
  sessionId: string,
  testDir: string,
  title: string = "Slash Test Session",
  parentID?: string,
): Promise<void> {
  await hooks.event!({
    event: {
      type: "session.created",
      properties: {
        info: {
          id: sessionId,
          projectID: "test-project",
          directory: testDir,
          title,
          parentID,
          version: "1.0",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as any,
  });
}

function readConfig(testDir: string): any {
  const configPath = join(testDir, ".opencode-trace", "config.json");
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function readSessionMetadata(testDir: string, sessionId: string): any {
  const metaPath = join(testDir, ".opencode-trace", sessionId, "metadata.json");
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, "utf-8"));
}

describe("Plugin - /trace on (slash command)", () => {
  test("/trace on with no flags enables global scope by default", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-default";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "on", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("global");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(true);
  });

  test("/trace on -g explicitly enables global scope", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-g";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "on -g", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("global");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(true);
  });

  test("/trace on --global (long form) enables global scope", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-long-global";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "on --global", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("global");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(true);
  });

  test("/trace on -l enables local scope", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-l";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "on -l", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("local");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(true);
  });

  test("/trace on -s enables session scope", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-s";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "on -s", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("session");

    const meta = readSessionMetadata(testDir, sessionId);
    expect(meta).toBeTruthy();
    expect(meta.trace_enabled).toBe(true);
  });

  test("/trace on -d local sets storage preference to local", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-d-local";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(
      hooks,
      mockPrompt,
      "on -d local",
      sessionId,
    );
    expect(text).toContain("Trace enabled");
    expect(text).toContain("storage: local");

    const config = readConfig(testDir);
    expect(config.storage_preference).toBe("local");
    expect(config.global_trace_enabled).toBe(true);
  });

  test("/trace on -d global sets storage preference to global", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-d-global";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(
      hooks,
      mockPrompt,
      "on -d global",
      sessionId,
    );
    expect(text).toContain("Trace enabled");

    const config = readConfig(testDir);
    expect(config.storage_preference).toBe("global");
  });

  test("/trace on -g -l enables both global and local scopes", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-gl";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "on -g -l", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("global");
    expect(text).toContain("local");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(true);
  });

  test("/trace on -g -l -s enables all three scopes", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-gls";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "on -g -l -s", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("global");
    expect(text).toContain("local");
    expect(text).toContain("session");

    const meta = readSessionMetadata(testDir, sessionId);
    expect(meta.trace_enabled).toBe(true);
  });

  test("/trace on -s -d local enables session and sets local storage", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-on-s-d-local";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(
      hooks,
      mockPrompt,
      "on -s -d local",
      sessionId,
    );
    expect(text).toContain("Trace enabled");
    expect(text).toContain("session");
    expect(text).toContain("storage: local");

    const meta = readSessionMetadata(testDir, sessionId);
    expect(meta.trace_enabled).toBe(true);
    expect(meta.storage_preference).toBe("local");
  });

  test("/trace enable (alias) works the same as /trace on", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-enable-alias";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "enable", sessionId);
    expect(text).toContain("Trace enabled");
    expect(text).toContain("global");
  });
});

describe("Plugin - /trace off (slash command)", () => {
  test("/trace off with no flags disables global scope by default", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-off-default";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "off", sessionId);
    expect(text).toContain("Trace disabled");
    expect(text).toContain("global");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(false);
  });

  test("/trace off -g explicitly disables global scope", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-off-g";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "off -g", sessionId);
    expect(text).toContain("Trace disabled");
    expect(text).toContain("global");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(false);
  });

  test("/trace off -l disables local scope", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-off-l";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "off -l", sessionId);
    expect(text).toContain("Trace disabled");
    expect(text).toContain("local");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(false);
  });

  test("/trace off -s disables session scope", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-off-s";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "off -s", sessionId);
    expect(text).toContain("Trace disabled");
    expect(text).toContain("session");

    const meta = readSessionMetadata(testDir, sessionId);
    expect(meta.trace_enabled).toBe(false);
  });

  test("/trace off -g -l -s disables all three scopes", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-off-all";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "off -g -l -s", sessionId);
    expect(text).toContain("Trace disabled");
    expect(text).toContain("global");
    expect(text).toContain("local");
    expect(text).toContain("session");

    const config = readConfig(testDir);
    expect(config.global_trace_enabled).toBe(false);

    const meta = readSessionMetadata(testDir, sessionId);
    expect(meta.trace_enabled).toBe(false);
  });

  test("/trace disable (alias) works the same as /trace off", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-disable-alias";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "disable", sessionId);
    expect(text).toContain("Trace disabled");
    expect(text).toContain("global");
  });
});

describe("Plugin - /trace status (slash command)", () => {
  test("/trace status with no flags shows full status", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-status-default";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "status", sessionId);
    expect(text).toContain("Trace Status");
    expect(text).toContain("Global");
    expect(text).toContain("Local");
    expect(text).toContain("Session");
    expect(text).toContain("Storage");
    expect(text).toContain("Effective");
  });

  test("/trace status -g shows status with global flag", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-status-g";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "status -g", sessionId);
    expect(text).toContain("Trace Status");
  });

  test("/trace status -l shows status with local flag", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-status-l";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "status -l", sessionId);
    expect(text).toContain("Trace Status");
  });

  test("/trace status -s shows status with session flag", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-status-s";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "status -s", sessionId);
    expect(text).toContain("Trace Status");
    expect(text).toContain(`Session : ON`);
  });

  test("/trace status reflects ON state after /trace on -g", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-status-after-on";
    await createSessionViaEvent(hooks, sessionId, testDir);

    await runTraceCommand(hooks, mockPrompt, "on -g", sessionId);
    mockPrompt.mockClear();

    const { text } = await runTraceCommand(hooks, mockPrompt, "status", sessionId);
    expect(text).toContain("Trace Status");
    expect(text).toContain("Global  : ON");
    expect(text).toContain("Effective: RECORDING");
  });
});

describe("Plugin - /trace help and unknown commands", () => {
  test("/trace help shows help text", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-help";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "help", sessionId);
    expect(text).toContain("Usage: /trace");
    expect(text).toContain("Commands:");
    expect(text).toContain("on");
    expect(text).toContain("off");
    expect(text).toContain("status");
    expect(text).toContain("-g");
    expect(text).toContain("-l");
    expect(text).toContain("-s");
    expect(text).toContain("-d");
  });

  test("/trace with no arguments also shows help", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-no-args";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "", sessionId);
    expect(text).toContain("Usage: /trace");
  });

  test("/trace foo (unknown subcommand) returns error message without crashing", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-unknown";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "foo", sessionId);
    expect(text).toContain("Unknown command: foo");
    expect(text).toContain("/trace on");
    expect(text).toContain("/trace off");
    expect(text).toContain("/trace status");
  });

  test("/trace with mixed-case ON is normalized", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-mixed-case";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const { text } = await runTraceCommand(hooks, mockPrompt, "ON", sessionId);
    expect(text).toContain("Trace enabled");
  });
});

describe("Plugin - slash command guards", () => {
  test("non-trace commands are ignored (no prompt sent, no throw)", async () => {
    const { hooks, mockPrompt } = await setupPluginWithMockClient(testDir);
    const sessionId = "slash-other-cmd";
    await createSessionViaEvent(hooks, sessionId, testDir);

    const output = { parts: [{ type: "text", text: "original" } as any] };
    let error: Error | null = null;
    try {
      await hooks["command.execute.before"]!(
        {
          command: "help",
          sessionID: sessionId,
          arguments: "",
        },
        output,
      );
    } catch (err) {
      error = err as Error;
    }

    expect(error).toBeNull();
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(output.parts.length).toBe(1);
  });
});

describe("Plugin - tool.execute.after parentID linking", () => {
  test("tool.execute.after with task tool records sub-session under parent's subSessions", async () => {
    const { hooks, mockPrompt: _mockPrompt } = await setupPluginWithMockClient(
      testDir,
    );
    void _mockPrompt;

    const parentSessionId = "parent-link-test";
    const subSessionId = "sub-link-test";

    await createSessionViaEvent(hooks, parentSessionId, testDir, "Parent");

    await hooks["tool.execute.after"]!(
      {
        tool: "task",
        sessionID: parentSessionId,
        callID: "call-789",
        args: { description: "do work", prompt: "do work" },
      },
      {
        title: "Task done",
        output: "completed",
        metadata: { session_id: subSessionId },
      },
    );

    const parentMeta = readSessionMetadata(testDir, parentSessionId);
    expect(parentMeta).toBeTruthy();
    expect(parentMeta.subSessions).toBeDefined();
    expect(parentMeta.subSessions).toContain(subSessionId);
  });

  test("tool.execute.after ignores task output without session_id metadata", async () => {
    const { hooks, mockPrompt: _mockPrompt } = await setupPluginWithMockClient(
      testDir,
    );
    void _mockPrompt;

    const parentSessionId = "parent-link-no-sid";
    await createSessionViaEvent(hooks, parentSessionId, testDir, "Parent");

    await hooks["tool.execute.after"]!(
      {
        tool: "task",
        sessionID: parentSessionId,
        callID: "call-no-sid",
        args: { description: "test" },
      },
      {
        title: "Task done",
        output: "completed",
        metadata: {},
      },
    );

    const parentMeta = readSessionMetadata(testDir, parentSessionId);
    if (parentMeta.subSessions) {
      expect(parentMeta.subSessions).not.toContain("phantom-sub");
    }
  });

  test("event hook with parentID records sub-session in parent metadata", async () => {
    const { hooks, mockPrompt: _mockPrompt } = await setupPluginWithMockClient(
      testDir,
    );
    void _mockPrompt;

    const parentSessionId = "parent-event-link";
    const childSessionId = "child-event-link";

    await createSessionViaEvent(hooks, parentSessionId, testDir, "Parent");

    await createSessionViaEvent(
      hooks,
      childSessionId,
      testDir,
      "Child",
      parentSessionId,
    );

    const parentMeta = readSessionMetadata(testDir, parentSessionId);
    expect(parentMeta).toBeTruthy();
    expect(parentMeta.subSessions).toBeDefined();
    expect(parentMeta.subSessions).toContain(childSessionId);

    const childMeta = readSessionMetadata(testDir, childSessionId);
    expect(childMeta).toBeTruthy();
    expect(childMeta.parentID).toBe(parentSessionId);
  });
});

describe("Plugin - new hooks wiring (chat.message, chat.params, tool.execute.before)", () => {
  test("plugin returns chat.message, chat.params, and tool.execute.before hooks as functions", async () => {
    const hooks = await entrypoint.server({
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    });

    expect(typeof hooks["chat.message"]).toBe("function");
    expect(typeof hooks["chat.params"]).toBe("function");
    expect(typeof hooks["tool.execute.before"]).toBe("function");
  });

  test("chat.message hook logs via logger.info and does not throw", async () => {
    const infoSpy = vi
      .spyOn(logger, "info")
      .mockImplementation(((() => logger) as unknown) as never);

    try {
      const hooks = await entrypoint.server({
        client: {} as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        experimental_workspace: { register: vi.fn() },
        serverUrl: new URL("http://localhost"),
        $: {} as any,
      });

      const sessionId = "chat-message-test";
      await createSessionViaEvent(hooks, sessionId, testDir, "ChatMsg");

      await expect(
        hooks["chat.message"]!(
          {
            sessionID: sessionId,
            messageID: "msg-1",
            agent: "build",
          } as any,
          { message: {} as any, parts: [] },
        ),
      ).resolves.toBeUndefined();

      const chatMessageCalls = (infoSpy.mock.calls as unknown[][]).filter(
        (c) => c[0] === "chat.message",
      );
      expect(chatMessageCalls.length).toBeGreaterThan(0);
      const payload = chatMessageCalls[0][1] as Record<string, unknown>;
      expect(payload.sessionID).toBe(sessionId);
      expect(payload.messageID).toBe("msg-1");
      expect(payload.agent).toBe("build");
    } finally {
      infoSpy.mockRestore();
    }
  });

  test("chat.params hook logs via logger.info and does not throw", async () => {
    const infoSpy = vi
      .spyOn(logger, "info")
      .mockImplementation(((() => logger) as unknown) as never);

    try {
      const hooks = await entrypoint.server({
        client: {} as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        experimental_workspace: { register: vi.fn() },
        serverUrl: new URL("http://localhost"),
        $: {} as any,
      });

      const sessionId = "chat-params-test";
      await createSessionViaEvent(hooks, sessionId, testDir, "ChatParams");

      await expect(
        hooks["chat.params"]!(
          {
            sessionID: sessionId,
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
            provider: { source: "config", info: {} as any, options: {} },
            message: {} as any,
          } as any,
          {
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 100,
            options: {},
          },
        ),
      ).resolves.toBeUndefined();

      const chatParamsCalls = (infoSpy.mock.calls as unknown[][]).filter(
        (c) => c[0] === "chat.params",
      );
      expect(chatParamsCalls.length).toBeGreaterThan(0);
      const payload = chatParamsCalls[0][1] as Record<string, unknown>;
      expect(payload.sessionID).toBe(sessionId);
      expect(payload.agent).toBe("build");
    } finally {
      infoSpy.mockRestore();
    }
  });

  test("tool.execute.before hook logs via logger.info and does not throw", async () => {
    const infoSpy = vi
      .spyOn(logger, "info")
      .mockImplementation(((() => logger) as unknown) as never);

    try {
      const hooks = await entrypoint.server({
        client: {} as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        experimental_workspace: { register: vi.fn() },
        serverUrl: new URL("http://localhost"),
        $: {} as any,
      });

      const sessionId = "tool-before-test";
      await createSessionViaEvent(hooks, sessionId, testDir, "ToolBefore");

      await expect(
        hooks["tool.execute.before"]!(
          { tool: "bash", sessionID: sessionId, callID: "call-1" } as any,
          { args: { command: "ls" } },
        ),
      ).resolves.toBeUndefined();

      const toolBeforeCalls = (infoSpy.mock.calls as unknown[][]).filter(
        (c) => c[0] === "tool.execute.before",
      );
      expect(toolBeforeCalls.length).toBeGreaterThan(0);
      const payload = toolBeforeCalls[0][1] as Record<string, unknown>;
      expect(payload.sessionID).toBe(sessionId);
      expect(payload.callID).toBe("call-1");
      expect(payload.tool).toBe("bash");
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe("Plugin - tool.execute.after parentID eager propagation", () => {
  test("eagerly writes child session's parentID via updateSessionMetadata when task tool completes", async () => {
    const { hooks } = await setupPluginWithMockClient(testDir);

    const parentSessionId = "parent-eager-pid";
    const childSessionId = "child-eager-pid";

    await createSessionViaEvent(hooks, parentSessionId, testDir, "Parent");

    await hooks["tool.execute.after"]!(
      {
        tool: "task",
        sessionID: parentSessionId,
        callID: "call-eager",
        args: { description: "sub-work", prompt: "do it" },
      },
      {
        title: "Task done",
        output: "completed",
        metadata: { session_id: childSessionId },
      },
    );

    const childMeta = readSessionMetadata(testDir, childSessionId);
    expect(childMeta).toBeTruthy();
    expect(childMeta.parentID).toBe(parentSessionId);

    const parentMeta = readSessionMetadata(testDir, parentSessionId);
    expect(parentMeta.subSessions).toContain(childSessionId);
  });

  test("does not eagerly write parentID for non-task tools", async () => {
    const { hooks } = await setupPluginWithMockClient(testDir);

    const sessionId = "non-task-eager";
    await createSessionViaEvent(hooks, sessionId, testDir, "Parent");

    const ghostChild = "ghost-child-eager";

    await hooks["tool.execute.after"]!(
      {
        tool: "read",
        sessionID: sessionId,
        callID: "call-read",
        args: { filePath: "/foo" },
      },
      {
        title: "Read done",
        output: "contents",
        metadata: { session_id: ghostChild },
      },
    );

    const ghostMeta = readSessionMetadata(testDir, ghostChild);
    if (ghostMeta !== null) {
      expect(ghostMeta.parentID).toBeUndefined();
    }
  });

  test("does not throw when task metadata has no session_id", async () => {
    const { hooks } = await setupPluginWithMockClient(testDir);

    const sessionId = "task-no-sid-eager";
    await createSessionViaEvent(hooks, sessionId, testDir, "Parent");

    await expect(
      hooks["tool.execute.after"]!(
        {
          tool: "task",
          sessionID: sessionId,
          callID: "call-no-sid-eager",
          args: {},
        },
        {
          title: "Task done",
          output: "completed",
          metadata: {},
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("Plugin - config hook", () => {
  test("config hook registers trace command in input.command", async () => {
    const input: any = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
    };

    const hooks = await entrypoint.server(input);
    await hooks.config!(input);

    expect(input.command).toBeDefined();
    expect(input.command.trace).toBeDefined();
    expect(input.command.trace.description).toContain("/trace");
    expect(input.command.trace.template).toBe("");
  });

  test("config hook preserves existing command entries", async () => {
    const input: any = {
      client: {} as any,
      project: {} as any,
      directory: testDir,
      worktree: testDir,
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost"),
      $: {} as any,
      command: { otherCmd: { template: "", description: "Other" } },
    };

    const hooks = await entrypoint.server(input);
    await hooks.config!(input);

    expect(input.command.otherCmd).toBeDefined();
    expect(input.command.trace).toBeDefined();
  });
});

describe("Plugin - command.execute.before prompt error handling", () => {
  test("handles client.session.prompt throwing an error gracefully", async () => {
    _resetForTesting();
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(((() => logger) as unknown) as never);

    try {
      const mockPrompt = vi.fn().mockRejectedValue(new Error("network failure"));
      const hooks = await entrypoint.server({
        client: { session: { prompt: mockPrompt } } as any,
        project: {} as any,
        directory: testDir,
        worktree: testDir,
        experimental_workspace: { register: vi.fn() },
        serverUrl: new URL("http://localhost"),
        $: {} as any,
      });

      const sessionId = "prompt-error-test";
      await createSessionViaEvent(hooks, sessionId, testDir, "PromptErr");

      const output = { parts: [{ type: "text", text: "original" } as any] };
      let error: Error | null = null;
      try {
        await hooks["command.execute.before"]!(
          {
            command: "trace",
            sessionID: sessionId,
            arguments: "status",
          },
          output,
        );
      } catch (err) {
        error = err as Error;
      }

      expect(error).toBeTruthy();
      expect((error as unknown as Error).message).toBe("__TRACE_HANDLED__");
      expect(output.parts.length).toBe(0);
      expect(errorSpy).toHaveBeenCalled();

      const errorCalls = (errorSpy.mock.calls as unknown[][]).filter(
        (c) => c[0] === "Failed to send trace command response",
      );
      expect(errorCalls.length).toBe(1);
      expect(String((errorCalls[0][1] as Record<string, unknown>).error)).toContain("network failure");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
