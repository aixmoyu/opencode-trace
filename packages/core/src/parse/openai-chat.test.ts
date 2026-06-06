import { describe, it, expect, beforeEach } from "vitest";
import { openaiChatParser } from "./openai-chat.js";
import { clearParsersForTesting, registerParser, findParser } from "./registry.js";

describe("openaiChatParser", () => {
  describe("findParser", () => {
    beforeEach(() => {
      clearParsersForTesting();
      registerParser(openaiChatParser, "/chat/completions");
    });

    it("matches /chat/completions URL regardless of host", () => {
      expect(findParser("https://api.openai.com/v1/chat/completions")?.provider).toBe("openai-chat");
    });

    it("matches /chat/completions on proxy host", () => {
      expect(findParser("https://proxy.example.com/v1/chat/completions")?.provider).toBe("openai-chat");
    });

    it("matches /chat/completions with query string", () => {
      expect(findParser("https://api.openai.com/v1/chat/completions?stream=true")?.provider).toBe("openai-chat");
    });

    it("returns null for URL without /chat/completions", () => {
      expect(findParser("https://api.openai.com/v1/embeddings")).toBeNull();
    });

    it("returns null for unrelated URL", () => {
      expect(findParser("https://example.com/other")).toBeNull();
    });
  });

  describe("parseRequest", () => {
    it("returns empty conversation for non-record body", () => {
      const result = openaiChatParser.parseRequest(null);
      expect(result.provider).toBe("openai-chat");
      expect(result.model).toBeNull();
      expect(result.msgs!).toEqual([]);
      expect(result.usage).toBeNull();
      expect(result.stream).toBe(false);
      expect(result.sys).toBeUndefined();
      expect(result.tool).toBeUndefined();
    });

    it("returns empty conversation for string body", () => {
      const result = openaiChatParser.parseRequest("raw");
      expect(result.provider).toBe("openai-chat");
      expect(result.msgs!).toEqual([]);
    });

    it("returns empty conversation for array body", () => {
      const result = openaiChatParser.parseRequest([]);
      expect(result.msgs!).toEqual([]);
    });

    it("parses model from body", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [],
      });
      expect(result.model).toBe("gpt-4");
    });

    it("returns null model when model is missing or non-string", () => {
      expect(
        openaiChatParser.parseRequest({ messages: [] }).model,
      ).toBeNull();
      expect(
        openaiChatParser.parseRequest({ model: 123, messages: [] }).model,
      ).toBeNull();
    });

    it("ignores max_tokens field (real API style)", () => {
      const result = openaiChatParser.parseRequest({
        model: "GLM-5.1",
        max_tokens: 32000,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.model).toBe("GLM-5.1");
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0]?.blocks).toEqual([{ type: "text", text: "hi" }]);
    });

    it("sets stream=true when body.stream is true", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        stream: true,
        messages: [],
      });
      expect(result.stream).toBe(true);
    });

    it("sets stream=false when body.stream is missing or not true", () => {
      expect(
        openaiChatParser.parseRequest({ messages: [] }).stream,
      ).toBe(false);
      expect(
        openaiChatParser.parseRequest({ stream: "yes", messages: [] }).stream,
      ).toBe(false);
    });

    it("combines top-level system/developer/instructions into a single sys entry", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        system: "You are helpful.",
        developer: "Be concise.",
        instructions: "Follow safety.",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.sys).toBeDefined();
      expect(result.sys!.id).toBe("sys");
      expect(result.sys!.blocks).toEqual([
        { type: "text", text: "You are helpful.\nBe concise.\nFollow safety." },
      ]);
    });

    it("extracts system and developer messages from messages array into sys entry", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          { role: "system", content: "sys 1" },
          { role: "developer", content: "dev 1" },
          { role: "user", content: "hi" },
        ],
      });
      expect(result.sys).toBeDefined();
      expect(result.sys!.blocks).toEqual([
        { type: "text", text: "sys 1\ndev 1" },
      ]);
    });

    it("combines top-level system with message-based system messages", () => {
      const result = openaiChatParser.parseRequest({
        system: "top",
        messages: [
          { role: "system", content: "from msg" },
          { role: "user", content: "hi" },
        ],
      });
      expect(result.sys!.blocks[0]).toEqual({
        type: "text",
        text: "top\nfrom msg",
      });
    });

    it("filters out system/developer messages from msgs", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
      });
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0].role).toBe("user");
    });

    it("returns undefined sys when no system content is present", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.sys).toBeUndefined();
    });

    it("returns undefined sys when system message has null content", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          { role: "system", content: null },
          { role: "user", content: "hi" },
        ],
      });
      expect(result.sys).toBeUndefined();
    });

    it("ignores non-string top-level system fields", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        system: 123,
        developer: null,
        instructions: { not: "a string" },
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.sys).toBeUndefined();
    });

    it("parses user message with string content", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      });
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0].role).toBe("user");
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "hello" },
      ]);
    });

    it("parses user message with array content (text + image_url + input_audio)", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Look at this:" },
              {
                type: "image_url",
                image_url: { url: "https://example.com/cat.jpg" },
              },
              { type: "input_audio", input_audio: { data: "base64..." } },
            ],
          },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "Look at this:" },
        { type: "image", source: "https://example.com/cat.jpg" },
        {
          type: "other",
          raw: {
            type: "audio",
            data: { type: "input_audio", input_audio: { data: "base64..." } },
          },
        },
      ]);
    });

    it("parses plain string parts inside array content", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content: ["part1", { type: "text", text: "part2" }],
          },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "part1" },
        { type: "text", text: "part2" },
      ]);
    });

    it("parses unknown part types as 'other' blocks", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          { role: "user", content: [{ type: "weird", foo: "bar" }] },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "other", raw: { type: "weird", foo: "bar" } },
      ]);
    });

    it("falls back to 'other' for image_url with missing url field", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          { role: "user", content: [{ type: "image_url", image_url: {} }] },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "other", raw: { type: "image_url", image_url: {} } },
      ]);
    });

    it("falls back to 'other' for image_url with non-record image_url field", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          { role: "user", content: [{ type: "image_url", image_url: "raw" }] },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "other", raw: { type: "image_url", image_url: "raw" } },
      ]);
    });

    it("parses assistant tool_calls with string arguments", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            content: "I'll look that up.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"SF"}' },
              },
            ],
          },
        ],
      });
      const tcBlocks = result.msgs![0].blocks.filter((b) => b.type === "tc");
      expect(tcBlocks).toEqual([
        {
          type: "tc",
          id: "call_1",
          name: "get_weather",
          arguments: '{"city":"SF"}',
        },
      ]);
    });

    it("stringifies non-string tool_call arguments", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "f", arguments: { x: 1 } },
              },
            ],
          },
        ],
      });
      const tcBlocks = result.msgs![0].blocks.filter((b) => b.type === "tc");
      expect(tcBlocks[0].arguments).toBe('{"x":1}');
    });

    it("uses empty object stringification for null tool_call arguments", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "f", arguments: null },
              },
            ],
          },
        ],
      });
      const tcBlocks = result.msgs![0].blocks.filter((b) => b.type === "tc");
      expect(tcBlocks[0].arguments).toBe("{}");
    });

    it("converts tool_call with non-record function to default fields", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: "not a record" },
            ],
          },
        ],
      });
      const tcBlocks = result.msgs![0].blocks.filter((b) => b.type === "tc");
      expect(tcBlocks).toEqual([
        { type: "tc", id: "call_1", name: "", arguments: "{}" },
      ]);
    });

    it("parses tool_call_id into a tool result entry with text content", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "f", arguments: "{}" },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "the result" },
        ],
      });
      const toolEntry = result.msgs!.find((m) => m.role === "tool");
      expect(toolEntry).toBeDefined();
      expect(toolEntry!.blocks).toEqual([
        { type: "tr", toolCallId: "call_1", content: "the result" },
      ]);
    });

    it("stringifies non-string tool_call_id content", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          { role: "tool", tool_call_id: "call_1", content: { foo: "bar" } },
        ],
      });
      expect(result.msgs![0].role).toBe("tool");
      expect(result.msgs![0].blocks[0]).toEqual({
        type: "tr",
        toolCallId: "call_1",
        content: '{"foo":"bar"}',
      });
    });

    it("prepends reasoning_content as a thinking block to other blocks", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            content: "answer",
            reasoning_content: "let me think",
          },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "thinking", thinking: "let me think" },
        { type: "text", text: "answer" },
      ]);
    });

    it("defaults role to 'user' when role is missing", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [{ content: "no role" }],
      });
      expect(result.msgs![0].role).toBe("user");
      expect(result.msgs![0].blocks).toEqual([{ type: "text", text: "no role" }]);
    });

    it("wraps non-record message elements into user text entries", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: ["raw string"],
      });
      expect(result.msgs![0].role).toBe("user");
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "raw string" },
      ]);
    });

    it("returns empty text block when message has no content and no tool_calls", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [{ role: "assistant" }],
      });
      expect(result.msgs![0].blocks).toEqual([{ type: "text", text: "" }]);
    });

    it("skips non-record tool_call entries", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: [
          {
            role: "assistant",
            content: "x",
            tool_calls: [
              null,
              "string",
              {
                id: "a",
                function: { name: "f", arguments: "{}" },
              },
            ],
          },
        ],
      });
      const tcBlocks = result.msgs![0].blocks.filter((b) => b.type === "tc");
      expect(tcBlocks).toHaveLength(1);
    });

    it("returns empty messages array when messages is not an array", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        messages: "not an array",
      });
      expect(result.msgs!).toEqual([]);
    });

    it("extracts tools array into a tool entry with full definition", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get current weather",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
              },
            },
          },
        ],
        messages: [],
      });
      expect(result.tool).toBeDefined();
      expect(result.tool!.id).toBe("tool");
      expect(result.tool!.blocks).toEqual([
        {
          type: "td",
          name: "get_weather",
          description: "Get current weather",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ]);
    });

    it("extracts tools with top-level name (no function wrapper); description is null", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        tools: [{ name: "direct_tool", description: "Direct" }],
        messages: [],
      });
      // Note: extractTools only reads fn.description, not tool.description,
      // so top-level description is dropped unless wrapped in `function`.
      expect(result.tool!.blocks[0]).toEqual({
        type: "td",
        name: "direct_tool",
        description: null,
        inputSchema: null,
      });
    });

    it("handles non-record tool entries", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        tools: ["raw"],
        messages: [],
      });
      expect(result.tool!.blocks[0]).toEqual({
        type: "td",
        name: "raw",
        description: null,
        inputSchema: null,
      });
    });

    it("returns undefined tool when tools array is empty", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        tools: [],
        messages: [],
      });
      expect(result.tool).toBeUndefined();
    });

    it("returns undefined tool when tools is not an array", () => {
      const result = openaiChatParser.parseRequest({
        model: "gpt-4",
        tools: "not an array",
        messages: [],
      });
      expect(result.tool).toBeUndefined();
    });
  });

  describe("parseResponse", () => {
    it("returns empty object for non-record body", () => {
      expect(openaiChatParser.parseResponse(null)).toEqual({});
      expect(openaiChatParser.parseResponse("raw")).toEqual({});
      expect(openaiChatParser.parseResponse([])).toEqual({});
    });

    it("returns empty msgs for empty choices array", () => {
      const result = openaiChatParser.parseResponse({ choices: [] });
      expect(result.msgs!).toEqual([]);
    });

    it("returns empty msgs for missing choices", () => {
      const result = openaiChatParser.parseResponse({});
      expect(result.msgs!).toEqual([]);
    });

    it("returns empty msgs for choice without message", () => {
      const result = openaiChatParser.parseResponse({ choices: [{}] });
      expect(result.msgs!).toEqual([]);
    });

    it("parses content as string", () => {
      const result = openaiChatParser.parseResponse({
        model: "gpt-4",
        choices: [
          { message: { role: "assistant", content: "Hello there" } },
        ],
      });
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0].role).toBe("assistant");
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "Hello there" },
      ]);
      expect(result.model).toBe("gpt-4");
    });

    it("parses tool_calls in response with string arguments", () => {
      const result = openaiChatParser.parseResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "f", arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
      const tcBlocks = result.msgs![0].blocks.filter((b) => b.type === "tc");
      expect(tcBlocks).toEqual([
        { type: "tc", id: "call_1", name: "f", arguments: "{}" },
      ]);
    });

    it("stringifies object tool_call arguments in response", () => {
      const result = openaiChatParser.parseResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "f", arguments: { x: 1 } },
                },
              ],
            },
          },
        ],
      });
      const tcBlocks = result.msgs![0].blocks.filter((b) => b.type === "tc");
      expect(tcBlocks[0].arguments).toBe('{"x":1}');
    });

    it("parses reasoning_content in response as thinking block", () => {
      const result = openaiChatParser.parseResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: "answer",
              reasoning_content: "thinking",
            },
          },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "thinking", thinking: "thinking" },
        { type: "text", text: "answer" },
      ]);
    });

    it("returns empty text block when message has no content/tool_calls/reasoning", () => {
      const result = openaiChatParser.parseResponse({
        choices: [{ message: { role: "assistant" } }],
      });
      expect(result.msgs![0].blocks).toEqual([{ type: "text", text: "" }]);
    });

    it("parses usage with prompt_tokens and completion_tokens", () => {
      const result = openaiChatParser.parseResponse({
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
      expect(result.usage).toEqual({
        inputMissTokens: 100,
        inputHitTokens: null,
        outputTokens: 50,
      });
    });

    it("parses usage with cached_tokens (splits into miss/hit)", () => {
      const result = openaiChatParser.parseResponse({
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 30 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: 70,
        inputHitTokens: 30,
        outputTokens: 50,
      });
    });

    it("ignores completion_tokens_details (does not affect usage)", () => {
      const result = openaiChatParser.parseResponse({
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          completion_tokens_details: { reasoning_tokens: 20 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: 100,
        inputHitTokens: null,
        outputTokens: 50,
      });
    });

    it("returns null inputMissTokens when cached > prompt", () => {
      const result = openaiChatParser.parseResponse({
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 30 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: null,
        inputHitTokens: 30,
        outputTokens: 5,
      });
    });

    it("returns null usage when usage is not a record", () => {
      const result = openaiChatParser.parseResponse({ usage: "not a record" });
      expect(result.usage).toBeNull();
    });

    it("returns null usage when usage is missing", () => {
      const result = openaiChatParser.parseResponse({});
      expect(result.usage).toBeNull();
    });

    it("treats outputTokens=0 as null", () => {
      const result = openaiChatParser.parseResponse({
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });
      expect(result.usage!.outputTokens).toBeNull();
    });
  });
});
