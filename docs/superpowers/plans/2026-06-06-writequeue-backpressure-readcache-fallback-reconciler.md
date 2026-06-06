# 三处瓶颈改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AsyncWriteQueue` bounded with backpressure; add `ReadCache` for metadata + timeline; add `FallbackReconciler` with TTL + retry to recover failed writes.

**Architecture:**
- `AsyncWriteQueue.enqueue()` becomes async; when queue is at `capacity`, callers await a `notFullResolvers` signal. `processQueue()` notifies after each batch.
- `ReadCache` is a `Map`-backed in-memory cache (TTL 5s, max 1000 entries) for `metadata.json` and `timeline.ndjson`. Invalidated by chokidar events.
- `FallbackReconciler` runs on plugin start + every 60s. Atomically renames `<traceDir>/<session>/fallback/<file>` back to `<traceDir>/<session>/<seq>.json`. Files older than 7 days or with `retries > 10` are deleted.

**Tech Stack:** TypeScript, Node 22+ (`Promise.withResolvers`), `node:fs/promises`, vitest, chokidar (already present).

**Reference Spec:** `docs/superpowers/specs/2026-06-06-writequeue-backpressure-readcache-fallback-reconciler-design.md`

---

## File Structure

**New files:**

| File | Responsibility |
|------|---------------|
| `packages/core/src/store/cache.ts` | `ReadCache` class — L1 cache for metadata + timeline |
| `packages/core/src/store/cache.test.ts` | Tests for `ReadCache` |
| `packages/plugin/src/fallback-reconciler.ts` | `FallbackReconciler` class — startup + periodic recovery |
| `packages/plugin/src/fallback-reconciler.test.ts` | Tests for `FallbackReconciler` |

**Modified files:**

| File | Change |
|------|--------|
| `packages/plugin/src/write-queue.ts` | `enqueue()` async + backpressure + stats; `writeFallback` writes `firstSeenAt` |
| `packages/plugin/src/write-queue.test.ts` | Add 6 backpressure tests; existing tests get `await` |
| `packages/plugin/src/plugin-instance.ts` | 3× `await this.writeQueue.enqueue(...)`; start/stop reconciler in init/shutdown |
| `packages/core/src/store/index.ts` | Export `getReadCache()` |
| `packages/core/src/store/write.ts` | Use `readCache.getMetadata()` instead of `readSessionMetadata()` |
| `packages/core/src/store/export.ts` | Same |
| `packages/cli/src/utils.ts` | Same |
| `packages/viewer/src/server.ts` | Use `readCache.getTimeline()`; chokidar invalidates on metadata/timeline change |

---

## Task 1: AsyncWriteQueue — 背压控制

**Files:**
- Modify: `packages/plugin/src/write-queue.ts` (lines 1-99, the class signature + enqueue/processQueue/notifyIdle)
- Modify: `packages/plugin/src/write-queue.test.ts` (add `await` to existing `enqueue` calls, add 6 new tests)
- Test: `packages/plugin/src/write-queue.test.ts`

### Step 1.1: Write the first failing backpressure test

Open `packages/plugin/src/write-queue.test.ts`. After the last existing `test(...)` (the "flush returns as soon as the queue drains" test added previously, around line 410), append:

```typescript
  test("enqueue returns a Promise that resolves when queue is below capacity", async () => {
    const result = queue.enqueue("backpressure-1", 1, makeRecord(1));
    expect(result).toBeInstanceOf(Promise);
    await result;
    await queue.flush();
    expect(existsSync(join(tempDir, "backpressure-1", "1.json"))).toBe(true);
  });

  test("enqueue blocks when queue is at capacity; resolves when drained", async () => {
    const smallQueue = new AsyncWriteQueue(tempDir, { capacity: 2 });
    // Slow down writeBatch so the queue fills up.
    const originalWriteBatch = (smallQueue as unknown as { writeBatch: (b: unknown[]) => Promise<void> }).writeBatch.bind(smallQueue);
    vi.spyOn(smallQueue as unknown as { writeBatch: (b: unknown[]) => Promise<void> }, "writeBatch")
      .mockImplementation(async (batch: unknown[]) => {
        await new Promise((r) => setTimeout(r, 30));
        await originalWriteBatch(batch);
      });

    const r1 = smallQueue.enqueue("bp-2", 1, makeRecord(1));
    const r2 = smallQueue.enqueue("bp-2", 2, makeRecord(2));
    // Third enqueue should block (queue is at capacity = 2).
    const r3 = smallQueue.enqueue("bp-2", 3, makeRecord(3));
    // r3 must not have resolved yet.
    let r3Settled = false;
    void r3.then(() => { r3Settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(r3Settled).toBe(false);

    // After flushing, r3 must resolve.
    await smallQueue.flush();
    await r3;
    expect(r3Settled).toBe(true);

    expect(existsSync(join(tempDir, "bp-2", "1.json"))).toBe(true);
    expect(existsSync(join(tempDir, "bp-2", "2.json"))).toBe(true);
    expect(existsSync(join(tempDir, "bp-2", "3.json"))).toBe(true);
  });
```

### Step 1.2: Run the new tests, expect TypeScript errors

Run:
```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/plugin/src/write-queue.test.ts -t "enqueue returns a Promise"
```

Expected: TypeScript error because `queue.enqueue(...)` is not yet async (returns `void`). Test compilation fails. **This is the red.**

If TypeScript is lenient and tests pass, that's fine — the next test ("blocks when at capacity") will fail because the implementation doesn't block.

### Step 1.3: Update `enqueue()` signature in write-queue.ts

Open `packages/plugin/src/write-queue.ts`. Find the `enqueue` method (around line 41). Change the signature from `enqueue(...): void` to `async enqueue(...): Promise<void>`. Find the `processQueue` method (around line 79). Add a `notifyNotFull()` call after each `splice`. Add a `notifyNotFull()` private method.

Replace the entire class body (lines 17-103) with:

