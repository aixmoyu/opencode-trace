# 写入队列背压 / 读取缓存预热 / Fallback 自愈 — Design Spec

**Date:** 2026-06-06
**Status:** Draft
**Author:** Brainstorming session output

## Background

`@opencode-trace` 在 `plugin` (写) + `viewer`/`cli` (读) 路径上存在三处可观察的性能/可靠性问题，已通过 refactor（同步 I/O 改异步、`flush()` 改信号通知）解决了表面症状，但底层结构性问题未动：

1. **写入队列无容量上限**：`AsyncWriteQueue.queue` 是一个无界 `Array`。高并发 fetch（多个 session 同时活跃）会让队列在内存里无限增长，触发 OOM。
2. **读取无缓存**：`readSessionMetadata()` / `readTimelineIndex()` 每次都从磁盘重读。`metadata.json` 和 `timeline.ndjson` 在 viewer 一次页面生命周期内会被读多次。
3. **Fallback 目录只写不收**：`writeFallback()` 把失败记录写入 `<traceDir>/<session>/fallback/`，但没有读取/重试/清理机制。

## Goals

- 写入路径有界：内存可预测；超载时让 fetch 拦截自然减速；**不丢任何 trace**。
- 读取路径有 L1 缓存：viewer 列表/详情页打开时，metadata + timeline 命中内存。
- Fallback 目录自愈：临时故障自动恢复；持久故障不会无限累积。

## Non-Goals

- 不缓存 `*.parsed` 或 `*.json`（parsed 缓存的瓶颈小；raw json 内存风险大）。
- 不引入新的第三方依赖（`lru-cache` 等）。所有实现用 Node 内置模块。
- 不改 viewer/CLI 的协议层（HTTP API、CLI 命令、文件格式不变）。
- 不动 SSE/chokidar 的事件模型。

---

## Design

### 1. `AsyncWriteQueue` — 背压控制

**文件：** `packages/plugin/src/write-queue.ts`

**API 变化：**

```typescript
// 旧
enqueue(session, seq, record, timelineEntry?, traceDir?, options?): void

// 新
async enqueue(session, seq, record, timelineEntry?, traceDir?, options?): Promise<void>
```

**配置（新增构造选项）：**

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `capacity` | 1000 | 队列最大长度 |
| `softLimitRatio` | 0.8 | 软上限 = `capacity * softLimitRatio` |
| `softWarnIntervalMs` | 60_000 | 软上限告警节流间隔 |

**实现：**

```typescript
class AsyncWriteQueue {
  private readonly capacity: number;
  private readonly softLimit: number;
  private softWarnLastAt = 0;
  private notFullResolvers: Array<() => void> = [];

  constructor(
    private readonly defaultTraceDir: string,
    options?: { capacity?: number; softLimitRatio?: number; softWarnIntervalMs?: number }
  ) {
    this.capacity = options?.capacity ?? 1000;
    this.softLimit = Math.floor(this.capacity * (options?.softLimitRatio ?? 0.8));
  }

  async enqueue(
    session: string,
    seq: number,
    record: TraceRecord,
    timelineEntry?: TimelineEntry,
    traceDir?: string,
    options?: { forceFallback?: boolean }
  ): Promise<void> {
    if (this.closed) {
      // 关闭后入队走 fallback，保持现有 forceFallback 语义
      await this.writeFallback(session, seq, record, new Error("Queue is closed"), traceDir ?? this.defaultTraceDir);
      return;
    }

    // 软上限：节流告警
    if (this.queue.length >= this.softLimit) {
      const now = Date.now();
      if (now - this.softWarnLastAt >= this.softWarnIntervalMs) {
        this.softWarnLastAt = now;
        logger.warn("AsyncWriteQueue near capacity", {
          queueLen: this.queue.length,
          capacity: this.capacity,
        });
      }
    }

    // 硬上限：背压
    while (this.queue.length >= this.capacity) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.notFullResolvers.push(resolve);
      await promise;
    }

    this.queue.push({ session, seq, record, timelineEntry, traceDir: traceDir ?? this.defaultTraceDir, forceFallback: options?.forceFallback });
    this.processQueue();
  }

  private notifyNotFull(): void {
    if (this.notFullResolvers.length === 0) return;
    const waiters = this.notFullResolvers;
    this.notFullResolvers = [];
    for (const resolve of waiters) resolve();
  }
}
```

