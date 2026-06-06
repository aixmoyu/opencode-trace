import { describe, test, expect, beforeEach, vi } from "vitest";
import { ReadCache } from "./read-cache.js";

describe("ReadCache", () => {
  let cache: ReadCache<string, number>;

  beforeEach(() => {
    cache = new ReadCache<string, number>({ maxSize: 3, ttlMs: 1000 });
  });

  test("get() calls the loader on a cache miss and returns the loaded value", () => {
    const loader = vi.fn(() => 42);

    const result = cache.get("key-1", loader);

    expect(result).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("get() returns the cached value on a cache hit without re-invoking the loader", () => {
    const loader = vi.fn(() => 99);
    cache.get("key-1", loader);

    const result = cache.get("key-1", loader);

    expect(result).toBe(99);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test("invalidate(key) removes a single entry", () => {
    const loaderA = vi.fn(() => 1);
    const loaderB = vi.fn(() => 2);
    cache.get("a", loaderA);
    cache.get("b", loaderB);

    expect(cache.size()).toBe(2);

    cache.invalidate("a");

    expect(cache.size()).toBe(1);
    expect(loaderA).toHaveBeenCalledTimes(1);

    cache.get("a", loaderA);
    cache.get("b", loaderB);

    expect(loaderA).toHaveBeenCalledTimes(2);
    expect(loaderB).toHaveBeenCalledTimes(1);
    expect(cache.size()).toBe(2);
  });

  test("invalidateAll() clears every entry", () => {
    const loader = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2);
    cache.get("a", loader);
    cache.get("b", loader);

    cache.invalidateAll();

    cache.get("a", loader);
    cache.get("b", loader);

    expect(loader).toHaveBeenCalledTimes(4);
    expect(cache.size()).toBe(2);
  });

  test("invalidateMatching() removes entries matching a predicate", () => {
    cache.get("session-a/1", () => 1);
    cache.get("session-a/2", () => 2);
    cache.get("session-b/1", () => 3);

    const removed = cache.invalidateMatching((k) => String(k).startsWith("session-a/"));

    expect(removed).toBe(2);
    expect(cache.size()).toBe(1);
  });

  test("get() re-invokes the loader after the TTL elapses", () => {
    vi.useFakeTimers();
    try {
      const loader = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2);

      expect(cache.get("k", loader)).toBe(1);
      expect(cache.get("k", loader)).toBe(1);

      vi.advanceTimersByTime(1500);

      expect(cache.get("k", loader)).toBe(2);
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("get() evicts the least-recently-used entry when over maxSize", () => {
    const loaderA = vi.fn(() => 1);
    const loaderB = vi.fn(() => 2);
    const loaderC = vi.fn(() => 3);
    const loaderD = vi.fn(() => 4);

    cache.get("a", loaderA);
    cache.get("b", loaderB);
    cache.get("c", loaderC);

    cache.get("a", loaderA);

    cache.get("d", loaderD);

    const loaderBAfter = vi.fn(() => 22);
    cache.get("b", loaderBAfter);
    expect(loaderBAfter).toHaveBeenCalledTimes(1);

    expect(cache.size()).toBe(3);
  });
});