```typescript
export class AsyncWriteQueue {
  private readonly queue: Array<{
    session: string;
    seq: number;
    record: TraceRecord;
    timelineEntry?: TimelineEntry;
    traceDir: string;
    forceFallback?: boolean;
  }> = [];
  private writing = false;
  private closed = false;
  private readonly defaultTraceDir: string;
  private readonly batchSize: number;
  private readonly capacity: number;
  private readonly softLimit: number;
  private readonly softWarnIntervalMs: number;
  private softWarnLastAt = 0;
  private softWarnings = 0;
  private blockEvents = 0;
  private peak = 0;
  private idleResolvers: Array<() => void> = [];
  private notFullResolvers: Array<() => void> = [];

  constructor(
    defaultTraceDir: string,
    options?: {
      batchSize?: number;
      capacity?: number;
      softLimitRatio?: number;
      softWarnIntervalMs?: number;
    },
  ) {
    this.defaultTraceDir = defaultTraceDir;
    this.batchSize = options?.batchSize ?? 50;
    this.capacity = options?.capacity ?? 1000;
    this.softLimit = Math.floor(this.capacity * (options?.softLimitRatio ?? 0.8));
    this.softWarnIntervalMs = options?.softWarnIntervalMs ?? 60_000;
  }

  async enqueue(
    session: string,
    seq: number,
    record: TraceRecord,
    timelineEntry?: TimelineEntry,
    traceDir?: string,
    options?: { forceFallback?: boolean },
  ): Promise<void> {
    if (this.closed) {
      await this.writeFallback(
        session,
        seq,
        record,
        new Error("Queue is closed"),
        traceDir ?? this.defaultTraceDir,
      );
      return;
    }

    // Soft limit: throttled warning
    if (this.queue.length >= this.softLimit) {
      const now = Date.now();
      if (now - this.softWarnLastAt >= this.softWarnIntervalMs) {
        this.softWarnLastAt = now;
        this.softWarnings++;
        logger.warn("AsyncWriteQueue near capacity", {
          queueLen: this.queue.length,
          capacity: this.capacity,
        });
      }
    }

    // Hard limit: backpressure
    while (this.queue.length >= this.capacity) {
      this.blockEvents++;
      const { promise, resolve } = Promise.withResolvers<void>();
      this.notFullResolvers.push(resolve);
      await promise;
    }

    this.queue.push({
      session,
      seq,
      record,
      timelineEntry,
      traceDir: traceDir ?? this.defaultTraceDir,
      forceFallback: options?.forceFallback,
    });
    if (this.queue.length > this.peak) this.peak = this.queue.length;
    this.processQueue();
  }

  private notifyNotFull(): void {
    if (this.notFullResolvers.length === 0) return;
    const waiters = this.notFullResolvers;
    this.notFullResolvers = [];
    for (const resolve of waiters) resolve();
  }

  private async processQueue(): Promise<void> {
    this.writing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        if (batch.length > 0) {
          this.notifyNotFull();
        }
        await this.writeBatch(batch);
      }
    } finally {
      this.writing = false;
      this.notifyIdle();
      if (this.queue.length > 0 && !this.writing) {
        this.processQueue();
      }
    }
  }

  private notifyIdle(): void {
    if (this.idleResolvers.length === 0) return;
    const waiters = this.idleResolvers;
    this.idleResolvers = [];
    for (const resolve of waiters) resolve();
  }

  async flush(): Promise<void> {
    if (!this.writing && this.queue.length === 0) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.idleResolvers.push(resolve);
    await promise;
  }

  stats(): {
    depth: number;
    peak: number;
    capacity: number;
    softWarnings: number;
    blockEvents: number;
  } {
    return {
      depth: this.queue.length,
      peak: this.peak,
      capacity: this.capacity,
      softWarnings: this.softWarnings,
      blockEvents: this.blockEvents,
    };
  }

  async close(): Promise<void> {
    // (existing close() implementation, unchanged)
  }

  // ... (rest of class unchanged)
}
```

**Do not modify** `writeBatch`, `writeOne`, `appendTimeline`, `writeFallback`, `writeParsedCache` — those are addressed in a later step. Leave the rest of the class intact.

### Step 1.4: Update existing test calls to use `await`

In `packages/plugin/src/write-queue.test.ts`, every existing `queue.enqueue(...)` call must become `await queue.enqueue(...)`. There are 27 call sites (lines 67, 95, 128, 157, 196, 227, 242, 275, 294, 320, 351, 374, 376, 399, 487, 516, 533, 556, 590, 591, 605, 643, 674, 717, 718, 742, 744).

All these tests are inside `test("...", async () => {...})` callbacks, so `await` is allowed.

**For each occurrence, prepend `await `** (do not add `void`):
```typescript
// before
queue.enqueue("session-1", 1, record);
// after
await queue.enqueue("session-1", 1, record);
```

In `for` loops like:
```typescript
for (let i = 0; i < 25; i++) {
  queue.enqueue("batch-test", i + 1, records[i]);
}
```
change to:
```typescript
for (let i = 0; i < 25; i++) {
  await queue.enqueue("batch-test", i + 1, records[i]);
}
```

### Step 1.5: Extend `writeFallback` to write `firstSeenAt`

In `packages/plugin/src/write-queue.ts`, find `writeFallback` (around line 183). Modify the JSON payload to include `firstSeenAt`:

```typescript
  private async writeFallback(
    session: string,
    seq: number,
    record: TraceRecord,
    err: Error,
    traceDir: string,
  ): Promise<void> {
    const fallbackDir = join(traceDir, "fallback");
    await fs.mkdir(fallbackDir, { recursive: true });
    const filename = `${session}-${seq}-${Date.now()}.json`;
    await fs.writeFile(
      join(fallbackDir, filename),
      JSON.stringify(
        {
          record,
          error: {
            name: err.name,
            message: err.message,
            stack: err.stack,
          },
          firstSeenAt: Date.now(),
          retries: 0,
        },
        null,
        2,
      ),
    );
    logger.error("Write failed, saved to fallback", {
      session,
      seq,
      traceDir,
      error: err.message,
    });
  }
```

