import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { FallbackReconciler } from "./fallback-reconciler.js";
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

interface FallbackPayload {
  record: Record<string, unknown>;
  error: { name: string; message: string; stack?: string };
}

function makeFallbackPayload(seq: number): FallbackPayload {
  return {
    record: {
      id: seq,
      purpose: "fallback",
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: { method: "POST", url: "https://example.com", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    },
    error: { name: "Error", message: "primary write failed" },
  };
}

async function writeFallbackFile(
  traceDir: string,
  session: string,
  seq: number,
  timestamp: number = Date.now(),
): Promise<string> {
  const fallbackDir = join(traceDir, "fallback");
  await fs.mkdir(fallbackDir, { recursive: true });
  const filename = `${session}-${seq}-${timestamp}.json`;
  const path = join(fallbackDir, filename);
  await fs.writeFile(path, JSON.stringify(makeFallbackPayload(seq), null, 2));
  return path;
}

describe("FallbackReconciler", () => {
  let tempDir: string;
  let reconciler: FallbackReconciler;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fallback-reconciler-"));
    reconciler = new FallbackReconciler(tempDir);
  });

  afterEach(async () => {
    await reconciler.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("reconcile moves a single fallback file to its session directory", async () => {
    await writeFallbackFile(tempDir, "sess-1", 7);

    const result = await reconciler.reconcile();

    expect(result.recovered).toBe(1);
    expect(result.failed).toBe(0);
    expect(existsSync(join(tempDir, "sess-1", "7.json"))).toBe(true);
  });

  test("reconcile removes the fallback file after successful move", async () => {
    const fallbackPath = await writeFallbackFile(tempDir, "sess-2", 9);

    await reconciler.reconcile();

    expect(existsSync(fallbackPath)).toBe(false);
    expect(readdirSync(join(tempDir, "fallback"))).toEqual([]);
  });

  test("reconcile preserves the record payload", async () => {
    await writeFallbackFile(tempDir, "sess-3", 11);

    await reconciler.reconcile();

    const written = JSON.parse(readFileSync(join(tempDir, "sess-3", "11.json"), "utf-8"));
    expect(written.id).toBe(11);
    expect(written.purpose).toBe("fallback");
    expect(written.request.url).toBe("https://example.com");
  });

  test("reconcile creates session directory when missing", async () => {
    await writeFallbackFile(tempDir, "new-session", 1);

    await reconciler.reconcile();

    expect(existsSync(join(tempDir, "new-session"))).toBe(true);
  });

  test("reconcile is a no-op when fallback directory does not exist", async () => {
    const result = await reconciler.reconcile();

    expect(result.recovered).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.scanned).toBe(0);
  });

  test("reconcile leaves file in fallback when destination write fails", async () => {
    const fallbackPath = await writeFallbackFile(tempDir, "stuck-session", 1);

    const sessionDir = join(tempDir, "stuck-session");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.chmod(sessionDir, 0o555);

    const result = await reconciler.reconcile();

    await fs.chmod(sessionDir, 0o755);

    expect(result.failed).toBe(1);
    expect(existsSync(fallbackPath)).toBe(true);
  });

  test("reconcile skips files with malformed filenames", async () => {
    const fallbackDir = join(tempDir, "fallback");
    await fs.mkdir(fallbackDir, { recursive: true });
    await fs.writeFile(join(fallbackDir, "garbage.json"), "{}");
    await fs.writeFile(join(fallbackDir, "not-a-record.txt"), "nope");
    await writeFallbackFile(tempDir, "valid", 42);

    const result = await reconciler.reconcile();

    expect(result.scanned).toBe(1);
    expect(result.recovered).toBe(1);
    expect(existsSync(join(fallbackDir, "garbage.json"))).toBe(true);
    expect(existsSync(join(fallbackDir, "not-a-record.txt"))).toBe(true);
  });

  test("reconcile parses session IDs containing dashes", async () => {
    await writeFallbackFile(tempDir, "session-with-many-dashes", 100);

    const result = await reconciler.reconcile();

    expect(result.recovered).toBe(1);
    expect(existsSync(join(tempDir, "session-with-many-dashes", "100.json"))).toBe(true);
  });

  test("reconcile processes multiple files in a single pass", async () => {
    await writeFallbackFile(tempDir, "sess-a", 1, 1000);
    await writeFallbackFile(tempDir, "sess-a", 2, 2000);
    await writeFallbackFile(tempDir, "sess-b", 1, 3000);

    const result = await reconciler.reconcile();

    expect(result.scanned).toBe(3);
    expect(result.recovered).toBe(3);
    expect(existsSync(join(tempDir, "sess-a", "1.json"))).toBe(true);
    expect(existsSync(join(tempDir, "sess-a", "2.json"))).toBe(true);
    expect(existsSync(join(tempDir, "sess-b", "1.json"))).toBe(true);
  });

  test("stats() reports reconciliation counters", async () => {
    expect(reconciler.stats()).toEqual({
      runs: 0,
      recovered: 0,
      failed: 0,
    });

    await writeFallbackFile(tempDir, "stat-sess", 1);
    await reconciler.reconcile();

    expect(reconciler.stats()).toEqual({
      runs: 1,
      recovered: 1,
      failed: 0,
    });
  });

  test("start() schedules periodic reconciliation", async () => {
    const periodic = new FallbackReconciler(tempDir, { intervalMs: 40 });
    await writeFallbackFile(tempDir, "periodic", 1);

    await periodic.start();
    const runsAfterStart = periodic.stats().runs;

    await new Promise((r) => setTimeout(r, 250));

    expect(periodic.stats().runs).toBeGreaterThan(runsAfterStart);

    await writeFallbackFile(tempDir, "periodic-2", 1);
    await new Promise((r) => setTimeout(r, 100));
    await periodic.stop();

    expect(periodic.stats().recovered).toBeGreaterThanOrEqual(2);
  });

  test("stop() halts the periodic loop and waits for in-flight", async () => {
    const slow = new FallbackReconciler(tempDir, { intervalMs: 50 });
    await slow.start();
    await slow.stop();

    const runsBefore = slow.stats().runs;

    await new Promise((r) => setTimeout(r, 200));

    expect(slow.stats().runs).toBe(runsBefore);
  });
});
