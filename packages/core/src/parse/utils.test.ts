import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateId,
  generateStableId,
  createSysEntry,
  createToolEntry,
  createMsgEntry,
  createTextBlock,
  createThinkingBlock,
  createToolDefinitionBlock,
  createToolCallBlock,
  createToolResultBlock,
  createImageBlock,
  createOtherBlock,
} from "./utils.js";
import type { Block } from "./types.js";

describe("generateId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a non-empty string", () => {
    expect(generateId().length).toBeGreaterThan(0);
  });

  it("returns a base36 string", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-z]+$/);
  });

  it("is deterministic when Math.random is mocked", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(generateId()).toBe(generateId());
  });

  it("returns different ids for different Math.random values", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0.1);
    const a = generateId();
    vi.spyOn(Math, "random").mockReturnValueOnce(0.9);
    const b = generateId();
    expect(a).not.toBe(b);
  });

  it("returns at most 9 characters", () => {
    const id = generateId();
    expect(id.length).toBeLessThanOrEqual(9);
  });
});

describe("generateStableId", () => {
  it("returns same id for same role + same blocks", () => {
    const blocks: Block[] = [createTextBlock("hi")];
    expect(generateStableId("user", blocks)).toBe(
      generateStableId("user", blocks),
    );
  });

  it("returns different ids for different roles (same blocks)", () => {
    const blocks: Block[] = [createTextBlock("hi")];
    expect(generateStableId("user", blocks)).not.toBe(
      generateStableId("assistant", blocks),
    );
  });

  it("returns different ids for different content (same role)", () => {
    const a: Block[] = [createTextBlock("hi")];
    const b: Block[] = [createTextBlock("bye")];
    expect(generateStableId("user", a)).not.toBe(generateStableId("user", b));
  });

  it("uses text block content in hash", () => {
    const a = generateStableId("user", [createTextBlock("alpha")]);
    const b = generateStableId("user", [createTextBlock("beta")]);
    expect(a).not.toBe(b);
  });

  it("uses thinking block content in hash", () => {
    const a = generateStableId("user", [createThinkingBlock("think A")]);
    const b = generateStableId("user", [createThinkingBlock("think B")]);
    expect(a).not.toBe(b);
  });

  it("uses tool call id in hash", () => {
    const a = generateStableId("assistant", [
      createToolCallBlock("call_1", "f", "{}"),
    ]);
    const b = generateStableId("assistant", [
      createToolCallBlock("call_2", "f", "{}"),
    ]);
    expect(a).not.toBe(b);
  });

  it("uses tool call name in hash", () => {
    const a = generateStableId("assistant", [
      createToolCallBlock("call_1", "f1", "{}"),
    ]);
    const b = generateStableId("assistant", [
      createToolCallBlock("call_1", "f2", "{}"),
    ]);
    expect(a).not.toBe(b);
  });

  it("uses tool result toolCallId in hash", () => {
    const a = generateStableId("tool", [
      createToolResultBlock("call_1", "ok"),
    ]);
    const b = generateStableId("tool", [
      createToolResultBlock("call_2", "ok"),
    ]);
    expect(a).not.toBe(b);
  });

  it("groups image blocks by type in hash (source ignored)", () => {
    const a = generateStableId("user", [createImageBlock("src-a")]);
    const b = generateStableId("user", [createImageBlock("src-b")]);
    expect(a).toBe(b);
  });

  it("groups other block types by type in hash (raw ignored)", () => {
    const a = generateStableId("user", [createOtherBlock({ x: 1 })]);
    const b = generateStableId("user", [createOtherBlock({ y: 2 })]);
    expect(a).toBe(b);
  });

  it("produces different ids for text vs thinking blocks with same string", () => {
    const a = generateStableId("user", [createTextBlock("x")]);
    const b = generateStableId("user", [createThinkingBlock("x")]);
    expect(a).not.toBe(b);
  });

  it("truncates long text in hash to 100 chars", () => {
    const long1 = "x".repeat(150);
    const long2 = "y".repeat(150);
    const a = generateStableId("user", [createTextBlock(long1)]);
    const b = generateStableId("user", [createTextBlock(long2)]);
    expect(a).not.toBe(b);

    const same1 = "x".repeat(100);
    const same2 = "x".repeat(100);
    const c = generateStableId("user", [createTextBlock(same1)]);
    const d = generateStableId("user", [createTextBlock(same2)]);
    expect(c).toBe(d);
  });

  it("hashes a long text the same as its 100-char prefix", () => {
    const truncated = "a".repeat(100);
    const long = "a".repeat(200);
    expect(generateStableId("user", [createTextBlock(truncated)])).toBe(
      generateStableId("user", [createTextBlock(long)]),
    );
  });
});

