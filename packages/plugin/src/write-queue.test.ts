import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { AsyncWriteQueue } from "./write-queue.js";
import { logger } from "@opencode-trace/core";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  promises as fs,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeRecord(seq: number, label: string = "test") {
  return {
    id: seq,
    purpose: label,
    requestAt: "2026-05-07T00:00:00Z",
    responseAt: "2026-05-07T00:00:01Z",
    request: {
      method: "GET",
      url: `https://example.com/${seq}`,
      headers: {},
      body: null,
    },
    response: { status: 200, statusText: "OK", headers: {}, body: null },
    error: null,
  };
}

function makeErrnoError(code: string, message?: string): NodeJS.ErrnoException {
  const err = new Error(message ?? code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe("AsyncWriteQueue", () => {
  let tempDir: string;
  let queue: AsyncWriteQueue;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "write-queue-test-"));
    queue = new AsyncWriteQueue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("enqueue writes JSON file to session directory", async () => {
    const record = {
      id: 1,
      purpose: "test",
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: {
        method: "GET",
        url: "https://example.com",
        headers: {},
        body: null,
      },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    };

    queue.enqueue("session-1", 1, record);

    await queue.flush();

    const filePath = join(tempDir, "session-1", "1.json");
    expect(existsSync(filePath)).toBe(true);

    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toEqual(record);
  });

  test("enqueue processes items in batches of 10", async () => {
    const records = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      purpose: `test-${i}`,
      requestAt: `2026-05-07T00:00:${i.toString().padStart(2, "0")}Z`,
      responseAt: `2026-05-07T00:00:${(i + 1).toString().padStart(2, "0")}Z`,
      request: {
        method: "GET",
        url: `https://example.com/${i}`,
        headers: {},
        body: null,
      },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    }));

    for (let i = 0; i < 25; i++) {
      queue.enqueue("batch-test", i + 1, records[i]);
    }

    await queue.flush();

    for (let i = 1; i <= 25; i++) {
      const filePath = join(tempDir, "batch-test", `${i}.json`);
      expect(existsSync(filePath)).toBe(true);
    }
  });

  test.skipIf(process.platform === "win32")(
    "enqueue writes to fallback directory when primary write fails",
    async () => {
      const record = {
        id: 1,
        purpose: "fallback-test",
        requestAt: "2026-05-07T00:00:00Z",
        responseAt: "2026-05-07T00:00:01Z",
        request: {
          method: "GET",
          url: "https://example.com",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
      };

      const sessionDir = join(tempDir, "readonly-session");
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.chmod(sessionDir, 0o000);

      queue.enqueue("readonly-session", 1, record);

      await queue.flush();

      await fs.chmod(sessionDir, 0o755);

      const fallbackDir = join(tempDir, "fallback");
      const files = await fs.readdir(fallbackDir);
      expect(files.length).toBeGreaterThan(0);
    },
  );

  test("flush waits for queue to drain", async () => {
    const records = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      purpose: `flush-test-${i}`,
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: {
        method: "GET",
        url: "https://example.com",
        headers: {},
        body: null,
      },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    }));

    for (let i = 0; i < 15; i++) {
      queue.enqueue("flush-test", i + 1, records[i]);
    }

    await queue.flush();

    for (let i = 1; i <= 15; i++) {
      const filePath = join(tempDir, "flush-test", `${i}.json`);
      expect(existsSync(filePath)).toBe(true);
    }
  });
});

