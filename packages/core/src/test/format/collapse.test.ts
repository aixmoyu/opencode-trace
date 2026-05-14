import { describe, it, expect } from "vitest";
import type { CollapseOptions, CollapsedExport } from "../../format/collapse.js";
import { getBlockId, writeBlockFile, type BlockFile } from "../../format/collapse.js";
import type { Block } from "../../parse/types.js";

describe("Collapse Types", () => {
  it("should accept valid CollapseOptions", () => {
    const options: CollapseOptions = {
      collapse: ["sys", "tool"],
      collapseBlocks: ["tr", "tc"],
      format: "json"
    };
    expect(options.collapse).toEqual(["sys", "tool"]);
    expect(options.collapseBlocks).toEqual(["tr", "tc"]);
    expect(options.format).toBe("json");
  });

  it("should accept empty CollapseOptions", () => {
    const options: CollapseOptions = {};
    expect(options.collapse).toBeUndefined();
    expect(options.collapseBlocks).toBeUndefined();
    expect(options.format).toBeUndefined();
  });

  it("should produce valid CollapsedExport", () => {
    const result: CollapsedExport = {
      main: '{"test": true}',
      blocks: new Map([["blocks/test.json", '{"type": "tr"}']])
    };
    expect(result.main).toBe('{"test": true}');
    expect(result.blocks.size).toBe(1);
    expect(result.blocks.get("blocks/test.json")).toBe('{"type": "tr"}');
  });
});

describe("getBlockId", () => {
  it("should return tc.id for tc blocks", () => {
    const block: Block = { type: "tc", id: "call-abc123", name: "bash", arguments: "{}" };
    const id = getBlockId(block, 0);
    expect(id).toBe("call-abc123");
  });

  it("should return tr.toolCallId for tr blocks", () => {
    const block: Block = { type: "tr", toolCallId: "tool123", content: "result" };
    const id = getBlockId(block, 1);
    expect(id).toBe("tool123");
  });

  it("should return type-index for other blocks", () => {
    const textBlock: Block = { type: "text", text: "hello" };
    expect(getBlockId(textBlock, 2)).toBe("text-2");

    const thinkingBlock: Block = { type: "thinking", thinking: "thinking..." };
    expect(getBlockId(thinkingBlock, 3)).toBe("thinking-3");

    const tdBlock: Block = { type: "td", name: "bash", description: null, inputSchema: {} };
    expect(getBlockId(tdBlock, 4)).toBe("td-4");
  });
});

describe("writeBlockFile", () => {
  it("should generate JSON block file with correct path and content", () => {
    const block: Block = { type: "tr", toolCallId: "tool123", content: "file content" };
    const result = writeBlockFile(block, 1, "json");

    expect(result.refPath).toBe("blocks/req-1-tr-tool123.json");
    expect(result.content).toBe('{"type":"tr","toolCallId":"tool123","content":"file content"}');
  });

  it("should generate XML block file with correct format", () => {
    const block: Block = { type: "tc", id: "call-abc", name: "bash", arguments: '{"cmd":"ls"}' };
    const result = writeBlockFile(block, 2, "xml");

    expect(result.refPath).toBe("blocks/req-2-tc-call-abc.xml");
    expect(result.content).toContain('<block type="tc"');
    expect(result.content).toContain('id="call-abc"');
    expect(result.content).toContain('name="bash"');
  });

  it("should handle text block with index-based ID", () => {
    const block: Block = { type: "text", text: "Hello world" };
    const result = writeBlockFile(block, 3, "json");

    expect(result.refPath).toBe("blocks/req-3-text-0.json");
    expect(result.content).toBe('{"type":"text","text":"Hello world"}');
  });
});

import type { Entry } from "../../parse/types.js";
import { writeEntryFile, type EntryFile } from "../../format/collapse.js";