**Note:** The existing tests that read fallback files (lines 259-265, 569-570) check `fallbackRecord.record.purpose` and `fallbackRecord.error`. They do NOT check `firstSeenAt` or `retries`. So adding new fields is non-breaking. But verify these tests still pass after the change.

### Step 1.6: Run all write-queue tests, expect green

```bash
cd /Users/li/Projects/opencode-trace && npx tsc --noEmit -p packages/plugin
```

Expected: 0 errors. (TypeScript may complain about void→Promise changes if any test missed an await — fix any that surface.)

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/plugin/src/write-queue.test.ts
```

Expected: all tests pass (existing ~30 + 2 new = ~32 tests).

### Step 1.7: Add the remaining 4 backpressure tests

In `packages/plugin/src/write-queue.test.ts`, append after the test added in step 1.1:

```typescript
  test("concurrent enqueues at capacity all complete; no records dropped", async () => {
    const smallQueue = new AsyncWriteQueue(tempDir, { capacity: 5 });
    const N = 50;
    const promises: Promise<void>[] = [];
    for (let i = 1; i <= N; i++) {
      promises.push(smallQueue.enqueue("concurrent-bp", i, makeRecord(i)));
    }
    await Promise.all(promises);
    await smallQueue.flush();
    for (let i = 1; i <= N; i++) {
      expect(existsSync(join(tempDir, "concurrent-bp", `${i}.json`))).toBe(true);
    }
  });

  test("soft warn fires once per interval when crossing soft limit", async () => {
    const smallQueue = new AsyncWriteQueue(tempDir, {
      capacity: 10,
      softLimitRatio: 0.5,
      softWarnIntervalMs: 60_000,
    });
    // Fill past soft limit (5).
    for (let i = 1; i <= 8; i++) {
      await smallQueue.enqueue("soft-warn", i, makeRecord(i));
    }
    const stats1 = smallQueue.stats();
    expect(stats1.softWarnings).toBe(1);
    // Force more enqueues; softWarnings must NOT increment (throttled).
    for (let i = 9; i <= 10; i++) {
      await smallQueue.enqueue("soft-warn", i, makeRecord(i));
    }
    const stats2 = smallQueue.stats();
    expect(stats2.softWarnings).toBe(1);
  });

  test("stats() reflects peak depth and block events", async () => {
    const smallQueue = new AsyncWriteQueue(tempDir, { capacity: 2 });
    const originalWriteBatch = (smallQueue as unknown as { writeBatch: (b: unknown[]) => Promise<void> }).writeBatch.bind(smallQueue);
    vi.spyOn(smallQueue as unknown as { writeBatch: (b: unknown[]) => Promise<void> }, "writeBatch")
      .mockImplementation(async (batch: unknown[]) => {
        await new Promise((r) => setTimeout(r, 30));
        await originalWriteBatch(batch);
      });

    const promises: Promise<void>[] = [];
    for (let i = 1; i <= 5; i++) {
      promises.push(smallQueue.enqueue("stats-test", i, makeRecord(i)));
    }
    await Promise.all(promises);
    const stats = smallQueue.stats();
    expect(stats.peak).toBeGreaterThanOrEqual(2);
    expect(stats.blockEvents).toBeGreaterThan(0);
    expect(stats.capacity).toBe(2);
  });
```

### Step 1.8: Run all backpressure tests

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/plugin/src/write-queue.test.ts
```

Expected: ~35 tests pass.

### Step 1.9: Commit

```bash
cd /Users/li/Projects/opencode-trace && git add packages/plugin/src/write-queue.ts packages/plugin/src/write-queue.test.ts
git commit -m "feat(plugin): AsyncWriteQueue 背压控制 + firstSeenAt 写入 fallback"
```

---

## Task 2: 更新生产 enqueue 调用点

**Files:**
- Modify: `packages/plugin/src/plugin-instance.ts` (lines 163, 428, 460)

### Step 2.1: Add `await` to all 3 production enqueue call sites

In `packages/plugin/src/plugin-instance.ts`, change:
- Line 163: `this.writeQueue.enqueue(meta.session, meta.seq, record, timelineEntry, meta.traceDir);` → `await this.writeQueue.enqueue(meta.session, meta.seq, record, timelineEntry, meta.traceDir);`
- Line 428: `this.writeQueue.enqueue(session, seq, record, timelineEntry, dir);` → `await this.writeQueue.enqueue(session, seq, record, timelineEntry, dir);`
- Line 460: `this.writeQueue.enqueue(session, seq, record, timelineEntry, dir);` → `await this.writeQueue.enqueue(session, seq, record, timelineEntry, dir);`

Each is inside an async function (the wrapping `try`/`catch` is part of `wrapFetch`, which is `async`). The catch block also needs to await, but TypeScript will guide.

### Step 2.2: Typecheck the plugin package

```bash
cd /Users/li/Projects/opencode-trace && npx tsc --noEmit -p packages/plugin
```

Expected: 0 errors. If TypeScript complains about a `void`-returning promise (e.g., `await` in a non-async function), inspect the surrounding function and fix.

### Step 2.3: Run all plugin tests

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/plugin
```

Expected: all tests pass (including integration, trace, plugin-instance, etc.).

### Step 2.4: Commit

```bash
cd /Users/li/Projects/opencode-trace && git add packages/plugin/src/plugin-instance.ts
git commit -m "refactor(plugin): await AsyncWriteQueue.enqueue at all 3 call sites"
```

---

## Task 3: FallbackReconciler (新建模块)

**Files:**
- Create: `packages/plugin/src/fallback-reconciler.ts`
- Create: `packages/plugin/src/fallback-reconciler.test.ts`

### Step 3.1: Write the first failing tests

Create `packages/plugin/src/fallback-reconciler.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { FallbackReconciler } from "./fallback-reconciler.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function writeFallbackFile(
  fallbackDir: string,
  session: string,
  seq: number,
  content: { record: any; error: any; firstSeenAt?: number; retries?: number },
) {
  const filename = `${session}-${seq}-${Date.now() + Math.random()}.json`;
  writeFileSync(join(fallbackDir, filename), JSON.stringify(content));
  return filename;
}

