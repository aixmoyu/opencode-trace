import { describe, it, expect, vi, afterEach } from "vitest";
import {
  esc,
  formatTime,
  relativeTime,
  formatNumber,
  formatLatency,
  formatDuration,
  getProjectName,
  truncate,
} from "./format";

describe("format utils", () => {
  describe("esc()", () => {
    it("escapes HTML special characters", () => {
      expect(esc('<a href="x">&')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
    });

    it("returns empty string for null or undefined", () => {
      expect(esc(null)).toBe("");
      expect(esc(undefined)).toBe("");
    });

    it("coerces non-string values to string before escaping", () => {
      expect(esc(42)).toBe("42");
      expect(esc(true)).toBe("true");
    });
  });

  describe("formatTime()", () => {
    it("returns '?' for null/undefined/empty input", () => {
      expect(formatTime(null)).toBe("?");
      expect(formatTime(undefined)).toBe("?");
      expect(formatTime("")).toBe("?");
    });

    it("returns locale string for a valid ISO timestamp", () => {
      const iso = "2024-01-01T00:00:00.000Z";
      const out = formatTime(iso);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toBe("?");
    });

    it("does not throw for unparseable timestamps", () => {
      // jsdom returns "Invalid Date" without throwing, so we only assert that
      // the function does not throw and returns a string. The original input
      // is returned in environments that throw on Date construction.
      let out: string;
      expect(() => {
        out = formatTime("not-a-date");
      }).not.toThrow();
      expect(typeof out!).toBe("string");
      expect(out!.length).toBeGreaterThan(0);
    });
  });

  describe("relativeTime()", () => {
    it("returns empty string for null/undefined/empty", () => {
      expect(relativeTime(null)).toBe("");
      expect(relativeTime(undefined)).toBe("");
      expect(relativeTime("")).toBe("");
    });

    it("returns 'just now' for under a minute", () => {
      const now = new Date().toISOString();
      expect(relativeTime(now)).toBe("just now");
    });

    it("returns minutes ago for under an hour", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(relativeTime(fiveMinAgo)).toBe("5m ago");
    });

    it("returns hours ago for under a day", () => {
      const twoHrsAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
      expect(relativeTime(twoHrsAgo)).toBe("2h ago");
    });

    it("returns days ago for over a day", () => {
      const threeDaysAgo = new Date(
        Date.now() - 3 * 86_400_000,
      ).toISOString();
      expect(relativeTime(threeDaysAgo)).toBe("3d ago");
    });
  });

  describe("formatNumber()", () => {
    it("returns '0' for null or undefined", () => {
      expect(formatNumber(null)).toBe("0");
      expect(formatNumber(undefined)).toBe("0");
    });

    it("inserts thousands separators", () => {
      expect(formatNumber(0)).toBe("0");
      expect(formatNumber(1234)).toBe("1,234");
      expect(formatNumber(1_000_000)).toBe("1,000,000");
      expect(formatNumber(123_456_789)).toBe("123,456,789");
    });
  });

  describe("formatLatency()", () => {
    it("returns '-' for null or undefined", () => {
      expect(formatLatency(null)).toBe("-");
      expect(formatLatency(undefined)).toBe("-");
    });

    it("appends 'ms' and uses formatted number", () => {
      expect(formatLatency(12.345)).toBe("12.35ms");
      expect(formatLatency(1234)).toBe("1,234ms");
      expect(formatLatency(0)).toBe("0ms");
    });
  });

  describe("formatDuration()", () => {
    it("formats sub-second durations in ms", () => {
      expect(formatDuration(0)).toBe("0ms");
      expect(formatDuration(500)).toBe("500ms");
      expect(formatDuration(999)).toBe("999ms");
    });

    it("formats seconds-level durations with one decimal", () => {
      expect(formatDuration(1000)).toBe("1.0s");
      expect(formatDuration(12_345)).toBe("12.3s");
    });

    it("formats minute-level durations as Xm Ys", () => {
      expect(formatDuration(60_000)).toBe("1m 0s");
      expect(formatDuration(125_000)).toBe("2m 5s");
    });

    it("formats hour-level durations as Xh Ym", () => {
      expect(formatDuration(3_600_000)).toBe("1h 0m");
      expect(formatDuration(3_725_000)).toBe("1h 2m");
    });
  });

  describe("getProjectName()", () => {
    it("returns 'Unknown' for null/undefined/empty", () => {
      expect(getProjectName(null)).toBe("Unknown");
      expect(getProjectName(undefined)).toBe("Unknown");
      expect(getProjectName("")).toBe("Unknown");
    });

    it("returns the last path segment", () => {
      expect(getProjectName("/Users/me/projects/my-app")).toBe("my-app");
      expect(getProjectName("just-a-name")).toBe("just-a-name");
    });

    it("falls back to the full path when split yields empty", () => {
      // Trailing slash produces an empty last segment — falls back to original
      expect(getProjectName("/foo/bar/")).toBe("/foo/bar/");
    });
  });

  describe("truncate()", () => {
    it("returns empty string for null/undefined/empty", () => {
      expect(truncate(null, 10)).toBe("");
      expect(truncate(undefined, 10)).toBe("");
    });

    it("does not modify strings within the limit", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    it("truncates with ellipsis when over the limit", () => {
      expect(truncate("hello world", 5)).toBe("hello...");
    });

    it("truncates exactly at the limit", () => {
      expect(truncate("abcdef", 3)).toBe("abc...");
    });
  });
});
