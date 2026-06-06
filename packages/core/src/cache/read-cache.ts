export interface ReadCacheOptions {
  maxSize?: number;
  ttlMs?: number;
}

interface Entry<TValue> {
  value: TValue;
  expiresAt: number;
}

/**
 * In-memory LRU + TTL cache for read-through lookups.
 *
 * - `get(key, loader)` returns the cached value or invokes `loader()` to populate.
 * - Loader return values (including `null`/`undefined`) are cached for `ttlMs`.
 * - Exceptions thrown by the loader are NOT cached.
 * - Eviction is LRU when `size > maxSize`.
 */
export class ReadCache<TKey, TValue> {
  private maxSize: number;
  private ttlMs: number;
  private store: Map<TKey, Entry<TValue>> = new Map();

  constructor(options: ReadCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 500;
    this.ttlMs = options.ttlMs ?? 5000;
  }

  get(key: TKey, loader: () => TValue): TValue {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > now) {
      this.store.delete(key);
      this.store.set(key, hit);
      return hit.value;
    }
    if (hit) {
      this.store.delete(key);
    }
    const value = loader();
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
    this.enforceLimit();
    return value;
  }

  invalidate(key: TKey): void {
    this.store.delete(key);
  }

  invalidateMatching(predicate: (key: TKey) => boolean): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (predicate(key)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  invalidateAll(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  private enforceLimit(): void {
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}
