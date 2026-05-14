import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { AsyncStateQueue } from "./state-queue.js";
import { StateManager } from "@opencode-trace/core/state";
import { logger } from "@opencode-trace/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AsyncStateQueue", () => {
  let tempDir: string;
  let queue: AsyncStateQueue;
  let stateManager: StateManager;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "state-queue-test-"));
    queue = new AsyncStateQueue();

    stateManager = new StateManager(tempDir);
    await stateManager.init();
    queue.setStateManager(stateManager);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("enqueue calls StateManager.writeRecord asynchronously", async () => {
    const sessionId = "test-session";
    stateManager.startSession(sessionId);

    const record = {
      id: 1,
      purpose: "test",
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: { method: "GET", url: "https://example.com", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    };

    queue.enqueue(sessionId, 1, record);

    await new Promise(resolve => setTimeout(resolve, 100));

    const session = stateManager.getSession(sessionId);
    expect(session?.requestCount).toBe(1);
  });

  test("enqueue processes items in batches", async () => {
    const sessionId = "batch-test";
    stateManager.startSession(sessionId);

    const records = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      purpose: `test-${i}`,
      requestAt: new Date().toISOString(),
      responseAt: new Date().toISOString(),
      request: { method: "GET", url: `https://example.com/${i}`, headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    }));

    for (let i = 0; i < 25; i++) {
      queue.enqueue(sessionId, i + 1, records[i]);
    }

    await queue.flush();

    const session = stateManager.getSession(sessionId);
    expect(session?.requestCount).toBe(25);
  });

  test("enqueue handles errors gracefully", async () => {
    const sessionId = "error-test";
    stateManager.startSession(sessionId);

    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

    const record = {
      id: 1,
      purpose: "test",
      requestAt: new Date().toISOString(),
      responseAt: new Date().toISOString(),
      request: { method: "GET", url: "https://example.com", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    };

    vi.spyOn(stateManager, 'writeRecord').mockImplementationOnce(() => {
      throw new Error("Test error");
    });

    queue.enqueue(sessionId, 1, record);

    await queue.flush();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "SQLite update failed",
      { error: "Error: Test error" }
    );

    loggerErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  test("flush waits for queue to drain", async () => {
    const sessionId = "flush-test";
    stateManager.startSession(sessionId);

    for (let i = 0; i < 5; i++) {
      queue.enqueue(sessionId, i + 1, {
        id: i + 1,
        purpose: `test-${i}`,
        requestAt: new Date().toISOString(),
        responseAt: new Date().toISOString(),
        request: { method: "GET", url: "https://example.com", headers: {}, body: null },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
      });
    }

    await queue.flush();

    const session = stateManager.getSession(sessionId);
    expect(session?.requestCount).toBe(5);
  });
});