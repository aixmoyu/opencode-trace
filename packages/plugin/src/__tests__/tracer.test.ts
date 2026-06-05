import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createTracer } from "../tracer.js";
import type { TracerConfig } from "../tracer.js";
import { TracePlugin } from "../plugin-instance.js";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      } catch { /* still being written */ }
    }
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Timeout waiting for valid file ${filePath} after ${timeoutMs}ms`,
      );
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await promise;
  }
}

describe("./tracer exports", () => {
  test("TC-001: exports createTracer function and TracerConfig type", () => {
    expect(createTracer).toBeDefined();
    expect(typeof createTracer).toBe("function");
  });

  test("wrap(fetch) returns a wrapper function without auto-patching", () => {
    const originalFetch = globalThis.fetch;
    const t = createTracer({ localDir: "/tmp/test" });
    const wrapper = t.wrap(originalFetch);

    expect(typeof wrapper).toBe("function");
    // globalThis.fetch must NOT be patched
    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("TC-003: createTracer with only localDir succeeds", () => {
    const t = createTracer({ localDir: "/tmp/test-trace" });
    expect(t).toBeDefined();
    expect(typeof t.wrap).toBe("function");
  });

  test("TC-003: createTracer with custom globalDir and localDir", () => {
    const t = createTracer({
      globalDir: "/custom/global",
      localDir: "/tmp/test-trace",
    });
    expect(t).toBeDefined();
    expect(typeof t.wrap).toBe("function");
  });

  test("TC-007: createTracer without localDir throws TypeError", () => {
    expect(() => createTracer({} as unknown as TracerConfig)).toThrow(
      /localDir/,
    );
  });

  test("TC-007: error message mentions required", () => {
    expect(() => createTracer({} as unknown as TracerConfig)).toThrow(
      /required/,
    );
  });
});

describe("Tracer interception", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tracer-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("TC-004: nested monkeypatch records to both paths", async () => {
    const tempDirA = mkdtempSync(join(tmpdir(), "tracer-a-"));
    const tempDirB = mkdtempSync(join(tmpdir(), "tracer-b-"));
    try {
      const tracerA = createTracer({
        globalDir: tempDirA,
        localDir: tempDirA,
      });
      const tracerB = createTracer({
        globalDir: tempDirB,
        localDir: tempDirB,
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });

      try {
        globalThis.fetch = tracerA.wrap(globalThis.fetch);
        globalThis.fetch = tracerB.wrap(globalThis.fetch);

        const response = await globalThis.fetch("https://example.com/api", {
          method: "GET",
          headers: { "x-opencode-session": "test-nested" },
        });
        expect(response.status).toBe(200);

        const fileA = join(tempDirA, "test-nested", "1.json");
        const fileB = join(tempDirB, "test-nested", "1.json");
        await waitForFile(fileA);
        await waitForFile(fileB);

        const recordA = JSON.parse(
          readFileSync(fileA, "utf-8"),
        ) as Record<string, unknown>;
        const recordB = JSON.parse(
          readFileSync(fileB, "utf-8"),
        ) as Record<string, unknown>;

        expect(recordA.request).toEqual(recordB.request);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      rmSync(tempDirA, { recursive: true, force: true });
      rmSync(tempDirB, { recursive: true, force: true });
    }
  });

  test("TC-005: redaction is inherited", async () => {
    const t = createTracer({ globalDir: tempDir, localDir: tempDir });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    try {
      globalThis.fetch = t.wrap(globalThis.fetch);

      const response = await globalThis.fetch("https://example.com/api", {
        method: "POST",
        headers: {
          "x-opencode-session": "test-redact",
          authorization: "Bearer secret-token-123",
          "content-type": "application/json",
        },
        body: JSON.stringify({ test: true }),
      });
      expect(response.status).toBe(200);

      const filePath = join(tempDir, "test-redact", "1.json");
      await waitForFile(filePath);

      const record = JSON.parse(
        readFileSync(filePath, "utf-8"),
      ) as Record<string, unknown>;
      const request = record.request as Record<string, unknown>;
      const requestHeaders = request.headers as Record<string, unknown>;
      expect(requestHeaders.authorization).toBe("Bearer [REDACTED]");
      expect(requestHeaders["content-type"]).toBe("application/json");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("TC-009: invalid localDir does not throw on construction", () => {
    const t = createTracer({
      globalDir: tempDir,
      localDir: "/nonexistent/path/.opencode-trace",
    });
    expect(t).toBeDefined();
  });

  test("installInterceptor auto-patches and is idempotent", () => {
    const t = createTracer({ globalDir: tempDir, localDir: tempDir });
    const originalFetch = globalThis.fetch;
    const mockFetch: typeof fetch = async () =>
      new Response(null, { status: 200 });

    try {
      globalThis.fetch = mockFetch;
      t.installInterceptor();
      const firstInterceptor = globalThis.fetch;

      t.installInterceptor();
      expect(globalThis.fetch).toBe(firstInterceptor);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getInterceptor", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tracer-getinterceptor-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("getInterceptor returns a function and does not auto-patch globalThis.fetch", () => {
    const originalFetch = globalThis.fetch;
    const t = createTracer({ globalDir: tempDir, localDir: tempDir });

    const interceptor = t.getInterceptor();

    expect(typeof interceptor).toBe("function");
    // getInterceptor must NOT auto-patch — same contract as wrap()
    expect(globalThis.fetch).toBe(originalFetch);
  });

  test("getInterceptor returns a fresh wrapper on each call", () => {
    const t = createTracer({ globalDir: tempDir, localDir: tempDir });

    const a = t.getInterceptor();
    const b = t.getInterceptor();

    expect(typeof a).toBe("function");
    expect(typeof b).toBe("function");
    // Each call returns a distinct arrow function instance
    expect(a).not.toBe(b);
  });

  test("getInterceptor wrapper records a traced fetch call to disk", async () => {
    const originalFetch = globalThis.fetch;
    // origFetch is captured at tracer-construction time, so install the mock first
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const t = createTracer({ globalDir: tempDir, localDir: tempDir });

    try {
      const interceptor = t.getInterceptor();
      const response = await interceptor("https://example.com/api", {
        method: "GET",
        headers: { "x-opencode-session": "test-getinterceptor" },
      });
      expect(response.status).toBe(200);

      const filePath = join(tempDir, "test-getinterceptor", "1.json");
      await waitForFile(filePath);

      const record = JSON.parse(
        readFileSync(filePath, "utf-8"),
      ) as Record<string, unknown>;
      const request = record.request as Record<string, unknown>;
      expect(request.url).toBe("https://example.com/api");
      expect(request.method).toBe("GET");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("wrapStreamResponse raw SSE file write", () => {
  test("writes raw SSE chunks to {seq}.sse in the traceDir", async () => {
    const sseChunks = [
      new TextEncoder().encode('data: {"id":"1"}\n\n'),
      new TextEncoder().encode('data: {"id":"2"}\n\n'),
      new TextEncoder().encode("data: [DONE]\n\n"),
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const c of sseChunks) controller.enqueue(c);
        controller.close();
      },
    });
    const orig = new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const traceDir = mkdtempSync(join(tmpdir(), "sse-test-"));
    const plugin = new TracePlugin({ localDir: traceDir, globalDir: traceDir });
    const wrapped = await (plugin as any).wrapStreamResponse(
      orig,
      performance.now(),
      "sess-1",
      7,
      traceDir,
    );

    // Drain the wrapped body — this drives the transform's flush to completion
    const reader = wrapped.body!.getReader();
    const received: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(value!);
    }

    const ssePath = join(traceDir, "sess-1", "7.sse");
    expect(existsSync(ssePath)).toBe(true);
    const written = readFileSync(ssePath, "utf8");
    expect(written).toBe(
      sseChunks.map((c) => new TextDecoder().decode(c)).join(""),
    );

    const meta = (wrapped as any).__latencyMeta;
    expect(meta.firstTokenAt).not.toBeNull();
    expect(meta.lastTokenAt).not.toBeNull();

    rmSync(traceDir, { recursive: true, force: true });
  });

  test("does not create {seq}.sse or {seq}.sse.tmp when no chunks are written (empty stream)", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const orig = new Response(stream, { status: 200 });
    const traceDir = mkdtempSync(join(tmpdir(), "sse-empty-"));
    const plugin = new TracePlugin({ localDir: traceDir, globalDir: traceDir });
    const wrapped = await (plugin as any).wrapStreamResponse(
      orig,
      performance.now(),
      "sess-1",
      8,
      traceDir,
    );

    const reader = wrapped.body!.getReader();
    while (!(await reader.read()).done) {
      /* drain */
    }

    const sessionDir = join(traceDir, "sess-1");
    expect(existsSync(join(sessionDir, "8.sse"))).toBe(false);
    expect(existsSync(join(sessionDir, "8.sse.tmp"))).toBe(false);

    rmSync(traceDir, { recursive: true, force: true });
  });
});
