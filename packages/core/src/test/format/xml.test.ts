import { describe, it, expect } from "vitest";
import { conversationToXML, timelineToXML } from "../../format/xml.js";
import type { Conversation, Entry } from "../../parse/types.js";
import type { SessionTimeline, RequestChange, Delta } from "../../query/types.js";

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
      expect(xml).toContain("<entry id=\"msg-1\" role=\"user\"");
      expect(xml).toContain("<block type=\"text\">Hello</block>");
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
      expect(xml).toContain("<block type=\"text\">System prompt</block>");
      expect(xml).toContain("<tool>");
      expect(xml).toContain("<block type=\"td\" name=\"bash\"");
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
      expect(xml).toContain("<change requestId=\"2\"");
      expect(xml).toContain("<block type=\"text\">New message</block>");
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
                removed: [{ type: "td", name: "bash", description: null, inputSchema: {} }],
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
});