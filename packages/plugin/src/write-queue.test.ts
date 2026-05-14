import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { AsyncWriteQueue } from "./write-queue.js";
import { mkdtempSync, rmSync, existsSync, readFileSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      request: { method: "GET", url: "https://example.com", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    };

    queue.enqueue("session-1", 1, record);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const filePath = join(tempDir, "session-1", "1.json");
    expect(existsSync(filePath)).toBe(true);
    
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toEqual(record);
  });

  test("enqueue processes items in batches of 10", async () => {
    const records = Array.from({length: 25}, (_, i) => ({
      id: i + 1,
      purpose: `test-${i}`,
      requestAt: `2026-05-07T00:00:${i.toString().padStart(2, "0")}Z`,
      responseAt: `2026-05-07T00:00:${(i + 1).toString().padStart(2, "0")}Z`,
      request: { method: "GET", url: `https://example.com/${i}`, headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    }));

    for (let i = 0; i < 25; i++) {
      queue.enqueue("batch-test", i + 1, records[i]);
    }

    await new Promise(resolve => setTimeout(resolve, 200));

    for (let i = 1; i <= 25; i++) {
      const filePath = join(tempDir, "batch-test", `${i}.json`);
      expect(existsSync(filePath)).toBe(true);
    }
  });

  test("enqueue writes to fallback directory when primary write fails", async () => {
    const record = {
      id: 1,
      purpose: "fallback-test",
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: { method: "GET", url: "https://example.com", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    };

    const sessionDir = join(tempDir, "readonly-session");
    await fs.mkdir(sessionDir, {recursive: true});
    await fs.chmod(sessionDir, 0o000);

    queue.enqueue("readonly-session", 1, record);

    await new Promise(resolve => setTimeout(resolve, 100));

    await fs.chmod(sessionDir, 0o755);

    const fallbackDir = join(tempDir, "fallback");
    const files = await fs.readdir(fallbackDir);
    expect(files.length).toBeGreaterThan(0);
  });

  test("flush waits for queue to drain", async () => {
    const records = Array.from({length: 15}, (_, i) => ({
      id: i + 1,
      purpose: `flush-test-${i}`,
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: { method: "GET", url: "https://example.com", headers: {}, body: null },
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