`processQueue()` 在 `splice(0, batchSize)` 之后调用 `this.notifyNotFull()`，唤醒一个等待中的 `enqueue()`。

**`processQueue()` 改造**：

```typescript
private async processQueue(): Promise<void> {
  this.writing = true;
  try {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      if (batch.length > 0) {
        this.notifyNotFull(); // 唤醒一个等待的 enqueue
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
```

**调用方改动：**

`packages/plugin/src/plugin-instance.ts` 的 `wrapFetch` 拦截路径：

```typescript
// 旧
queue.enqueue(session, seq, record, timelineEntry, traceDir);

// 新
await queue.enqueue(session, seq, record, timelineEntry, traceDir);
```

由于 `enqueue()` 现在是 `Promise<void>`，原 `void` 调用点需要 `await`。`wrapFetch` 本身是 `async`，改动无侵入。

**关键不变量：**

- `await enqueue()` 返回时，item 一定在 `this.queue` 内（背压解除了 = 队列有空位 + 刚 push 完成）
- 队列满时 `enqueue()` 不返回，但 `processQueue()` 不会永久饥饿（每个 batch 完成后 `notifyNotFull()`）
- 关闭后 `enqueue()` 走 fallback，保留现有语义
- 现有 `flush()` 信号机制不变（idleResolvers），新机制只是再加一组 notFullResolvers

**`stats()` 新增字段**（用于诊断）：

```typescript
stats(): {
  depth: number;          // 当前 queue.length
  peak: number;           // 历史最大值
  capacity: number;       // 配置容量
  softWarnings: number;   // 软上限告警累计次数
  blockEvents: number;    // enqueue 被阻塞的总次数
}
```

### 2. `ReadCache` — 元数据 + Timeline 内存缓存

**文件：** `packages/core/src/store/cache.ts`（新文件）

**API：**

```typescript
class ReadCache {
  private metadata = new Map<string, { value: SessionMetadata | null; loadedAt: number }>();
  private timeline = new Map<string, { value: TimelineEntry[]; loadedAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = options?.ttlMs ?? 5_000;
    this.maxEntries = options?.maxEntries ?? 1000;
  }

  async getMetadata(sessionId: string, options?: StoreOptions): Promise<SessionMetadata | null>;
  async getTimeline(sessionId: string, options?: StoreOptions): Promise<TimelineEntry[]>;
  invalidate(sessionId: string): void;   // 删一个 session 的全部缓存
  invalidateAll(): void;
  stats(): { metadataSize: number; timelineSize: number; hits: number; misses: number; evictions: number };
}
```

**命中逻辑：**

```typescript
async getMetadata(sessionId: string, options?: StoreOptions): Promise<SessionMetadata | null> {
  const cached = this.metadata.get(sessionId);
  if (cached && Date.now() - cached.loadedAt < this.ttlMs) {
    this.hits++;
    return cached.value;
  }
  this.misses++;
  const value = await readSessionMetadata(sessionId, options);
  this.setMetadata(sessionId, value);
  return value;
}
```

**容量控制：**

简单的"满了全清"策略。每次 `set*()` 之前检查 size，超出 `maxEntries` 则 `invalidateAll()`，避免实现 LRU 复杂度。LRU 的边际收益在 session list 这种场景下不值得维护。

```typescript
private setMetadata(sessionId: string, value: SessionMetadata | null): void {
  if (this.metadata.size >= this.maxEntries) {
    this.evictions += this.metadata.size;
    this.metadata.clear();
    this.timeline.clear(); // 一起清，保证一致性
  }
  this.metadata.set(sessionId, { value, loadedAt: Date.now() });
}
```

**接入路径：**

1. `readSessionMetadata()` 调用方（`store/write.ts`, `store/export.ts`, `cli/utils.ts`）→ 改走 `readCache.getMetadata()`。
2. `readTimelineIndex()` 调用方（`viewer/src/server.ts`）→ 改走 `readCache.getTimeline()`。
3. `packages/core/src/store/index.ts` 导出 `getReadCache()` 单例（lazy 初始化）。

**失效机制：**