describe("AsyncWriteQueue.safeRename retry logic", () => {
  let tempDir: string;
  let queue: AsyncWriteQueue;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "write-queue-retry-"));
    queue = new AsyncWriteQueue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("retries rename on EPERM and succeeds on 3rd attempt", async () => {
    const realRename = fs.rename.bind(fs);
    let calls = 0;
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
        calls++;
        if (calls <= 2) {
          throw makeErrnoError("EPERM", "EPERM: operation not permitted");
        }
        return realRename(...args);
      });

    queue.enqueue("retry-success", 1, makeRecord(1, "retry-success"));
    await queue.flush();

    // 3 rename calls: 2 EPERM failures + 1 success
    expect(renameSpy).toHaveBeenCalledTimes(3);

    // The final .json file ended up at destination (3rd rename succeeded)
    const finalPath = join(tempDir, "retry-success", "1.json");
    expect(existsSync(finalPath)).toBe(true);

    // No fallback file should have been written
    const fallbackDir = join(tempDir, "fallback");
    expect(existsSync(fallbackDir)).toBe(false);

    const content = JSON.parse(readFileSync(finalPath, "utf-8"));
    expect(content.purpose).toBe("retry-success");
  });

  test("retries rename on EACCES and succeeds on 3rd attempt", async () => {
    const realRename = fs.rename.bind(fs);
    let calls = 0;
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
        calls++;
        if (calls <= 2) {
          throw makeErrnoError("EACCES", "EACCES: permission denied");
        }
        return realRename(...args);
      });

    queue.enqueue("retry-eacces", 1, makeRecord(1, "retry-eacces"));
    await queue.flush();

    expect(renameSpy).toHaveBeenCalledTimes(3);
    const finalPath = join(tempDir, "retry-eacces", "1.json");
    expect(existsSync(finalPath)).toBe(true);
  });

  test("exhausts 3 retries on persistent EPERM and falls back", async () => {
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async () => {
        throw makeErrnoError("EPERM", "EPERM: operation not permitted");
      });

    queue.enqueue("retry-exhaust", 1, makeRecord(1, "retry-exhaust"));
    await queue.flush();

    // Exactly 3 rename attempts (max retries)
    expect(renameSpy).toHaveBeenCalledTimes(3);

    // Final .json was NOT renamed
    const finalPath = join(tempDir, "retry-exhaust", "1.json");
    expect(existsSync(finalPath)).toBe(false);

    // The .tmp file was left behind (rename never completed)
    const tmpPath = join(tempDir, "retry-exhaust", "1.json.tmp");
    expect(existsSync(tmpPath)).toBe(true);

    // The record was preserved via the fallback path
    const fallbackDir = join(tempDir, "fallback");
    expect(existsSync(fallbackDir)).toBe(true);
    const fallbackEntries = readdirSync(fallbackDir);
    expect(fallbackEntries.length).toBeGreaterThan(0);
    const fallbackRecord = JSON.parse(
      readFileSync(join(fallbackDir, fallbackEntries[0]), "utf-8"),
    );
    expect(fallbackRecord.record.purpose).toBe("retry-exhaust");
    expect(fallbackRecord.error).toBeDefined();
  });

  test("does not retry on non-retriable error code (ENOENT)", async () => {
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async () => {
        throw makeErrnoError("ENOENT", "ENOENT: no such file or directory");
      });

    queue.enqueue("no-retry-enoent", 1, makeRecord(1, "no-retry-enoent"));
    await queue.flush();

    // Only 1 attempt — ENOENT is not retriable
    expect(renameSpy).toHaveBeenCalledTimes(1);

    // Falls back
    const fallbackDir = join(tempDir, "fallback");
    expect(existsSync(fallbackDir)).toBe(true);
  });

  test("does not retry when a non-Error value is thrown (string throw)", async () => {
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async () => {
        // String throw — has no `.code` property, so retry condition is false
        throw "rename-blew-up";
      });

    queue.enqueue("string-throw", 1, makeRecord(1, "string-throw"));
    await queue.flush();

    // Only 1 attempt — `.code` is undefined for a string throw
    expect(renameSpy).toHaveBeenCalledTimes(1);

    // The write was preserved via the fallback path
    const fallbackDir = join(tempDir, "fallback");
    expect(existsSync(fallbackDir)).toBe(true);
  });

  test("backoff sleeps progressively between retries (50ms, 100ms)", async () => {
    const realRename = fs.rename.bind(fs);
    const timestamps: number[] = [];
    let calls = 0;
    vi.spyOn(fs, "rename").mockImplementation(
      async (...args: Parameters<typeof fs.rename>) => {
        timestamps.push(Date.now());
        calls++;
        if (calls <= 2) {
          throw makeErrnoError("EPERM");
        }
        return realRename(...args);
      },
    );

    queue.enqueue("backoff", 1, makeRecord(1, "backoff"));
    await queue.flush();

    expect(timestamps).toHaveLength(3);
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];

    // 50ms backoff for first retry, 100ms for second (with some slack)
    expect(gap1).toBeGreaterThanOrEqual(45);
    expect(gap2).toBeGreaterThanOrEqual(95);
    // The second gap is roughly double the first
    expect(gap2).toBeGreaterThan(gap1);
  });
});

