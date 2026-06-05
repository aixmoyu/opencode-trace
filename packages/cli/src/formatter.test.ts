import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import {
  outputData,
  isConversationsMap,
  isDeltasMap,
  isConversation,
  isTimeline,
  parseCollapse,
  parseCollapseBlocks,
  writeCollapsedExport,
} from "./formatter.js";

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(writeFileSync).mockClear();
  vi.mocked(mkdirSync).mockClear();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit_${code}`);
  }) as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isConversationsMap", () => {
  it("returns true for map with provider+msgs on first value", () => {
    expect(
      isConversationsMap({ 1: { provider: "openai", msgs: [] } }),
    ).toBe(true);
  });

  it("returns false for empty map", () => {
    expect(isConversationsMap({})).toBe(false);
  });

  it("returns false when first value is missing provider", () => {
    expect(isConversationsMap({ 1: { msgs: [] } })).toBe(false);
  });

  it("returns false when first value is missing msgs", () => {
    expect(isConversationsMap({ 1: { provider: "openai" } })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isConversationsMap(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isConversationsMap(undefined)).toBe(false);
  });

  it("returns false for non-object inputs", () => {
    expect(isConversationsMap("hello")).toBe(false);
    expect(isConversationsMap(42)).toBe(false);
    expect(isConversationsMap([])).toBe(false);
  });
});

describe("isDeltasMap", () => {
  it("returns true for map with msgs but no provider on first value", () => {
    expect(isDeltasMap({ 1: { msgs: [] } })).toBe(true);
  });

  it("returns false for conversations map (has both provider and msgs)", () => {
    expect(isDeltasMap({ 1: { provider: "openai", msgs: [] } })).toBe(false);
  });

  it("returns false for empty map", () => {
    expect(isDeltasMap({})).toBe(false);
  });

  it("returns false for null", () => {
    expect(isDeltasMap(null)).toBe(false);
  });

  it("returns false for object with no msgs", () => {
    expect(isDeltasMap({ 1: { foo: "bar" } })).toBe(false);
  });
});

describe("isConversation", () => {
  it("returns true for object with provider+msgs", () => {
    expect(isConversation({ provider: "openai", msgs: [] })).toBe(true);
  });

  it("returns false when provider is missing", () => {
    expect(isConversation({ msgs: [] })).toBe(false);
  });

  it("returns false when msgs is missing", () => {
    expect(isConversation({ provider: "openai" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isConversation(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isConversation(undefined)).toBe(false);
  });

  it("returns false for non-object inputs", () => {
    expect(isConversation("string")).toBe(false);
    expect(isConversation(123)).toBe(false);
  });
});

describe("isTimeline", () => {
  it("returns true for object with sessionId+changes", () => {
    expect(isTimeline({ sessionId: "abc", changes: [] })).toBe(true);
  });

  it("returns false when sessionId is missing", () => {
    expect(isTimeline({ changes: [] })).toBe(false);
  });

  it("returns false when changes is missing", () => {
    expect(isTimeline({ sessionId: "abc" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isTimeline(null)).toBe(false);
  });

  it("returns false for non-object inputs", () => {
    expect(isTimeline("string")).toBe(false);
  });
});

describe("parseCollapse", () => {
  it("returns undefined for undefined", () => {
    expect(parseCollapse(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseCollapse("")).toBeUndefined();
  });

  it("parses single value 'sys'", () => {
    expect(parseCollapse("sys")).toEqual(["sys"]);
  });

  it("parses comma list 'sys,tool,msgs'", () => {
    expect(parseCollapse("sys,tool,msgs")).toEqual(["sys", "tool", "msgs"]);
  });

  it("trims whitespace around tokens", () => {
    expect(parseCollapse("sys , tool , msgs")).toEqual([
      "sys",
      "tool",
      "msgs",
    ]);
  });

  it("throws exit_1 for unknown value 'foo'", () => {
    expect(() => parseCollapse("foo")).toThrow("exit_1");
  });

  it("throws exit_1 when one of the comma-separated values is invalid", () => {
    expect(() => parseCollapse("sys,bogus")).toThrow("exit_1");
  });
});

describe("parseCollapseBlocks", () => {
  it("returns undefined for undefined", () => {
    expect(parseCollapseBlocks(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseCollapseBlocks("")).toBeUndefined();
  });

  it("parses a single block type", () => {
    expect(parseCollapseBlocks("text")).toEqual(["text"]);
  });

  it("parses all valid block types in one list", () => {
    expect(
      parseCollapseBlocks("text,thinking,td,tc,tr,image,other"),
    ).toEqual(["text", "thinking", "td", "tc", "tr", "image", "other"]);
  });

  it("throws exit_1 for invalid value 'foo'", () => {
    expect(() => parseCollapseBlocks("foo")).toThrow("exit_1");
  });

  it("throws exit_1 when one of the comma-separated values is invalid", () => {
    expect(() => parseCollapseBlocks("text,banana")).toThrow("exit_1");
  });
});

describe("outputData", () => {
  it("emits pretty-printed JSON when format=json + compact=false", () => {
    outputData({ a: 1 }, "json", false);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ a: 1 }, null, 2),
    );
  });

  it("emits compact JSON when format=json + compact=true", () => {
    outputData({ a: 1 }, "json", true);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ a: 1 }, null, 0),
    );
  });

  it("emits XML for a conversations map when format=xml", () => {
    const map = { 1: { provider: "openai", msgs: [] } };
    outputData(map, "xml", false);
    const out = logSpy.mock.calls[0]?.[0] as string;
    expect(out).toContain("<conversations>");
    expect(out).toContain("</conversations>");
    expect(out).toContain('reqId="1"');
  });

  it("emits XML for a deltas map when format=xml", () => {
    const map = { 1: { msgs: [] } };
    outputData(map, "xml", false);
    const out = logSpy.mock.calls[0]?.[0] as string;
    expect(out).toContain("<deltas>");
    expect(out).toContain("</deltas>");
    expect(out).toContain('reqId="1"');
  });

  it("falls back to JSON for non-map data when format=xml", () => {
    outputData({ foo: "bar" }, "xml", false);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ foo: "bar" }, null, 2),
    );
  });

  it("falls back to compact JSON for non-map data when format=xml + compact", () => {
    outputData({ foo: "bar" }, "xml", true);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ foo: "bar" }, null, 0),
    );
  });
});

describe("writeCollapsedExport", () => {
  const TMP_OUT = join(tmpdir(), "out");
  const TMP_OUT_MAIN_JSON = join(TMP_OUT, "main.json");
  const TMP_OUT_BLOCKS = join(TMP_OUT, "blocks");
  const TMP_OUT_BLOCKS_A = join(TMP_OUT, "blocks", "a.json");
  const TMP_OUT_BLOCKS_B = join(TMP_OUT, "blocks", "b.json");
  const TMP_OUT_MAIN_XML = join(TMP_OUT, "main.xml");

  it("writes only the main file when blocks Map is empty", () => {
    const result = { main: "<root/>", blocks: new Map<string, string>() };
    writeCollapsedExport(TMP_OUT, result, "json");

    expect(mkdirSync).toHaveBeenCalledTimes(1);
    expect(mkdirSync).toHaveBeenCalledWith(TMP_OUT, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith(
      TMP_OUT_MAIN_JSON,
      "<root/>",
      "utf-8",
    );
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, path: TMP_OUT, files: 1 }),
    );
  });

  it("writes main file + blocks dir + block files when blocks Map is non-empty", () => {
    const blocks = new Map<string, string>([
      ["blocks/a.json", "{\"id\":\"a\"}"],
      ["blocks/b.json", "{\"id\":\"b\"}"],
    ]);
    const result = { main: "<root/>", blocks };
    writeCollapsedExport(TMP_OUT, result, "json");

    expect(mkdirSync).toHaveBeenCalledTimes(2);
    expect(mkdirSync).toHaveBeenNthCalledWith(1, TMP_OUT, {
      recursive: true,
    });
    expect(mkdirSync).toHaveBeenNthCalledWith(2, TMP_OUT_BLOCKS, {
      recursive: true,
    });
    expect(writeFileSync).toHaveBeenCalledTimes(3);
    expect(writeFileSync).toHaveBeenCalledWith(
      TMP_OUT_MAIN_JSON,
      "<root/>",
      "utf-8",
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      TMP_OUT_BLOCKS_A,
      '{"id":"a"}',
      "utf-8",
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      TMP_OUT_BLOCKS_B,
      '{"id":"b"}',
      "utf-8",
    );
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, path: TMP_OUT, files: 3 }),
    );
  });

  it("uses xml extension for the main file when format=xml", () => {
    const result = { main: "<root/>", blocks: new Map<string, string>() };
    writeCollapsedExport(TMP_OUT, result, "xml");

    expect(writeFileSync).toHaveBeenCalledWith(
      TMP_OUT_MAIN_XML,
      "<root/>",
      "utf-8",
    );
  });
});