- viewer 启动时已存在 chokidar 监听 `<traceDir>/<session>/metadata.json` 和 `timeline.ndjson` 的 add/change 事件（已实现）。
- 在 `server.ts` 的 chokidar 回调里加：`if (path.endsWith("metadata.json") || path.endsWith("timeline.ndjson")) readCache.invalidate(sessionId)`。
- TTL 是兜底：watcher 漏事件也不会永久 stale（5 秒后下次读取会重读磁盘）。
- 写入路径不直接调用 `invalidate()`，靠 watcher 异步失效，避免回环。

**单例 vs 实例：**

- 默认导出单例（`getReadCache()` lazy 初始化）。
- 测试时可以 `new ReadCache({ ttlMs: 0 })` 禁用 TTL 验证失效路径。

**内存预算：**

- 默认 1000 sessions × (metadata 500B + timeline 200KB) ≈ 200MB 上限。
- 实际上大多数用户远低于此。
- 不实现精确内存追踪，靠 `maxEntries` 数量控制。

### 3. `FallbackReconciler` — 重试 + TTL 双重保险

**文件：** `packages/plugin/src/fallback-reconciler.ts`（新文件）

**`writeFallback()` 写入格式扩展：**

现有 `writeFallback()` 已经写入：

```json
{
  "record": {...},
  "error": { "name": "...", "message": "...", ... }
}
```

扩展为：

```json
{
  "record": {...},
  "error": {...},
  "firstSeenAt": 1717699200000,
  "retries": 0
}
```

- `firstSeenAt`：写 fallback 文件时记录（向后兼容：旧 fallback 文件没有这个字段时，按 `fileMtimeMs` 回退）。
- `retries`：重试失败时 +1（成功时随文件被 unlink 而消失）。

**API：**

```typescript
class FallbackReconciler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly traceDirs: string[],
    private readonly options?: {
      retryIntervalMs?: number;   // 默认 60_000
      ttlMs?: number;             // 默认 7 * 24 * 60 * 60 * 1000
      maxRetries?: number;        // 默认 10
    }
  ) {}

  async start(): Promise<void>;  // 立即 reconcile 一次 + 启动 setInterval
  stop(): void;                  // 清 setInterval
  async reconcileOnce(): Promise<void>;
  stats(): { pending: number; recovered: number; expired: number; lastError?: string };
}
```

**`reconcileOnce()` 流程：**

