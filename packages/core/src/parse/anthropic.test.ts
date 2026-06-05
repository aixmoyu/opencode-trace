import { describe, it, expect } from "vitest";
import { anthropicParser } from "./anthropic.js";

describe("anthropicParser", () => {
  describe("match", () => {
    it.each([
      ["https://api.anthropic.com/v1/messages"],
      ["https://api.anthropic.com/v1/messages?beta=true"],
      ["https://api.anthropic.com/v1/messages?foo=bar&baz=qux"],
      ["https://example.com/proxy/v1/messages"],
      ["POST /v1/messages"],
      // Substring match is permissive: anything containing "/v1/messages" matches.
      ["https://api.anthropic.com/v1/messagesbeta"],
    ])("returns true for %s", (url) => {
      expect(anthropicParser.match(url, {})).toBe(true);
    });

    it.each([
      ["https://api.openai.com/v1/chat/completions"],
      ["https://api.openai.com/v1/completions"],
      ["https://api.openai.com/v1/responses"],
      [""],
      ["/v1/completions"],
      ["/chat/completions"],
    ])("returns false for %s", (url) => {
      expect(anthropicParser.match(url, {})).toBe(false);
    });
  });

  describe("parseRequest", () => {
    it("returns empty conversation for non-record body", () => {
      const result = anthropicParser.parseRequest(null);
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBeNull();
      expect(result.msgs!).toEqual([]);
      expect(result.usage).toBeNull();
      expect(result.stream).toBe(false);
      expect(result.sys).toBeUndefined();
      expect(result.tool).toBeUndefined();
    });

    it("returns empty conversation for array body", () => {
      const result = anthropicParser.parseRequest([1, 2, 3] as unknown);
      expect(result.msgs!).toEqual([]);
    });

    it("parses minimal request with single user message", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-3-5-sonnet-20241022");
      expect(result.stream).toBe(false);
      expect(result.usage).toBeNull();
      expect(result.sys).toBeUndefined();
      expect(result.tool).toBeUndefined();
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0]?.role).toBe("user");
      expect(result.msgs![0]?.blocks).toEqual([{ type: "text", text: "hi" }]);
    });

    it("parses system as string into a sys entry", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.sys).toEqual({
        id: "sys",
        blocks: [{ type: "text", text: "You are a helpful assistant." }],
      });
    });

    it("parses system as array of text blocks into a sys entry", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        system: [
          { type: "text", text: "First instruction." },
          { type: "text", text: "Second instruction.", cache_control: { type: "ephemeral" } },
          "Third instruction as raw string.",
          { type: "ignored", text: "should be skipped" },
        ],
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.sys?.blocks).toEqual([
        { type: "text", text: "First instruction." },
        { type: "text", text: "Second instruction." },
        { type: "text", text: "Third instruction as raw string." },
      ]);
    });

    it("parses tools with full schema into a tool entry", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        tools: [
          {
            name: "get_weather",
            description: "Get the weather for a location",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
          {
            name: "no_description",
            input_schema: { type: "object" },
          },
        ],
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.tool?.id).toBe("tool");
      expect(result.tool?.blocks).toEqual([
        {
          type: "td",
          name: "get_weather",
          description: "Get the weather for a location",
          inputSchema: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
        {
          type: "td",
          name: "no_description",
          description: null,
          inputSchema: { type: "object" },
        },
      ]);
    });

    it("parses a user message with text + image content array", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "iVBORw0KGgo=",
                },
              },
            ],
          },
        ],
      });

      expect(result.msgs![0]?.role).toBe("user");
      expect(result.msgs![0]?.blocks).toHaveLength(2);
      expect(result.msgs![0]?.blocks[0]).toEqual({
        type: "text",
        text: "What is in this image?",
      });
      expect(result.msgs![0]?.blocks[1]).toEqual({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgo=",
        },
      });
    });

    it("parses a message with thinking content", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Let me reason about this." },
              { type: "text", text: "The answer is 42." },
            ],
          },
        ],
      });

      expect(result.msgs![0]?.blocks).toEqual([
        { type: "thinking", thinking: "Let me reason about this." },
        { type: "text", text: "The answer is 42." },
      ]);
    });

    it("parses assistant tool_use blocks", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_01",
                name: "get_weather",
                input: { location: "SF" },
              },
            ],
          },
        ],
      });

      expect(result.msgs![0]?.blocks).toEqual([
        {
          type: "tc",
          id: "toolu_01",
          name: "get_weather",
          arguments: JSON.stringify({ location: "SF" }),
        },
      ]);
    });

    it("preserves string input for tool_use as-is", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_02",
                name: "echo",
                input: "raw-string-arg",
              },
            ],
          },
        ],
      });

      expect(result.msgs![0]?.blocks[0]).toEqual({
        type: "tc",
        id: "toolu_02",
        name: "echo",
        arguments: "raw-string-arg",
      });
    });

    it("parses user tool_result with string content", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_01",
                content: "sunny, 72F",
              },
            ],
          },
        ],
      });

      expect(result.msgs![0]?.blocks).toEqual([
        { type: "tr", toolCallId: "toolu_01", content: "sunny, 72F" },
      ]);
    });

    it("parses user tool_result with array content (text + image)", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_03",
                content: [
                  { type: "text", text: "Here is the screenshot: " },
                  { type: "text", text: "and notes." },
                  {
                    type: "image",
                    source: { type: "base64", media_type: "image/png", data: "abc" },
                  },
                  { type: "unknown", whatever: true },
                ],
              },
            ],
          },
        ],
      });

      expect(result.msgs![0]?.blocks).toEqual([
        {
          type: "tr",
          toolCallId: "toolu_03",
          content: "Here is the screenshot: and notes.",
        },
      ]);
    });

    it("parses a multi-turn conversation with tool flow", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        system: "Be concise.",
        tools: [
          {
            name: "lookup",
            description: "Look something up",
            input_schema: { type: "object", properties: { q: { type: "string" } } },
          },
        ],
        messages: [
          { role: "user", content: "What's the capital of France?" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Let me look that up." },
              {
                type: "tool_use",
                id: "toolu_99",
                name: "lookup",
                input: { q: "capital of France" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_99",
                content: "Paris",
              },
            ],
          },
        ],
      });

      expect(result.sys?.blocks).toEqual([{ type: "text", text: "Be concise." }]);
      expect(result.tool?.blocks).toHaveLength(1);
      expect(result.msgs!).toHaveLength(3);
      expect(result.msgs![0]?.role).toBe("user");
      expect(result.msgs![1]?.role).toBe("assistant");
      expect(result.msgs![1]?.blocks).toHaveLength(2);
      expect(result.msgs![2]?.role).toBe("user");
      expect(result.msgs![2]?.blocks[0]).toEqual({
        type: "tr",
        toolCallId: "toolu_99",
        content: "Paris",
      });
    });

    it("flattens unknown content types to 'other' blocks", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "hello" },
              { type: "document", source: { type: "url", url: "https://example.com/doc.pdf" } },
              { type: "tool_use", id: "x", name: "y" }, // missing input
            ],
          },
        ],
      });

      expect(result.msgs![0]?.blocks).toHaveLength(3);
      expect(result.msgs![0]?.blocks[0]).toEqual({ type: "text", text: "hello" });
      expect(result.msgs![0]?.blocks[1]).toEqual({
        type: "other",
        raw: {
          type: "document",
          source: { type: "url", url: "https://example.com/doc.pdf" },
        },
      });
      expect(result.msgs![0]?.blocks[2]).toEqual({
        type: "tc",
        id: "x",
        name: "y",
        arguments: "{}",
      });
    });

    it("substitutes an empty text block when message has no content", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [
          { role: "user" },
          { role: "user", content: [] },
          // Non-record, non-string array entries are skipped → blocks ends up empty.
          { role: "user", content: [null, 42] as unknown },
        ],
      });

      expect(result.msgs!).toHaveLength(3);
      for (const m of result.msgs!) {
        expect(m?.blocks).toEqual([{ type: "text", text: "" }]);
      }
    });

    it("defaults missing role to 'user'", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [{ content: "hi" }],
      });

      expect(result.msgs![0]?.role).toBe("user");
    });

    it("parses streaming flag", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.stream).toBe(true);
    });

    it("returns empty messages array for empty messages", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        messages: [],
      });

      expect(result.msgs!).toEqual([]);
    });

    it("skips non-record entries in messages and tools arrays", () => {
      const result = anthropicParser.parseRequest({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        tools: [null, "not a tool", { name: "valid_tool", input_schema: {} }] as unknown,
        messages: [
          null,
          "string msg",
          { role: "user", content: "real msg" },
        ] as unknown,
      });

      expect(result.tool?.blocks).toHaveLength(1);
      expect(result.tool?.blocks[0]).toMatchObject({ type: "td", name: "valid_tool" });
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0]?.blocks).toEqual([{ type: "text", text: "real msg" }]);
    });
  });

  describe("parseResponse", () => {
    it("returns empty object for non-record body", () => {
      expect(anthropicParser.parseResponse(null)).toEqual({});
      expect(anthropicParser.parseResponse([] as unknown)).toEqual({});
    });

    it("parses a single text content block", () => {
      const result = anthropicParser.parseResponse({
        id: "msg_01",
        type: "message",
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: [{ type: "text", text: "Hello there." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      expect(result.model).toBe("claude-3-5-sonnet-20241022");
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0]?.role).toBe("assistant");
      expect(result.msgs![0]?.blocks).toEqual([{ type: "text", text: "Hello there." }]);
    });

    it("parses multiple content blocks (text + tool_use)", () => {
      const result = anthropicParser.parseResponse({
        id: "msg_02",
        type: "message",
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: [
          { type: "text", text: "Let me look that up." },
          {
            type: "tool_use",
            id: "toolu_a",
            name: "get_weather",
            input: { city: "Paris" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 12, output_tokens: 8 },
      });

      expect(result.msgs![0]?.blocks).toEqual([
        { type: "text", text: "Let me look that up." },
        {
          type: "tc",
          id: "toolu_a",
          name: "get_weather",
          arguments: JSON.stringify({ city: "Paris" }),
        },
      ]);
    });

    it("parses thinking content in response", () => {
      const result = anthropicParser.parseResponse({
        id: "msg_03",
        type: "message",
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: [
          { type: "thinking", thinking: "Reasoning step by step." },
          { type: "text", text: "Final answer." },
        ],
        usage: { input_tokens: 20, output_tokens: 30 },
      });

      expect(result.msgs![0]?.blocks).toEqual([
        { type: "thinking", thinking: "Reasoning step by step." },
        { type: "text", text: "Final answer." },
      ]);
    });

    it("falls back to 'other' for unknown response content types", () => {
      const result = anthropicParser.parseResponse({
        id: "msg_04",
        type: "message",
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: [
          { type: "text", text: "ok" },
          { type: "image", source: { type: "base64", data: "..." } },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      expect(result.msgs![0]?.blocks).toEqual([
        { type: "text", text: "ok" },
        {
          type: "other",
          raw: { type: "image", source: { type: "base64", data: "..." } },
        },
      ]);
    });

    it("parses full usage with cache tokens", () => {
      const result = anthropicParser.parseResponse({
        model: "claude-3-5-sonnet-20241022",
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 80,
        },
      });

      // inputMiss = 100 - 80 = 20
      expect(result.usage).toEqual({
        inputMissTokens: 20,
        inputHitTokens: 80,
        outputTokens: 50,
      });
    });

    it("parses partial usage (no cache tokens)", () => {
      const result = anthropicParser.parseResponse({
        model: "claude-3-5-sonnet-20241022",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      expect(result.usage).toEqual({
        inputMissTokens: 10,
        inputHitTokens: null,
        outputTokens: 5,
      });
    });

    it("returns null usage when usage is absent", () => {
      const result = anthropicParser.parseResponse({
        model: "claude-3-5-sonnet-20241022",
        content: [{ type: "text", text: "ok" }],
      });

      expect(result.usage).toBeNull();
    });

    it("returns null usage when usage has non-numeric fields", () => {
      const result = anthropicParser.parseResponse({
        model: "claude-3-5-sonnet-20241022",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: "not-a-number" },
      });

      // All numeric fields fall back to 0 → inputMiss=0 (falsy, → null), cache=0 → null, output=0 → null
      expect(result.usage).toEqual({
        inputMissTokens: null,
        inputHitTokens: null,
        outputTokens: null,
      });
    });

    it("returns empty msgs when content is missing or empty", () => {
      expect(
        anthropicParser.parseResponse({
          model: "claude-3-5-sonnet-20241022",
          content: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }).msgs,
      ).toEqual([]);

      expect(
        anthropicParser.parseResponse({
          model: "claude-3-5-sonnet-20241022",
          usage: { input_tokens: 1, output_tokens: 1 },
        }).msgs,
      ).toEqual([]);
    });

    it("skips non-record entries in content array", () => {
      const result = anthropicParser.parseResponse({
        model: "claude-3-5-sonnet-20241022",
        content: [
          null,
          "raw string content",
          { type: "text", text: "kept" },
        ] as unknown,
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      // "raw string content" is a non-record entry, gets skipped (per source code: !isRecord)
      expect(result.msgs![0]?.blocks).toEqual([{ type: "text", text: "kept" }]);
    });
  });
});