describe("writeEntryFile", () => {
  it("should generate JSON entry file for sys", () => {
    const entry: Entry = {
      id: "sys-1",
      blocks: [{ type: "text", text: "System prompt" }]
    };
    const result = writeEntryFile(entry, 1, "sys", "json");

    expect(result.refPath).toBe("blocks/req-1-sys.json");
    expect(result.content).toContain('"id":"sys-1"');
    expect(result.content).toContain('"blocks"');
  });

  it("should generate XML entry file for tool", () => {
    const entry: Entry = {
      id: "tool-1",
      blocks: [{ type: "td", name: "bash", description: "Run command", inputSchema: {} }]
    };
    const result = writeEntryFile(entry, 2, "tool", "xml");

    expect(result.refPath).toBe("blocks/req-2-tool.xml");
    expect(result.content).toContain("<entry id=\"tool-1\"");
    expect(result.content).toContain("<blocks>");
    expect(result.content).toContain("<block type=\"td\"");
  });
});

import { collapseBlocksInEntry, type CollapsedEntry, type XMLRef } from "../../format/collapse.js";

describe("collapseBlocksInEntry", () => {
  it("should collapse tr blocks in JSON format", () => {
    const entry: Entry = {
      id: "msg-1",
      role: "assistant",
      blocks: [
        { type: "text", text: "Hello" },
        { type: "tr", toolCallId: "tool123", content: "result" }
      ]
    };
    const result = collapseBlocksInEntry(entry, 1, ["tr"], "json");

    expect(result.entry).toEqual({
      id: "msg-1",
      role: "assistant",
      blocks: [
        { type: "text", text: "Hello" },
        { "$ref": "blocks/req-1-tr-tool123.json" }
      ]
    });
    expect(result.blockFiles.size).toBe(1);
    expect(result.blockFiles.get("blocks/req-1-tr-tool123.json")).toContain('"type":"tr"');
  });

  it("should collapse multiple block types", () => {
    const entry: Entry = {
      id: "msg-2",
      blocks: [
        { type: "text", text: "Q1" },
        { type: "thinking", thinking: "think..." },
        { type: "tc", id: "call-1", name: "bash", arguments: "{}" },
        { type: "text", text: "Q2" }
      ]
    };
    const result = collapseBlocksInEntry(entry, 2, ["thinking", "tc"], "json");

    expect(result.entry.blocks).toEqual([
      { type: "text", text: "Q1" },
      { "$ref": "blocks/req-2-thinking-0.json" },
      { "$ref": "blocks/req-2-tc-call-1.json" },
      { type: "text", text: "Q2" }
    ]);
    expect(result.blockFiles.size).toBe(2);
  });

  it("should collapse blocks in XML format", () => {
    const entry: Entry = {
      id: "msg-3",
      blocks: [
        { type: "text", text: "Start" },
        { type: "tr", toolCallId: "tool999", content: "data" }
      ]
    };
    const result = collapseBlocksInEntry(entry, 3, ["tr"], "xml");

    expect(result.entry).toEqual({
      id: "msg-3",
      blocks: [
        { type: "text", text: "Start" },
        { type: "tr", toolCallId: "tool999", content: "data" }
      ]
    });
    expect(result.xmlRefs).toEqual([
      { blockIndex: 1, refPath: "blocks/req-3-tr-tool999.xml" }
    ]);
  });

  it("should return unchanged entry if no blocks to collapse", () => {
    const entry: Entry = {
      id: "msg-4",
      blocks: [{ type: "text", text: "Only text" }]
    };
    const result = collapseBlocksInEntry(entry, 4, ["tr"], "json");

    expect(result.entry).toEqual(entry);
    expect(result.blockFiles.size).toBe(0);
  });
});

import type { Conversation } from "../../parse/types.js";
import { collapseConversation, type CollapsedConversation } from "../../format/collapse.js";