```typescript
async reconcileOnce(): Promise<void> {
  for (const traceDir of this.traceDirs) {
    // 安全列出所有 session 目录
    let sessions: string[];
    try {
      sessions = await fs.readdir(traceDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      this.lastError = String(err);
      logger.error("FallbackReconciler: failed to read trace dir", { traceDir, error: String(err) });
      continue;
    }

    for (const session of sessions) {
      const fallbackDir = join(traceDir, session, "fallback");
      let files: string[];
      try {
        files = await fs.readdir(fallbackDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        this.lastError = String(err);
        continue;
      }

      for (const filename of files) {
        await this.processOne(traceDir, session, fallbackDir, filename);
      }
    }
  }
}

private async processOne(
  traceDir: string,
  session: string,
  fallbackDir: string,
  filename: string
): Promise<void> {
  const fallbackPath = join(fallbackDir, filename);
  let stat: Stats;
  try {
    stat = await fs.stat(fallbackPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // 并发删除，跳过
    throw err;
  }

  // 读 metadata 头部
  let header: { record: TraceRecord; error: any; firstSeenAt?: number; retries?: number };
  try {
    const raw = await fs.readFile(fallbackPath, "utf-8");
    header = JSON.parse(raw);
  } catch (err) {
    // 文件损坏：立即删 + warn
    await safeUnlink(fallbackPath);
    logger.warn("FallbackReconciler: corrupted fallback file removed", { fallbackPath, error: String(err) });
    this.expired++;
    return;
  }

  const firstSeenAt = header.firstSeenAt ?? stat.mtimeMs;
  const retries = header.retries ?? 0;
  const ageMs = Date.now() - firstSeenAt;

  // TTL 或 重试次数 超限 → 删除
  if (ageMs > this.ttlMs || retries > this.maxRetries) {
    await safeUnlink(fallbackPath);
    logger.warn("FallbackReconciler: fallback expired", {
      session,
      filename,
      ageMs,
      retries,
      reason: ageMs > this.ttlMs ? "ttl" : "max-retries",
    });
    this.expired++;
    return;
  }

  // 尝试恢复：原子 rename 回主路径
  // 主路径文件名规则：parse filename "${session}-${seq}-${ts}.json" → seq
  const seqMatch = filename.match(new RegExp(`^${escapeRegex(session)}-(\\d+)-\\d+\\.json$`));
  if (!seqMatch) {
    // 旧格式/格式损坏：保留不动，依赖 TTL 自然清理
    logger.warn("FallbackReconciler: cannot parse filename, skipping", { fallbackPath, filename });
    return;
  }
  const seq = parseInt(seqMatch[1], 10);
  const sessionDir = join(traceDir, session);
  const finalPath = join(sessionDir, `${seq}.json`);

  // 主路径已存在（说明 retry 之前已经成功过）→ 直接删 fallback
  try {
    await fs.stat(finalPath);
    await safeUnlink(fallbackPath);
    this.recovered++;
    logger.info("FallbackReconciler: main file already exists, removing fallback", { session, seq });
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      this.lastError = String(err);
      return;
    }
    // ENOENT = 主路径不存在，继续重试
  }

  try {
    await fs.mkdir(sessionDir, { recursive: true });
    await safeRename(fallbackPath, finalPath); // 原子操作
    this.recovered++;
    logger.info("FallbackReconciler: recovered", { session, seq, ageMs });
  } catch (err) {
    // 失败：retries +1 写回文件
    this.lastError = String(err);
    this.pending++;
    const newRetries = retries + 1;
    try {
      const raw = await fs.readFile(fallbackPath, "utf-8");
      const updated = { ...JSON.parse(raw), retries: newRetries };
      // 原子写回：tmp + rename
      const tmpPath = fallbackPath + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(updated));
      await safeRename(tmpPath, fallbackPath);
    } catch (writeBackErr) {
      // 写回失败：保留原文件，下次再试
      logger.error("FallbackReconciler: failed to update retry count", { fallbackPath, error: String(writeBackErr) });
    }
  }
}
```

**生命周期：**

- plugin 启动 → 创建 `reconciler = new FallbackReconciler([traceDir])` → `reconciler.start()`
- plugin 关闭 → `reconciler.stop()`（`clearInterval`）
- 多 traceDir（global + local）：plugin 的 `resolveTraceDir` 返回的是单个目录，但理论上用户在两个模式间切换会创建两个。reconciler 接 `traceDirs: string[]` 是为了以后支持；本期默认只传当前活跃目录。

**接入点：**

`packages/plugin/src/plugin-instance.ts` 在 `init()` 末尾添加：
```typescript
this.fallbackReconciler = new FallbackReconciler([traceDir]);
await this.fallbackReconciler.start();
```

`shutdown()` 末尾添加：
```typescript
this.fallbackReconciler?.stop();
```

**与 `AsyncWriteQueue` 的关系：**

- `writeFallback()` 写入的 schema 由 `AsyncWriteQueue` 控制 → 需要 `AsyncWriteQueue` 暴露一个钩子让 reconciler 知道 schema（或者 schema 写死在 `FallbackReconciler` 里，与 `AsyncWriteQueue` 同步）。
- 选择：把 `firstSeenAt` 写入逻辑放进 `AsyncWriteQueue.writeFallback()` 内部，reconciler 只需要读这个字段。
- `retries` 字段由 reconciler 写入。

### 4. 错误处理 / 可观测性

**日志：**

| 事件 | Level | 字段 | 节流 |
|------|-------|------|------|
| 队列软上限 | warn | `{queueLen, capacity}` | 1 次/分钟 |
| 队列硬上限阻塞 | debug | `{blockedAt, queueLen}` | 不节流（debug） |
| Cache 失效 | debug | `{sessionId, reason}` | 不节流 |
| Reconciler 恢复 | info | `{session, seq, ageMs}` | 不节流 |
| Reconciler 丢弃 | warn | `{session, filename, ageMs, retries, reason}` | 不节流 |
| Reconciler 错误 | error | `{traceDir, error}` | 不节流 |

**`stats()` 全部对象化：**