describe("FallbackReconciler", () => {
  let tempDir: string;
  let traceDir: string;
  let fallbackDir: string;
  let sessionDir: string;
  let session = "rec-test";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fallback-rec-test-"));
    traceDir = join(tempDir, "trace");
    sessionDir = join(traceDir, session);
    fallbackDir = join(sessionDir, "fallback");
    // Pre-create fallback dir to simulate a previous failed write.
    require("node:fs").mkdirSync(fallbackDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("recover: renames recent fallback file back to main path", async () => {
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1, purpose: "rec" },
      error: { name: "E", message: "m" },
      firstSeenAt: Date.now(),
      retries: 0,
    });

    const reconciler = new FallbackReconciler([traceDir]);
    await reconciler.reconcileOnce();

    expect(existsSync(join(sessionDir, "1.json"))).toBe(true);
    expect(readdirSync(fallbackDir).length).toBe(0);
    expect(reconciler.stats().recovered).toBe(1);
  });

  test("recover: skips if main file already exists, removes fallback", async () => {
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1, purpose: "rec" },
      error: { name: "E", message: "m" },
      firstSeenAt: Date.now(),
      retries: 0,
    });
    require("node:fs").writeFileSync(join(sessionDir, "1.json"), JSON.stringify({ existing: true }));

    const reconciler = new FallbackReconciler([traceDir]);
    await reconciler.reconcileOnce();

    expect(existsSync(join(sessionDir, "1.json"))).toBe(true);
    expect(readdirSync(fallbackDir).length).toBe(0);
    const recovered = reconciler.stats().recovered;
    // Whether counted as recovered or already-exists, the fallback must be removed.
    expect(recovered).toBeGreaterThanOrEqual(0);
  });

  test("retry: keeps fallback and increments retries when rename fails", async () => {
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1 },
      error: { name: "E", message: "m" },
      firstSeenAt: Date.now(),
      retries: 0,
    });
    // Make sessionDir read-only so rename into it fails on POSIX.
    require("node:fs").chmodSync(sessionDir, 0o500);

    const reconciler = new FallbackReconciler([traceDir], { maxRetries: 5 });
    await reconciler.reconcileOnce();

    // Restore permissions for afterEach cleanup.
    require("node:fs").chmodSync(sessionDir, 0o755);

    expect(readdirSync(fallbackDir).length).toBe(1);
    const file = readdirSync(fallbackDir)[0];
    const content = JSON.parse(readFileSync(join(fallbackDir, file), "utf-8"));
    expect(content.retries).toBe(1);
  });

  test("ttl: removes fallback files older than TTL", async () => {
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1 },
      error: { name: "E", message: "m" },
      firstSeenAt: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
      retries: 0,
    });

    const reconciler = new FallbackReconciler([traceDir], { ttlMs: 7 * 24 * 60 * 60 * 1000 });
    await reconciler.reconcileOnce();

    expect(readdirSync(fallbackDir).length).toBe(0);
    expect(reconciler.stats().expired).toBe(1);
  });

  test("ttl-fallback: uses mtime when firstSeenAt is missing (legacy files)", async () => {
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1 },
      error: { name: "E", message: "m" },
    });
    // Backdate the file mtime to 10 days ago.
    const file = readdirSync(fallbackDir)[0];
    const old = Date.now() / 1000 - 10 * 24 * 60 * 60;
    require("node:fs").utimesSync(join(fallbackDir, file), old, old);

    const reconciler = new FallbackReconciler([traceDir], { ttlMs: 7 * 24 * 60 * 60 * 1000 });
    await reconciler.reconcileOnce();

    expect(readdirSync(fallbackDir).length).toBe(0);
  });

  test("max-retries: removes fallback files exceeding retry limit", async () => {
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1 },
      error: { name: "E", message: "m" },
      firstSeenAt: Date.now(),
      retries: 10,
    });
    require("node:fs").chmodSync(sessionDir, 0o500);

    const reconciler = new FallbackReconciler([traceDir], { maxRetries: 10 });
    await reconciler.reconcileOnce();

    require("node:fs").chmodSync(sessionDir, 0o755);

    expect(readdirSync(fallbackDir).length).toBe(0);
    expect(reconciler.stats().expired).toBe(1);
  });

  test("corrupt: removes malformed fallback files (invalid JSON)", async () => {
    const filename = `${session}-1-${Date.now()}.json`;
    writeFileSync(join(fallbackDir, filename), "this is not JSON {{{");

    const reconciler = new FallbackReconciler([traceDir]);
    await reconciler.reconcileOnce();

    expect(readdirSync(fallbackDir).length).toBe(0);
    expect(reconciler.stats().expired).toBe(1);
  });

  test("start: triggers immediate reconcile; stop: clears the interval", async () => {
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1 },
      error: { name: "E", message: "m" },
      firstSeenAt: Date.now(),
      retries: 0,
    });

    const reconciler = new FallbackReconciler([traceDir], { retryIntervalMs: 10_000 });
    await reconciler.start();
    // start() awaits an immediate reconcile.
    expect(existsSync(join(sessionDir, "1.json"))).toBe(true);
    reconciler.stop();
  });

  test("multi-traceDir: processes all configured trace dirs", async () => {
    const traceDir2 = join(tempDir, "trace2");
    const session2 = "rec-test-2";
    const fallbackDir2 = join(traceDir2, session2, "fallback");
    require("node:fs").mkdirSync(fallbackDir2, { recursive: true });
    writeFallbackFile(fallbackDir, session, 1, {
      record: { id: 1 }, error: { name: "E", message: "m" },
      firstSeenAt: Date.now(), retries: 0,
    });
    writeFallbackFile(fallbackDir2, session2, 1, {
      record: { id: 2 }, error: { name: "E", message: "m" },
      firstSeenAt: Date.now(), retries: 0,
    });

    const reconciler = new FallbackReconciler([traceDir, traceDir2]);
    await reconciler.reconcileOnce();

    expect(existsSync(join(sessionDir, "1.json"))).toBe(true);
    expect(existsSync(join(traceDir2, session2, "1.json"))).toBe(true);
  });

  test("missing dirs: silently skips non-existent trace dir / session dir / fallback dir", async () => {
    const reconciler = new FallbackReconciler([join(tempDir, "does-not-exist")]);
    await reconciler.reconcileOnce();
    expect(reconciler.stats().recovered).toBe(0);
    expect(reconciler.stats().expired).toBe(0);
    expect(reconciler.stats().lastError).toBeUndefined();
  });
});
```

### Step 3.2: Run tests, expect import failure (red)

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/plugin/src/fallback-reconciler.test.ts
```