describe("AsyncWriteQueue.flush ordering", () => {
  let tempDir: string;
  let queue: AsyncWriteQueue;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "write-queue-flush-order-"));
    queue = new AsyncWriteQueue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("flush returns only after all enqueued writes are durable on disk", async () => {
    const count = 12;
    for (let i = 1; i <= count; i++) {
      queue.enqueue("order", i, makeRecord(i, `order-${i}`));
    }

    await queue.flush();

    for (let i = 1; i <= count; i++) {
      const filePath = join(tempDir, "order", `${i}.json`);
      expect(existsSync(filePath)).toBe(true);
      const content = JSON.parse(readFileSync(filePath, "utf-8"));
      expect(content.id).toBe(i);
      expect(content.purpose).toBe(`order-${i}`);
    }
  });

  test("flush on an empty queue returns immediately without error", async () => {
    const start = Date.now();
    await queue.flush();
    const elapsed = Date.now() - start;
    // Should resolve almost instantly (well under the 10ms poll interval)
    expect(elapsed).toBeLessThan(50);
  });

  test("flush is safe to call multiple times in sequence", async () => {
    queue.enqueue("multiflush", 1, makeRecord(1, "first"));
    await queue.flush();
    queue.enqueue("multiflush", 2, makeRecord(2, "second"));
    await queue.flush();
    await queue.flush(); // no-op flush

    expect(existsSync(join(tempDir, "multiflush", "1.json"))).toBe(true);
    expect(existsSync(join(tempDir, "multiflush", "2.json"))).toBe(true);
  });
});

describe("AsyncWriteQueue.writeParsedCache", () => {
  let tempDir: string;
  let queue: AsyncWriteQueue;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "write-queue-parsed-"));
    queue = new AsyncWriteQueue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writeParsedCache writes .parsed file fire-and-forget", async () => {
    queue.writeParsedCache("session-pc", 1, { hello: "world", _pcv: 1 });

    // Fire-and-forget uses setImmediate — wait for it to settle
    const cachePath = join(tempDir, "session-pc", "1.parsed");
    for (let i = 0; i < 50; i++) {
      if (existsSync(cachePath)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(existsSync(cachePath)).toBe(true);

    const content = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(content).toEqual({ hello: "world", _pcv: 1 });
  });

  test("writeParsedCache honors an explicit traceDir override", async () => {
    const overrideDir = mkdtempSync(join(tmpdir(), "write-queue-parsed-override-"));
    try {
      queue.writeParsedCache("session-pc2", 1, { overridden: true }, overrideDir);

      const cachePath = join(overrideDir, "session-pc2", "1.parsed");
      for (let i = 0; i < 50; i++) {
        if (existsSync(cachePath)) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(existsSync(cachePath)).toBe(true);

      // Should NOT appear in the default tempDir
      expect(existsSync(join(tempDir, "session-pc2", "1.parsed"))).toBe(false);
    } finally {
      rmSync(overrideDir, { recursive: true, force: true });
    }
  });
});