describe("collapseConversation", () => {
  it("should collapse sys and tool in JSON format", () => {
    const conv: Conversation = {
      provider: "anthropic",
      model: "claude-3",
      sys: { id: "sys-1", blocks: [{ type: "text", text: "System" }] },
      tool: { id: "tool-1", blocks: [{ type: "td", name: "bash", description: null, inputSchema: {} }] },
      msgs: [{ id: "msg-1", role: "user", blocks: [{ type: "text", text: "Hello" }] }],
      stream: true,
      usage: null
    };
    const result = collapseConversation(conv, 1, { collapse: ["sys", "tool"], format: "json" });

    expect(result.conversation.sys).toEqual({ "$ref": "blocks/req-1-sys.json" });
    expect(result.conversation.tool).toEqual({ "$ref": "blocks/req-1-tool.json" });
    expect(result.files.size).toBe(2);
  });

  it("should collapse msgs blocks when collapseBlocks is set", () => {
    const conv: Conversation = {
      provider: "anthropic",
      model: null,
      msgs: [
        { id: "msg-1", role: "assistant", blocks: [
          { type: "text", text: "Hi" },
          { type: "tr", toolCallId: "t1", content: "result" }
        ]}
      ],
      stream: false,
      usage: { inputMissTokens: 10, inputHitTokens: 0, outputTokens: 20 }
    };
    const result = collapseConversation(conv, 2, { collapseBlocks: ["tr"], format: "json" });

    expect(result.conversation.msgs[0].blocks[1]).toEqual({ "$ref": "blocks/req-2-tr-t1.json" });
    expect(result.files.size).toBe(1);
  });

  it("should collapse both top-level and blocks", () => {
    const conv: Conversation = {
      provider: "openai",
      model: null,
      sys: { id: "sys-2", blocks: [{ type: "text", text: "System" }] },
      msgs: [{ id: "msg-1", blocks: [
        { type: "tc", id: "c1", name: "bash", arguments: "{}" },
        { type: "text", text: "Text" }
      ]}],
      stream: true,
      usage: null
    };
    const result = collapseConversation(conv, 3, {
      collapse: ["sys"],
      collapseBlocks: ["tc"],
      format: "json"
    });

    expect(result.conversation.sys).toEqual({ "$ref": "blocks/req-3-sys.json" });
    expect(result.conversation.msgs[0].blocks[0]).toEqual({ "$ref": "blocks/req-3-tc-c1.json" });
    expect(result.files.size).toBe(2);
  });

  it("should return unchanged conversation if no collapse options", () => {
    const conv: Conversation = {
      provider: "anthropic",
      model: null,
      msgs: [{ id: "msg-1", blocks: [{ type: "text", text: "Test" }] }],
      stream: true,
      usage: null
    };
    const result = collapseConversation(conv, 4, {});

    expect(result.conversation).toEqual(conv);
    expect(result.files.size).toBe(0);
  });
});

import type { Delta, EntryDelta } from "../../query/types.js";
import { collapseDelta, collapseDeltas, type CollapsedDelta } from "../../format/collapse.js";

describe("collapseDelta", () => {
  it("should collapse sys EntryDelta", () => {
    const delta: Delta = {
      sys: { id: "sys-1", added: [{ type: "text", text: "New sys" }] },
      msgs: []
    };
    const result = collapseDelta(delta, 1, { collapse: ["sys"], format: "json" });

    expect(result.delta.sys).toEqual({ "$ref": "blocks/req-1-sys.json" });
    expect(result.files.size).toBe(1);
  });

  it("should collapse blocks in EntryDelta added/removed", () => {
    const delta: Delta = {
      msgs: [
        { id: "msg-1", added: [
          { type: "text", text: "Added text" },
          { type: "tc", id: "c1", name: "bash", arguments: "{}" }
        ]}
      ]
    };
    const result = collapseDelta(delta, 2, { collapseBlocks: ["tc"], format: "json" });

    expect(result.delta.msgs[0].added).toEqual([
      { type: "text", text: "Added text" },
      { "$ref": "blocks/req-2-tc-c1.json" }
    ]);
    expect(result.files.size).toBe(1);
  });

  it("should collapse tool EntryDelta", () => {
    const delta: Delta = {
      tool: { id: "tool-1", removed: [{ type: "td", name: "bash", description: null, inputSchema: {} }] },
      msgs: []
    };
    const result = collapseDelta(delta, 3, { collapse: ["tool"], format: "json" });

    expect(result.delta.tool).toEqual({ "$ref": "blocks/req-3-tool.json" });
    expect(result.files.size).toBe(1);
  });
});