```typescript
// AsyncWriteQueue
stats(): { depth: number; peak: number; capacity: number; softWarnings: number; blockEvents: number }

// ReadCache
stats(): { metadataSize: number; timelineSize: number; hits: number; misses: number; evictions: number }

// FallbackReconciler
stats(): { pending: number; recovered: number; expired: number; lastError?: string }
```

`peak` 字段：`AsyncWriteQueue` 在 `enqueue()` 末尾检查 `if (this.queue.length > this.peak) this.peak = this.queue.length`。

`blockEvents`：`enqueue()` 进入背压 `while` 循环时 +1。

### 5. 测试策略

每个模块按 TDD：先写失败测试，再实现。

**`AsyncWriteQueue` 新增测试** (`packages/plugin/src/write-queue.test.ts`)：

1. `enqueue` returns a Promise（类型签名验证）
2. `enqueue` resolves immediately when queue is below capacity
3. `enqueue` blocks when queue is at capacity; resolves after processQueue drains
4. Concurrent enqueues: 1500 enqueue promises to a capacity-1000 queue complete in submission order, no records dropped
5. `softWarn` fires once when crossing softLimit, not again within softWarnIntervalMs
6. `stats()` reflects peak depth and blockEvents
7. 回归：所有现有 166 个 plugin 测试通过

**`ReadCache` 新增测试** (`packages/core/src/store/cache.test.ts`)：

1. First `getMetadata` calls disk; second call within TTL uses cache (mock `readSessionMetadata`, assert call count)
2. `invalidate(sessionId)` triggers re-read
3. TTL expiry triggers re-read (use `ttlMs: 10` + `sleep(20)`)
4. Capacity overflow clears all entries
5. `stats()` increments hits/misses/evictions
6. Concurrent `getMetadata` for same sessionId → both reads miss the cache and hit disk; the second `set` is a no-op overwrite (acceptable: one extra disk read on a cold-miss race; explicit coalescing via in-flight map is left for future work to keep v1 simple)

**`FallbackReconciler` 新增测试** (`packages/plugin/src/fallback-reconciler.test.ts`)：

1. Fresh fallback file (no `firstSeenAt` in body, only `mtime`): reconciler uses `mtimeMs` as firstSeenAt
2. Recent fallback file with `retries=0`: reconciler attempts rename, succeeds, removes fallback, increments `recovered`
3. Recent fallback file with `retries=0`, main file already exists: reconciler removes fallback
4. Recent fallback file with rename failure: `retries` increments, file retained
5. Fallback file older than TTL: removed with warn log
6. Fallback file with `retries > maxRetries`: removed with warn log
7. Corrupted fallback file (invalid JSON): removed with warn log
8. `start()` triggers immediate `reconcileOnce()`; `stop()` clears the interval
9. Multi-traceDir: reconciler processes all dirs
10. ENOENT trace dir / fallback dir: silently skipped (not an error)

**手动性能基准（不自动化，记到 PR 描述）：**

- viewer 加载 1000 sessions 的 session list 时间（前/后对比）
- enqueue 满队列时 P99 延迟（前/后对比）

### 6. 文件清单

**新增：**

- `packages/core/src/store/cache.ts` — `ReadCache` class
- `packages/core/src/store/cache.test.ts`
- `packages/plugin/src/fallback-reconciler.ts` — `FallbackReconciler` class
- `packages/plugin/src/fallback-reconciler.test.ts`

**修改：**

- `packages/plugin/src/write-queue.ts` — `enqueue()` 改 async + 背压；`writeFallback()` 写入 `firstSeenAt`；新增 `stats()` 字段
- `packages/plugin/src/write-queue.test.ts` — 新增 6 个测试
- `packages/plugin/src/plugin-instance.ts` — `wrapFetch` 加 `await`；`init()` 启动 reconciler；`shutdown()` 停止 reconciler
- `packages/core/src/store/read.ts` — 无内部改动（只暴露底层 `readSessionMetadata` / `readTimelineIndex` 给 cache 调）
- `packages/core/src/store/index.ts` — 导出 `getReadCache()` 单例
- `packages/core/src/store/write.ts` — `readSessionMetadata` 调用改走 `readCache.getMetadata`
- `packages/core/src/store/export.ts` — 同上
- `packages/cli/src/utils.ts` — 同上
- `packages/viewer/src/server.ts` — `readTimelineIndex` 改走 `readCache.getTimeline`；chokidar `metadata.json` / `timeline.ndjson` 变化时 `readCache.invalidate(sessionId)`
- `packages/core/src/record/control.ts`（如果使用 readSessionMetadata）— 改走 cache

