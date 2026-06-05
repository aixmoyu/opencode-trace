import { describe, it, expect } from "vitest";
import {
  conversationToXML,
  timelineToXML,
  blockToXML,
  entryDeltaToXML,
  conversationsMapToXML,
  deltasMapToXML,
  escapeXML,
} from "../../format/xml.js";
import type { Conversation, Block } from "../../parse/types.js";
import type {
  SessionTimeline,
  RequestChange,
  Delta,
  EntryDelta,
} from "../../query/types.js";

describe("XML Format", () => {
  describe("conversationToXML", () => {
    it("should convert simple conversation to XML", () => {
      const conv: Conversation = {
        provider: "anthropic",
        model: "claude-3",
        msgs: [
          {
            id: "msg-1",
            role: "user",
            blocks: [{ type: "text", text: "Hello" }],
          },
        ],
        stream: true,
        usage: {
          inputMissTokens: 10,
          inputHitTokens: 0,
          outputTokens: 20,
        },
      };

      const xml = conversationToXML(conv);
      expect(xml).toContain("<conversation>");
      expect(xml).toContain("<provider>anthropic</provider>");
      expect(xml).toContain("<model>claude-3</model>");
      expect(xml).toContain("<msgs>");
      expect(xml).toContain('<entry id="msg-1" role="user"');
      expect(xml).toContain('<block type="text">Hello</block>');
      expect(xml).toContain("</conversation>");
    });

    it("should handle sys and tool entries", () => {
      const conv: Conversation = {
        provider: "anthropic",
        model: "claude-3",
        sys: {
          id: "sys-1",
          blocks: [{ type: "text", text: "System prompt" }],
        },
        tool: {
          id: "tool-1",
          blocks: [
            {
              type: "td",
              name: "bash",
              description: "Run bash command",
              inputSchema: { type: "object" },
            },
          ],
        },
        msgs: [],
        stream: true,
        usage: null,
      };

      const xml = conversationToXML(conv);
      expect(xml).toContain("<sys>");
      expect(xml).toContain('<block type="text">System prompt</block>');
      expect(xml).toContain("<tool>");
      expect(xml).toContain('<block type="td" name="bash"');
    });
  });

  describe("timelineToXML", () => {
    it("should convert timeline to XML", () => {
      const timeline: SessionTimeline = {
        sessionId: "session-123",
        totalRequests: 2,
        changes: [
          {
            requestId: 2,
            delta: {
              msgs: [
                {
                  id: "msg-2",
                  added: [{ type: "text", text: "New message" }],
                },
              ],
            },
            interRequestDuration: 1000,
            isUserCall: true,
          },
        ],
      };

      const xml = timelineToXML(timeline);
      expect(xml).toContain("<timeline>");
      expect(xml).toContain("<sessionId>session-123</sessionId>");
      expect(xml).toContain("<totalRequests>2</totalRequests>");
      expect(xml).toContain("<changes>");
      expect(xml).toContain('<change requestId="2"');
      expect(xml).toContain('<block type="text">New message</block>');
      expect(xml).toContain("</timeline>");
    });

    it("should handle sys and tool deltas", () => {
      const timeline: SessionTimeline = {
        sessionId: "session-456",
        totalRequests: 1,
        changes: [
          {
            requestId: 1,
            delta: {
              sys: {
                id: "sys-1",
                added: [{ type: "text", text: "System added" }],
              },
              tool: {
                id: "tool-1",
                removed: [
                  {
                    type: "td",
                    name: "bash",
                    description: null,
                    inputSchema: {},
                  },
                ],
              },
              msgs: [],
            },
            interRequestDuration: null,
            isUserCall: false,
          },
        ],
      };

      const xml = timelineToXML(timeline);
      expect(xml).toContain("<sys>");
      expect(xml).toContain("<added>");
      expect(xml).toContain("System added");
      expect(xml).toContain("<tool>");
      expect(xml).toContain("<removed>");
    });
  });

  describe("blockToXML", () => {
    it("should convert text block to XML", () => {
      const block: Block = { type: "text", text: "Hello world" };
      const xml = blockToXML(block, "  ");
      expect(xml).toBe('  <block type="text">Hello world</block>');
    });

    it("should convert thinking block to XML", () => {
      const block: Block = {
        type: "thinking",
        thinking: "Let me reason about this",
      };
      const xml = blockToXML(block, "");
      expect(xml).toBe(
        '<block type="thinking">Let me reason about this</block>',
      );
    });

    it("should escape XML in thinking block content", () => {
      const block: Block = {
        type: "thinking",
        thinking: "A < B & C > D",
      };
      const xml = blockToXML(block, "");
      expect(xml).toBe(
        '<block type="thinking">A &lt; B &amp; C &gt; D</block>',
      );
    });

    it("should convert image block to XML with JSON.stringify source", () => {
      const block: Block = {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc123" },
      };
      const xml = blockToXML(block, "  ");
      expect(xml).toBe(
        '  <block type="image">{"type":"base64","media_type":"image/png","data":"abc123"}</block>',
      );
    });

    it("should convert other block to XML with JSON.stringify raw", () => {
      const block: Block = {
        type: "other",
        raw: { custom: "data", nested: { key: 42 } },
      };
      const xml = blockToXML(block, "");
      expect(xml).toBe(
        '<block type="other">{"custom":"data","nested":{"key":42}}</block>',
      );
    });

    it("should convert unknown block type to default XML", () => {
      const block = { type: "custom_unknown" } as any as Block;
      const xml = blockToXML(block, "  ");
      expect(xml).toBe('  <block type="unknown"/>');
    });

    it("should convert tc (tool_call) block to XML", () => {
      const block: Block = {
        type: "tc",
        id: "call-1",
        name: "bash",
        arguments: '{"command":"ls"}',
      };
      const xml = blockToXML(block, "");
      expect(xml).toBe(
        '<block type="tc" id="call-1" name="bash">{&quot;command&quot;:&quot;ls&quot;}</block>',
      );
    });

    it("should convert tr (tool_result) block to XML", () => {
      const block: Block = {
        type: "tr",
        toolCallId: "call-1",
        content: "output result",
      };
      const xml = blockToXML(block, "  ");
      expect(xml).toBe(
        '  <block type="tr" toolCallId="call-1">output result</block>',
      );
    });

    it("should escape special chars in tr toolCallId", () => {
      const block: Block = {
        type: "tr",
        toolCallId: "call<1>&2",
        content: "ok",
      };
      const xml = blockToXML(block, "");
      expect(xml).toBe(
        '<block type="tr" toolCallId="call&lt;1&gt;&amp;2">ok</block>',
      );
    });
  });

  describe("entryDeltaToXML", () => {
    it("should convert entry delta with added blocks", () => {
      const delta: EntryDelta = {
        id: "msg-1",
        added: [{ type: "text", text: "Hello" }],
      };
      const xml = entryDeltaToXML(delta, "  ");
      expect(xml).toContain('<entryDelta id="msg-1">');
      expect(xml).toContain("<added>");
      expect(xml).toContain('<block type="text">Hello</block>');
      expect(xml).toContain("</added>");
      expect(xml).toContain("</entryDelta>");
    });

    it("should convert entry delta with removed blocks", () => {
      const delta: EntryDelta = {
        id: "msg-2",
        removed: [
          { type: "td", name: "bash", description: null, inputSchema: {} },
        ],
      };
      const xml = entryDeltaToXML(delta, "");
      expect(xml).toContain('<entryDelta id="msg-2">');
      expect(xml).toContain("<removed>");
      expect(xml).toContain('<block type="td" name="bash"');
      expect(xml).toContain("</removed>");
      expect(xml).not.toContain("<added>");
    });

    it("should convert entry delta with both added and removed blocks", () => {
      const delta: EntryDelta = {
        id: "msg-3",
        added: [{ type: "text", text: "New text" }],
        removed: [{ type: "text", text: "Old text" }],
      };
      const xml = entryDeltaToXML(delta, "  ");
      expect(xml).toContain("<added>");
      expect(xml).toContain('<block type="text">New text</block>');
      expect(xml).toContain("<removed>");
      expect(xml).toContain('<block type="text">Old text</block>');
    });

    it("should handle entry delta with no added or removed blocks", () => {
      const delta: EntryDelta = { id: "msg-4" };
      const xml = entryDeltaToXML(delta, "");
      expect(xml).toBe('<entryDelta id="msg-4">\n</entryDelta>');
    });
  });

  describe("conversationsMapToXML", () => {
    it("should convert map of conversations to XML", () => {
      const map: Record<number, Conversation> = {
        1: {
          provider: "anthropic",
          model: "claude-3",
          msgs: [
            {
              id: "msg-1",
              role: "user",
              blocks: [{ type: "text", text: "Hi" }],
            },
          ],
          stream: true,
          usage: null,
        },
        2: {
          provider: "openai",
          model: "gpt-4",
          msgs: [],
          stream: false,
          usage: null,
        },
      };

      const xml = conversationsMapToXML(map);
      expect(xml).toContain("<conversations>");
      expect(xml).toContain("</conversations>");
      expect(xml).toContain('<conversation reqId="1">');
      expect(xml).toContain('<conversation reqId="2">');
      expect(xml).toContain("<provider>anthropic</provider>");
      expect(xml).toContain("<provider>openai</provider>");
    });
  });

  describe("deltasMapToXML", () => {
    it("should convert map of deltas to XML", () => {
      const map: Record<number, Delta> = {
        1: {
          msgs: [
            {
              id: "msg-1",
              added: [{ type: "text", text: "Hello" }],
            },
          ],
        },
        2: {
          sys: {
            id: "sys-1",
            added: [{ type: "text", text: "System" }],
          },
          msgs: [],
        },
      };

      const xml = deltasMapToXML(map);
      expect(xml).toContain("<deltas>");
      expect(xml).toContain("</deltas>");
      expect(xml).toContain('<delta reqId="1">');
      expect(xml).toContain('<delta reqId="2">');
      expect(xml).toContain('<block type="text">Hello</block>');
      expect(xml).toContain("<sys>");
      expect(xml).toContain('<block type="text">System</block>');
    });
  });

  describe("escapeXML", () => {
    it("should escape ampersand", () => {
      expect(escapeXML("a & b")).toBe("a &amp; b");
    });

    it("should escape less than", () => {
      expect(escapeXML("a < b")).toBe("a &lt; b");
    });

    it("should escape greater than", () => {
      expect(escapeXML("a > b")).toBe("a &gt; b");
    });

    it("should escape double quotes", () => {
      expect(escapeXML('say "hi"')).toBe("say &quot;hi&quot;");
    });

    it("should escape single quotes", () => {
      expect(escapeXML("it's")).toBe("it&apos;s");
    });

    it("should escape all special chars together", () => {
      expect(escapeXML('<tag attr="val">&\'</tag>')).toBe(
        "&lt;tag attr=&quot;val&quot;&gt;&amp;&apos;&lt;/tag&gt;",
      );
    });

    it("should return unchanged string with no special chars", () => {
      expect(escapeXML("hello world")).toBe("hello world");
    });
  });
});