describe("AsyncWriteQueue.safeRename retry logging", () => {
  let tempDir: string;
  let queue: AsyncWriteQueue;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "write-queue-retry-log-"));
    queue = new AsyncWriteQueue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("logs warn on intermediate EPERM retry then succeeds on 2nd attempt", async () => {
    const realRename = fs.rename.bind(fs);
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementationOnce(async () => {
        throw makeErrnoError("EPERM", "EPERM: operation not permitted");
      })
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) =>
        realRename(...args),
      );

    const warnSpy = vi.spyOn(logger, "warn");

    queue.enqueue("retry-log-eperm", 1, makeRecord(1, "retry-log-eperm"));
    await queue.flush();

    expect(renameSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("safeRename retry"),
      expect.objectContaining({ attempt: 1, code: "EPERM" }),
    );

    const finalPath = join(tempDir, "retry-log-eperm", "1.json");
    expect(existsSync(finalPath)).toBe(true);

    const fallbackDir = join(tempDir, "fallback");
    expect(existsSync(fallbackDir)).toBe(false);
  });

  test("logs warn on intermediate EACCES retry", async () => {
    const realRename = fs.rename.bind(fs);
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementationOnce(async () => {
        throw makeErrnoError("EACCES", "EACCES: permission denied");
      })
      .mockImplementation(async (...args: Parameters<typeof fs.rename>) =>
        realRename(...args),
      );

    const warnSpy = vi.spyOn(logger, "warn");

    queue.enqueue("retry-log-eacces", 1, makeRecord(1, "retry-log-eacces"));
    await queue.flush();

    expect(renameSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("safeRename retry"),
      expect.objectContaining({ attempt: 1, code: "EACCES" }),
    );

    const finalPath = join(tempDir, "retry-log-eacces", "1.json");
    expect(existsSync(finalPath)).toBe(true);
  });

  test("does NOT log warn on first-attempt success", async () => {
    const renameSpy = vi.spyOn(fs, "rename");
    const warnSpy = vi.spyOn(logger, "warn");

    queue.enqueue("retry-log-success", 1, makeRecord(1, "retry-log-success"));
    await queue.flush();

    expect(renameSpy).toHaveBeenCalledTimes(1);
    const retryWarnings = (warnSpy.mock.calls as unknown[][]).filter(
      (call) =>
        typeof call[0] === "string" && (call[0] as string).includes("safeRename retry"),
    );
    expect(retryWarnings).toHaveLength(0);

    const finalPath = join(tempDir, "retry-log-success", "1.json");
    expect(existsSync(finalPath)).toBe(true);
  });

  test("after 3 EPERM failures, throws and lands in writeFallback (logger.error called)", async () => {
    const renameSpy = vi
      .spyOn(fs, "rename")
      .mockImplementation(async () => {
        throw makeErrnoError("EPERM", "EPERM: operation not permitted");
      });

    const errorSpy = vi.spyOn(logger, "error");

    queue.enqueue("retry-log-fallback", 1, makeRecord(1, "retry-log-fallback"));
    await queue.flush();

    expect(renameSpy).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Write failed"),
      expect.any(Object),
    );

    const finalPath = join(tempDir, "retry-log-fallback", "1.json");
    expect(existsSync(finalPath)).toBe(false);

    const fallbackDir = join(tempDir, "fallback");
    expect(existsSync(fallbackDir)).toBe(true);
    const entries = readdirSync(fallbackDir);
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe("AsyncWriteQueue.close()", () => {
  let tempDir: string;
  let queue: AsyncWriteQueue;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "write-queue-close-"));
    queue = new AsyncWriteQueue(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("drains the queue and sets closed flag", async () => {
    queue.enqueue("close-drain", 1, makeRecord(1, "close-drain-1"));
    queue.enqueue("close-drain", 2, makeRecord(2, "close-drain-2"));

    await queue.close();

    expect(existsSync(join(tempDir, "close-drain", "1.json"))).toBe(true);
    expect(existsSync(join(tempDir, "close-drain", "2.json"))).toBe(true);
  });

  test("enqueue after close routes to writeFallback and logs warn", async () => {
    await queue.close();

    const warnSpy = vi.spyOn(logger, "warn");
    const errorSpy = vi.spyOn(logger, "error");

    queue.enqueue("close-after", 99, makeRecord(99, "close-after-99"));
    await queue.flush();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("enqueue after close"),
      expect.any(Object),
    );

    const fallbackDir = join(tempDir, "fallback");
    expect(existsSync(fallbackDir)).toBe(true);
    const entries = readdirSync(fallbackDir);
    expect(entries.length).toBeGreaterThan(0);
  });

  test("close() is idempotent — second call is a no-op", async () => {
    await queue.close();
    await expect(queue.close()).resolves.toBeUndefined();
  });
});