describe("collapseDeltas", () => {
  it("should handle multiple deltas with different requestIds", () => {
    const deltas: Record<number, Delta> = {
      1: { sys: { id: "s1", added: [{ type: "text", text: "Sys1" }] }, msgs: [] },
      2: { tool: { id: "t1", removed: [{ type: "td", name: "bash", description: null, inputSchema: {} }] }, msgs: [] }
    };
    const result = collapseDeltas(deltas, { collapse: ["sys", "tool"], format: "json" });

    expect(result.main).toContain('"1"');
    expect(result.main).toContain('"2"');
    expect(result.blocks.size).toBe(2);
  });

  it("should produce valid JSON main file", () => {
    const deltas: Record<number, Delta> = {
      1: { msgs: [{ id: "m1", added: [{ type: "text", text: "Test" }] }] }
    };
    const result = collapseDeltas(deltas, { format: "json" });

    const parsed = JSON.parse(result.main);
    expect(parsed).toHaveProperty("1");
    expect(parsed[1].msgs[0].id).toBe("m1");
  });
});

import { collapseConversations } from "../../format/collapse.js";

describe("collapseConversations", () => {
  it("should handle multiple requests with different requestIds", () => {
    const conversations: Record<number, Conversation> = {
      1: {
        provider: "anthropic",
        model: null,
        sys: { id: "sys-1", blocks: [{ type: "text", text: "Sys1" }] },
        msgs: [{ id: "msg-1", blocks: [{ type: "tr", toolCallId: "t1", content: "r1" }] }],
        stream: true,
        usage: null
      },
      2: {
        provider: "openai",
        model: null,
        sys: { id: "sys-2", blocks: [{ type: "text", text: "Sys2" }] },
        msgs: [{ id: "msg-2", blocks: [{ type: "tr", toolCallId: "t2", content: "r2" }] }],
        stream: false,
        usage: null
      }
    };
    const result = collapseConversations(conversations, {
      collapse: ["sys"],
      collapseBlocks: ["tr"],
      format: "json"
    });

    expect(result.main).toContain('"1"');
    expect(result.main).toContain('"2"');
    expect(result.main).toContain('"$ref": "blocks/req-1-sys.json"');
    expect(result.main).toContain('"$ref": "blocks/req-2-sys.json"');
    expect(result.blocks.size).toBe(4); // 2 sys + 2 tr
  });

  it("should produce valid JSON main file structure", () => {
    const conversations: Record<number, Conversation> = {
      1: {
        provider: "anthropic",
        model: null,
        msgs: [{ id: "msg-1", role: "user", blocks: [{ type: "text", text: "Hi" }] }],
        stream: true,
        usage: { inputMissTokens: 10, inputHitTokens: 0, outputTokens: 5 }
      }
    };
    const result = collapseConversations(conversations, { format: "json" });

    const parsed = JSON.parse(result.main);
    expect(parsed).toHaveProperty("1");
    expect(parsed[1].provider).toBe("anthropic");
    expect(parsed[1].msgs[0].blocks[0].type).toBe("text");
  });

  it("should produce empty blocks map when no collapse", () => {
    const conversations: Record<number, Conversation> = {
      1: {
        provider: "anthropic",
        model: null,
        msgs: [{ id: "m1", blocks: [{ type: "text", text: "Test" }] }],
        stream: true,
        usage: null
      }
    };
    const result = collapseConversations(conversations, {});
    expect(result.blocks.size).toBe(0);
  });
});