**未改：**

- `packages/cli/src/handlers/*` — 不需要改动
- `packages/viewer/src/frontend/**` — 不需要改动
- `docs/` 中除本 spec 外

### 7. 兼容性 / 迁移

**无破坏性 API 变化**：
- `AsyncWriteQueue.enqueue()` 从 `void` 变 `Promise<void>` 是 binary-breaking 但源码兼容（调用方加 `await` 即可，TypeScript 强制）。
- `readSessionMetadata` / `readTimelineIndex` 签名不变；调用方通过 `readCache.getMetadata/getTimeline` 走缓存路径。
- 旧的 fallback 文件（无 `firstSeenAt`）由 reconciler 通过 `mtimeMs` 回退支持。

**配置变化**：
- `AsyncWriteQueue` 构造支持可选 options（向后兼容）。
- `ReadCache` 是惰性初始化的单例。
- `FallbackReconciler` 是新模块，无配置项。

**CI 影响**：
- 测试运行时间预计 +5-10s（新增的 reconciler / cache 测试）。
- 类型检查 `npx tsc --noEmit` 应该依然 clean。
- Windows CI 兼容性：所有文件操作使用 `safeRename` / `safeUnlink`（已存在）。

### 8. 风险与缓解

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| `enqueue()` 变 async 后被遗漏 `await` | 高 | TypeScript 编译期报错（`Promise<void>` 不可丢弃会有 lint warning），且 `plugin-instance.ts` 是唯一调用方 |
| 背压阻塞让 fetch 拦截路径变慢 | 中 | 用户已选 backpressure；如果发现 P99 > 100ms，可调低 capacity |
| Cache TTL 太短 → 命中率低 | 低 | 5s 是保守值；可配置；实测后再调 |
| Cache TTL 太长 → 显示 stale 数据 | 中 | 5s + chokidar 主动失效双保险 |
| Reconciler 周期扫描消耗 IO | 低 | 60s 间隔 + 只列目录、不读内容（除非要处理） |
| Reconciler rename 与正常写并发冲突 | 中 | 正常写路径 `safeRename` 已经重试；reconciler 走主路径前 `stat` 一次主路径，若存在则直接删 fallback（不冲突） |
| 同一 seq 的 reconciler 与正常写并发 (race) | 低 | 重叠窗口极小（reconciler 60s 周期），最坏情况是 fallback 旧内容先到主路径、正常写新内容随后失败 → 旧内容保留、新内容进新 fallback 文件。下一个 reconciler 周期发现主路径已存在，删除新 fallback（新内容丢失）。**这是已知的轻度数据竞争**，暂不处理（与现有 fallback 行为一致；引入加锁会显著复杂化）。 |
| Reconciler 写回 retries 时再次失败 | 低 | 保留原文件，下次再试；TTL/重试次数兜底 |

### 9. 验收标准

- [ ] `npx tsc --noEmit` 零错误
- [ ] `npm run build` 4/4 包通过
- [ ] `npm run test` 8/8 turbo 任务通过；总测试数 ≥ 现有 + 22（新测试）
- [ ] viewer 列表页加载 1000 sessions 时间 < 现有（手动验证，记到 PR）
- [ ] 写满队列时无记录丢失（自动化测试覆盖）
- [ ] Fallback 文件在临时故障恢复后自动消失（自动化测试覆盖）
- [ ] Fallback 文件在 TTL/重试上限后自动清理（自动化测试覆盖）
- [ ] 三个 stats() 都能在运行时打印
- [ ] `git log` 显示 commit 关联到本 spec

### 10. 后续可考虑（不在本期）

- Cache LRU 而非"满了全清"
- Cache 预热（启动时并行加载所有 metadata）
- Reconciler 多 traceDir 并发处理
- `AsyncWriteQueue` 持久化（重启后恢复未写入的队列）
- 用 `lru-cache` 替换手写 Map