Expected: `Cannot find module './fallback-reconciler.js'`. **This is the red.**

### Step 3.3: Create FallbackReconciler

Create `packages/plugin/src/fallback-reconciler.ts`:

```typescript
import { promises as fs, type Stats } from "node:fs";
import { join } from "node:path";
import { safeRename, safeUnlink } from "@opencode-trace/core/platform";
import { logger } from "@opencode-trace/core";

interface FallbackFileHeader {
  record: unknown;
  error: { name?: string; message?: string; stack?: string };
  firstSeenAt?: number;
  retries?: number;
}

const FILENAME_REGEX_CACHE = new Map<string, RegExp>();
function buildFilenameRegex(session: string): RegExp {
  let re = FILENAME_REGEX_CACHE.get(session);
  if (!re) {
    re = new RegExp(`^${session.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)-\\d+\\.json$`);
    FILENAME_REGEX_CACHE.set(session, re);
  }
  return re;
}

export interface FallbackReconcilerOptions {
  retryIntervalMs?: number;
  ttlMs?: number;
  maxRetries?: number;
}

export interface FallbackReconcilerStats {
  pending: number;
  recovered: number;
  expired: number;
  lastError?: string;
}

export class FallbackReconciler {
  private readonly traceDirs: string[];
  private readonly retryIntervalMs: number;
  private readonly ttlMs: number;
  private readonly maxRetries: number;
  private timer: NodeJS.Timeout | null = null;
  private stats_ = { pending: 0, recovered: 0, expired: 0 };

  constructor(traceDirs: string[], options: FallbackReconcilerOptions = {}) {
    this.traceDirs = traceDirs;
    this.retryIntervalMs = options.retryIntervalMs ?? 60_000;
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.maxRetries = options.maxRetries ?? 10;
  }

  async start(): Promise<void> {
    await this.reconcileOnce();
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.reconcileOnce().catch((err) => {
        this.stats_.pending++;
        this.setLastError(err);
      });
    }, this.retryIntervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcileOnce(): Promise<void> {
    for (const traceDir of this.traceDirs) {
      let sessions: string[];
      try {
        sessions = await fs.readdir(traceDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        this.setLastError(err);
        continue;
      }
      for (const session of sessions) {
        const sessionDir = join(traceDir, session);
        const fallbackDir = join(sessionDir, "fallback");
        let files: string[];
        try {
          files = await fs.readdir(fallbackDir);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          this.setLastError(err);
          continue;
        }
        for (const filename of files) {
          await this.processOne(traceDir, session, sessionDir, fallbackDir, filename);
        }
      }
    }
  }

  stats(): FallbackReconcilerStats {
    return { ...this.stats_ };
  }

  private async processOne(
    traceDir: string,
    session: string,
    sessionDir: string,
    fallbackDir: string,
    filename: string,
  ): Promise<void> {
    const fallbackPath = join(fallbackDir, filename);
    let stat: Stats;
    try {
      stat = await fs.stat(fallbackPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      this.setLastError(err);
      return;
    }

    let header: FallbackFileHeader;
    try {
      const raw = await fs.readFile(fallbackPath, "utf-8");
      header = JSON.parse(raw);
    } catch (err) {
      await safeUnlink(fallbackPath).catch(() => {});
      logger.warn("FallbackReconciler: corrupted fallback file removed", {
        session,
        filename,
        error: String(err),
      });
      this.stats_.expired++;
      return;
    }

    const firstSeenAt = header.firstSeenAt ?? stat.mtimeMs;
    const retries = header.retries ?? 0;
    const ageMs = Date.now() - firstSeenAt;

    if (ageMs > this.ttlMs || retries > this.maxRetries) {
      await safeUnlink(fallbackPath).catch(() => {});
      logger.warn("FallbackReconciler: fallback expired", {
        session,
        filename,
        ageMs,
        retries,
        reason: ageMs > this.ttlMs ? "ttl" : "max-retries",
      });
      this.stats_.expired++;
      return;
    }

    const re = buildFilenameRegex(session);
    const m = re.exec(filename);
    if (!m) {
      logger.warn("FallbackReconciler: cannot parse filename, skipping", {
        session,
        filename,
      });
      return;
    }
    const seq = parseInt(m[1], 10);
    const finalPath = join(sessionDir, `${seq}.json`);

    try {
      await fs.stat(finalPath);
      // Main file already exists; the data has been written successfully before.
      await safeUnlink(fallbackPath).catch(() => {});
      this.stats_.recovered++;
      logger.info("FallbackReconciler: main file already exists, removing fallback", {
        session,
        seq,
      });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.setLastError(err);
        return;
      }
    }

    try {
      await fs.mkdir(sessionDir, { recursive: true });
      await safeRename(fallbackPath, finalPath);
      this.stats_.recovered++;
      logger.info("FallbackReconciler: recovered", { session, seq, ageMs });
    } catch (err) {
      this.setLastError(err);
      this.stats_.pending++;
      await this.writeBackRetries(fallbackPath, retries + 1);
    }
  }

  private async writeBackRetries(fallbackPath: string, newRetries: number): Promise<void> {
    try {
      const raw = await fs.readFile(fallbackPath, "utf-8");
      const updated = { ...JSON.parse(raw), retries: newRetries };
      const tmpPath = fallbackPath + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(updated, null, 2));
      await safeRename(tmpPath, fallbackPath);
    } catch (err) {
      logger.error("FallbackReconciler: failed to update retry count", {
        fallbackPath,
        error: String(err),
      });
    }
  }

  private setLastError(err: unknown): void {
    this.stats_.lastError = err instanceof Error ? err.message : String(err);
  }
}
```