describe("createSysEntry", () => {
  it("returns entry with id 'sys' and given blocks", () => {
    const blocks = [createTextBlock("sys content")];
    expect(createSysEntry(blocks)).toEqual({ id: "sys", blocks });
  });

  it("preserves empty blocks array", () => {
    expect(createSysEntry([])).toEqual({ id: "sys", blocks: [] });
  });
});

describe("createToolEntry", () => {
  it("returns entry with id 'tool' and given blocks", () => {
    const blocks = [createToolDefinitionBlock("f", "d", null)];
    expect(createToolEntry(blocks)).toEqual({ id: "tool", blocks });
  });
});

describe("createMsgEntry", () => {
  it("returns entry with role, blocks, and a stable id", () => {
    const blocks: Block[] = [createTextBlock("hello")];
    const entry = createMsgEntry("user", blocks);
    expect(entry.role).toBe("user");
    expect(entry.blocks).toBe(blocks);
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
  });

  it("uses generateStableId for the id", () => {
    const blocks: Block[] = [createTextBlock("hi")];
    const entry = createMsgEntry("user", blocks);
    expect(entry.id).toBe(generateStableId("user", blocks));
  });

  it("preserves the role parameter exactly", () => {
    expect(createMsgEntry("user", []).role).toBe("user");
    expect(createMsgEntry("assistant", []).role).toBe("assistant");
    expect(createMsgEntry("tool", []).role).toBe("tool");
  });
});

describe("createTextBlock", () => {
  it("returns text block with given text", () => {
    expect(createTextBlock("hello")).toEqual({ type: "text", text: "hello" });
  });

  it("preserves empty string", () => {
    expect(createTextBlock("")).toEqual({ type: "text", text: "" });
  });
});

describe("createThinkingBlock", () => {
  it("returns thinking block with given thinking", () => {
    expect(createThinkingBlock("pondering")).toEqual({
      type: "thinking",
      thinking: "pondering",
    });
  });
});

describe("createToolDefinitionBlock", () => {
  it("returns td block with name, description, inputSchema", () => {
    const schema = { type: "object" };
    expect(createToolDefinitionBlock("f", "d", schema)).toEqual({
      type: "td",
      name: "f",
      description: "d",
      inputSchema: schema,
    });
  });

  it("accepts null description and null inputSchema", () => {
    expect(createToolDefinitionBlock("f", null, null)).toEqual({
      type: "td",
      name: "f",
      description: null,
      inputSchema: null,
    });
  });

  it("preserves object inputSchema verbatim", () => {
    const schema = { type: "object", properties: { x: { type: "number" } } };
    expect(createToolDefinitionBlock("f", null, schema).inputSchema).toBe(
      schema,
    );
  });
});

describe("createToolCallBlock", () => {
  it("returns tc block with id, name, arguments", () => {
    expect(createToolCallBlock("c1", "f", '{"a":1}')).toEqual({
      type: "tc",
      id: "c1",
      name: "f",
      arguments: '{"a":1}',
    });
  });

  it("preserves empty strings", () => {
    expect(createToolCallBlock("", "", "")).toEqual({
      type: "tc",
      id: "",
      name: "",
      arguments: "",
    });
  });
});

describe("createToolResultBlock", () => {
  it("returns tr block with toolCallId and content", () => {
    expect(createToolResultBlock("c1", "result")).toEqual({
      type: "tr",
      toolCallId: "c1",
      content: "result",
    });
  });
});

describe("createImageBlock", () => {
  it("returns image block with given string source", () => {
    expect(createImageBlock("https://example.com/cat.jpg")).toEqual({
      type: "image",
      source: "https://example.com/cat.jpg",
    });
  });

  it("preserves object source verbatim", () => {
    const src = { url: "x", detail: "high" };
    expect(createImageBlock(src)).toEqual({ type: "image", source: src });
  });

  it("preserves null source", () => {
    expect(createImageBlock(null)).toEqual({ type: "image", source: null });
  });
});

describe("createOtherBlock", () => {
  it("returns other block with given raw", () => {
    const raw = { type: "weird", data: 1 };
    expect(createOtherBlock(raw)).toEqual({ type: "other", raw });
  });

  it("preserves primitive raw", () => {
    expect(createOtherBlock("string")).toEqual({
      type: "other",
      raw: "string",
    });
    expect(createOtherBlock(42)).toEqual({ type: "other", raw: 42 });
  });
});