**Note on `safeUnlink`:** This helper must exist in `@opencode-trace/core/platform`. If it doesn't, fall back to `fs.unlink(fallbackPath).catch(() => {})` (since unlink is already idempotent for ENOENT). Verify by reading `packages/core/src/platform.ts` before running. If missing, add it:

```typescript
// packages/core/src/platform.ts (add at the bottom)
export async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
```

### Step 3.4: Run tests, expect green

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/plugin/src/fallback-reconciler.test.ts
```

Expected: 10 tests pass.

### Step 3.5: Commit

```bash
cd /Users/li/Projects/opencode-trace && git add packages/plugin/src/fallback-reconciler.ts packages/plugin/src/fallback-reconciler.test.ts
git commit -m "feat(plugin): FallbackReconciler (TTL + retry) for failed writes"
```

---

## Task 4: ReadCache (新建模块)

**Files:**
- Create: `packages/core/src/store/cache.ts`
- Create: `packages/core/src/store/cache.test.ts`
- Modify: `packages/core/src/store/index.ts` (export `getReadCache()`)
- Modify: `packages/core/src/store/read.ts` (no change needed; cache calls existing functions)

### Step 4.1: Write the first failing tests

Create `packages/core/src/store/cache.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { ReadCache } from "./cache.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ReadCache", () => {
  let tempDir: string;
  let cache: ReadCache;
  let readSessionMetadataMock: ReturnType<typeof vi.fn>;
  let readTimelineIndexMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "read-cache-test-"));
    cache = new ReadCache({ ttlMs: 5_000, maxEntries: 100 });
    readSessionMetadataMock = vi.fn();
    readTimelineIndexMock = vi.fn();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("getMetadata: first call hits disk; second call within TTL uses cache", async () => {
    readSessionMetadataMock.mockResolvedValue({ title: "test" });
    const a = await cache.getMetadata("s1", readSessionMetadataMock);
    const b = await cache.getMetadata("s1", readSessionMetadataMock);
    expect(a).toEqual({ title: "test" });
    expect(b).toEqual({ title: "test" });
    expect(readSessionMetadataMock).toHaveBeenCalledTimes(1);
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  test("getMetadata: invalidate() triggers re-read", async () => {
    readSessionMetadataMock.mockResolvedValue({ title: "v1" });
    await cache.getMetadata("s1", readSessionMetadataMock);
    readSessionMetadataMock.mockResolvedValue({ title: "v2" });
    cache.invalidate("s1");
    const r = await cache.getMetadata("s1", readSessionMetadataMock);
    expect(r).toEqual({ title: "v2" });
    expect(readSessionMetadataMock).toHaveBeenCalledTimes(2);
  });

  test("getMetadata: TTL expiry triggers re-read", async () => {
    cache = new ReadCache({ ttlMs: 10 });
    readSessionMetadataMock.mockResolvedValue({ title: "v1" });
    await cache.getMetadata("s1", readSessionMetadataMock);
    await new Promise((r) => setTimeout(r, 30));
    readSessionMetadataMock.mockResolvedValue({ title: "v2" });
    const r = await cache.getMetadata("s1", readSessionMetadataMock);
    expect(r).toEqual({ title: "v2" });
    expect(readSessionMetadataMock).toHaveBeenCalledTimes(2);
  });

  test("capacity overflow: clears all entries", async () => {
    cache = new ReadCache({ ttlMs: 60_000, maxEntries: 2 });
    for (let i = 0; i < 5; i++) {
      readSessionMetadataMock.mockResolvedValue({ i });
      await cache.getMetadata(`s${i}`, readSessionMetadataMock);
    }
    const stats = cache.stats();
    expect(stats.metadataSize).toBeLessThanOrEqual(2);
    expect(stats.evictions).toBeGreaterThan(0);
  });

  test("getTimeline: same caching semantics as getMetadata", async () => {
    readTimelineIndexMock.mockResolvedValue([{ id: 1 }]);
    const a = await cache.getTimeline("s1", readTimelineIndexMock);
    const b = await cache.getTimeline("s1", readTimelineIndexMock);
    expect(a).toEqual([{ id: 1 }]);
    expect(b).toEqual([{ id: 1 }]);
    expect(readTimelineIndexMock).toHaveBeenCalledTimes(1);
  });

  test("invalidateAll: clears metadata and timeline", async () => {
    readSessionMetadataMock.mockResolvedValue({});
    readTimelineIndexMock.mockResolvedValue([]);
    await cache.getMetadata("s1", readSessionMetadataMock);
    await cache.getTimeline("s1", readTimelineIndexMock);
    cache.invalidateAll();
    expect(cache.stats().metadataSize).toBe(0);
    expect(cache.stats().timelineSize).toBe(0);
  });
});
```

### Step 4.2: Run tests, expect import failure (red)

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/core/src/store/cache.test.ts
```

Expected: `Cannot find module './cache.js'`. **This is the red.**

### Step 4.3: Create ReadCache

Create `packages/core/src/store/cache.ts`:

```typescript
import type { SessionMetadata } from "../state/index.js";
import type { TimelineEntry } from "./read.js";

export interface ReadCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

export interface ReadCacheStats {
  metadataSize: number;
  timelineSize: number;
  hits: number;
  misses: number;
  evictions: number;
}

interface CacheEntry<T> {
  value: T;
  loadedAt: number;
}

export class ReadCache {
  private readonly metadata = new Map<string, CacheEntry<SessionMetadata | null>>();
  private readonly timeline = new Map<string, CacheEntry<TimelineEntry[]>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: ReadCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5_000;
    this.maxEntries = options.maxEntries ?? 1000;
  }

  async getMetadata(
    sessionId: string,
    loader: (sessionId: string) => Promise<SessionMetadata | null>,
  ): Promise<SessionMetadata | null> {
    const cached = this.metadata.get(sessionId);
    if (cached && Date.now() - cached.loadedAt < this.ttlMs) {
      this.hits++;
      return cached.value;
    }
    this.misses++;
    const value = await loader(sessionId);
    this.setMetadata(sessionId, value);
    return value;
  }

  async getTimeline(
    sessionId: string,
    loader: (sessionId: string) => Promise<TimelineEntry[]>,
  ): Promise<TimelineEntry[]> {
    const cached = this.timeline.get(sessionId);
    if (cached && Date.now() - cached.loadedAt < this.ttlMs) {
      this.hits++;
      return cached.value;
    }
    this.misses++;
    const value = await loader(sessionId);
    this.setTimeline(sessionId, value);
    return value;
  }

  invalidate(sessionId: string): void {
    this.metadata.delete(sessionId);
    this.timeline.delete(sessionId);
  }

  invalidateAll(): void {
    this.metadata.clear();
    this.timeline.clear();
  }

  stats(): ReadCacheStats {
    return {
      metadataSize: this.metadata.size,
      timelineSize: this.timeline.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private setMetadata(sessionId: string, value: SessionMetadata | null): void {
    this.evictIfNeeded();
    this.metadata.set(sessionId, { value, loadedAt: Date.now() });
  }

  private setTimeline(sessionId: string, value: TimelineEntry[]): void {
    this.evictIfNeeded();
    this.timeline.set(sessionId, { value, loadedAt: Date.now() });
  }

  private evictIfNeeded(): void {
    const total = this.metadata.size + this.timeline.size;
    if (total >= this.maxEntries) {
      this.evictions += this.metadata.size + this.timeline.size;
      this.metadata.clear();
      this.timeline.clear();
    }
  }
}

let defaultInstance: ReadCache | null = null;

export function getReadCache(): ReadCache {
  if (!defaultInstance) {
    defaultInstance = new ReadCache();
  }
  return defaultInstance;
}
```

**Note on type imports:** `SessionMetadata` lives in `packages/core/src/state/index.ts:29` and `TimelineEntry` lives in `packages/core/src/store/read.ts:50`. Since `cache.ts` is in the same package, use relative imports:

```typescript
import type { TimelineEntry } from "./read.js";
import type { SessionMetadata } from "../state/index.js";
```

Verified at plan-time by reading the actual source files.

### Step 4.4: Run tests, expect green

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/core/src/store/cache.test.ts
```

Expected: 6 tests pass.

### Step 4.5: Commit

```bash
cd /Users/li/Projects/opencode-trace && git add packages/core/src/store/cache.ts packages/core/src/store/cache.test.ts
git commit -m "feat(core): ReadCache for metadata + timeline (TTL + capacity)"
```

---

## Task 5: 接入 ReadCache 到所有读取路径

**Files:**
- Modify: `packages/core/src/store/index.ts` (export `getReadCache`)
- Modify: `packages/core/src/store/write.ts` (use cache for readSessionMetadata)
- Modify: `packages/core/src/store/export.ts` (use cache for readSessionMetadata)
- Modify: `packages/cli/src/utils.ts` (use cache for readSessionMetadata)
- Modify: `packages/viewer/src/server.ts` (use cache for readTimelineIndex; chokidar invalidates)
- Modify: `packages/viewer/src/server.test.ts` (mocks for `getReadCache` if needed; chokidar test)

### Step 5.1: Export `getReadCache` from core

In `packages/core/src/store/index.ts`, add to the exports:

```typescript
export { getReadCache, ReadCache } from "./cache.js";
```

### Step 5.2: Replace `readSessionMetadata` call in `write.ts`

In `packages/core/src/store/write.ts`, find line 59 (the `await readSessionMetadata(...)` call inside the function that creates a session dir). Replace:

```typescript
// before
import { resolveDir, readSessionMetadata, listSessions } from "./read.js";
// ...
const metadata = await readSessionMetadata(sessionId, traceDir);
```

with:

```typescript
// after
import { resolveDir, readSessionMetadata, listSessions } from "./read.js";
import { getReadCache } from "./cache.js";
// ...
const metadata = await getReadCache().getMetadata(sessionId, (id) =>
  readSessionMetadata(id, { traceDir }),
);
```

Note the call signature: `readSessionMetadata(sessionId, { traceDir })` instead of `readSessionMetadata(sessionId, traceDir)`. If the second arg pattern is positional in the codebase, keep the positional call inside the loader:

```typescript
const metadata = await getReadCache().getMetadata(sessionId, (id) =>
  readSessionMetadata(id, traceDir),
);
```

(Read `packages/core/src/store/read.ts` line 469 area to confirm the signature, then match it.)

### Step 5.3: Replace `readSessionMetadata` in `export.ts`

In `packages/core/src/store/export.ts`, lines 57 and 145. Pattern is the same as 5.2.

### Step 5.4: Replace `readSessionMetadata` in `cli/utils.ts`

In `packages/cli/src/utils.ts`, lines 116 and 119. Same pattern. Add the import.

### Step 5.5: Replace `readTimelineIndex` in `viewer/server.ts`

In `packages/viewer/src/server.ts`, lines 226 and 380. Replace:

```typescript
const timelineEntries = await store.readTimelineIndex(sessionId, { ... });
```

with:

```typescript
import { getReadCache } from "@opencode-trace/core/store";
// ...
const timelineEntries = await getReadCache().getTimeline(sessionId, (id) =>
  store.readTimelineIndex(id, { ... }),
);
```

(Or import from the package's main entry point if `getReadCache` is re-exported there.)

### Step 5.6: Hook chokidar to invalidate cache

In `packages/viewer/src/server.ts`, find the chokidar watcher setup (search for `chokidar.watch` or `watch(`). In each `add` / `change` callback that fires for `metadata.json` or `timeline.ndjson`, add:

```typescript
import { getReadCache } from "@opencode-trace/core/store";
// ...
chokidar.watch(...).on("change", (filePath) => {
  if (filePath.endsWith("metadata.json") || filePath.endsWith("timeline.ndjson")) {
    const sessionId = path.basename(path.dirname(filePath));
    getReadCache().invalidate(sessionId);
  }
});
```

**Match the actual structure of the existing chokidar wiring in server.ts** — copy the style and just add the `invalidate` call.

### Step 5.7: Update viewer/server.test.ts mocks if necessary

If the existing viewer tests construct a session and then immediately read it, the cache might serve stale data across tests. Add `getReadCache().invalidateAll()` in `beforeEach` of the test suite, or pass a fresh cache per test.

A minimal change: at the top of `describe(...)` in `packages/viewer/src/server.test.ts`, add:

```typescript
import { getReadCache } from "@opencode-trace/core/store";
// ...
beforeEach(() => {
  getReadCache().invalidateAll();
});
```

### Step 5.8: Typecheck the whole project

```bash
cd /Users/li/Projects/opencode-trace && npx tsc --noEmit
```

Expected: 0 errors. Fix any type mismatches (e.g., `SessionMetadata` import path).

### Step 5.9: Run all tests

```bash
cd /Users/li/Projects/opencode-trace && npm run test
```

Expected: all 8 turbo tasks pass. Total tests should be ≥ 642 (current 631 + new: 6 cache + 10 reconciler + ~3 net write-queue = ~650).

### Step 5.10: Commit

```bash
cd /Users/li/Projects/opencode-trace && git add packages/core/src/store/index.ts packages/core/src/store/cache.ts packages/core/src/store/write.ts packages/core/src/store/export.ts packages/cli/src/utils.ts packages/viewer/src/server.ts packages/viewer/src/server.test.ts
git commit -m "feat: integrate ReadCache into all metadata/timeline call sites + chokidar invalidation"
```

---

## Task 6: 接入 FallbackReconciler 到 plugin-instance

**Files:**
- Modify: `packages/plugin/src/plugin-instance.ts` (init/shutdown hooks)

### Step 6.1: Start reconciler in init()

In `packages/plugin/src/plugin-instance.ts`, find `init()` (or whatever method performs plugin startup). At the end of init, after `this.writeQueue` is constructed, add:

```typescript
import { FallbackReconciler } from "./fallback-reconciler.js";
// ...
private fallbackReconciler: FallbackReconciler | null = null;

// Inside init(), after writeQueue creation:
this.fallbackReconciler = new FallbackReconciler([this.resolveTraceDir(...)]);
await this.fallbackReconciler.start();
```

(Adjust `resolveTraceDir(...)` to whatever the actual method that returns the current trace directory is — read the existing init method to find the right call.)

### Step 6.2: Stop reconciler in shutdown()

In the same file, find `shutdown()` (or `close()`). Add at the end:

```typescript
this.fallbackReconciler?.stop();
this.fallbackReconciler = null;
```

### Step 6.3: Run all plugin tests

```bash
cd /Users/li/Projects/opencode-trace && npx vitest run packages/plugin
```

Expected: all tests pass. If any test fails because reconciler is created during init, adjust the test setup (e.g., make init optional, or pass a no-op reconciler in tests).

### Step 6.4: Commit

```bash
cd /Users/li/Projects/opencode-trace && git add packages/plugin/src/plugin-instance.ts
git commit -m "feat(plugin): start FallbackReconciler on init, stop on shutdown"
```

---

## Task 7: 最终验证

### Step 7.1: Typecheck

```bash
cd /Users/li/Projects/opencode-trace && npx tsc --noEmit
```

Expected: 0 errors.

### Step 7.2: Build

```bash
cd /Users/li/Projects/opencode-trace && npm run build
```

Expected: 4/4 packages green.

### Step 7.3: Full test run

```bash
cd /Users/li/Projects/opencode-trace && npm run test
```

Expected: 8/8 turbo tasks pass.

### Step 7.4: Manual smoke (optional but recommended)

```bash
# Start viewer
cd /Users/li/Projects/opencode-trace && npm run viewer -- --no-open &
# Wait 3s, kill
sleep 3 && kill %1
```

Expected: viewer starts on port 3210, prints "Cache: ..." or "Reconciler: ..." log lines (depending on logger config), no errors.

### Step 7.5: Final commit (if anything left dirty)

```bash
cd /Users/li/Projects/opencode-trace && git status
# If anything unstaged, review and commit.
```

---

## Acceptance Checklist

- [ ] `npx tsc --noEmit`: 0 errors
- [ ] `npm run build`: 4/4 packages green
- [ ] `npm run test`: 8/8 tasks pass, total tests ≥ 650
- [ ] `AsyncWriteQueue.enqueue()` is async and blocks at capacity
- [ ] `ReadCache` exists and is wired into write.ts, export.ts, utils.ts, viewer server.ts
- [ ] chokidar `metadata.json` / `timeline.ndjson` changes invalidate the cache
- [ ] `FallbackReconciler` exists; runs on plugin start + every 60s
- [ ] Fallback files older than 7 days OR with retries > 10 are deleted
- [ ] `stats()` is available on all three new/updated components
- [ ] 7 new commits in git log, each scoped to a single task
