import { describe, it, expect } from "vitest";
import { openaiResponsesParser } from "./openai-responses.js";
import type { ToolDefinitionBlock, ToolCallBlock } from "./types.js";

describe("openaiResponsesParser.provider", () => {
  it("exposes the openai-responses provider id", () => {
    expect(openaiResponsesParser.provider).toBe("openai-responses");
  });
});

describe("openaiResponsesParser.match", () => {
  const cases: Array<{ name: string; url: string; body: unknown; expected: boolean }> = [
    {
      name: "matches /v1/responses when body has input",
      url: "https://api.openai.com/v1/responses",
      body: { model: "gpt-4o", input: "hello" },
      expected: true,
    },
    {
      name: "matches /v1/responses with input as array",
      url: "https://api.openai.com/v1/responses",
      body: { model: "gpt-4o", input: [] },
      expected: true,
    },
    {
      name: "matches /responses path on non-openai host when body has input",
      url: "https://proxy.example.com/v1/responses",
      body: { input: "hi" },
      expected: true,
    },
    {
      name: "matches /responses with query string when body has input",
      url: "https://api.openai.com/v1/responses?stream=true",
      body: { input: "hi" },
      expected: true,
    },
    {
      name: "falls back to openai.com host match when body lacks input",
      url: "https://api.openai.com/v1/responses",
      body: { model: "gpt-4o" },
      expected: true,
    },
    {
      name: "does not match /chat/completions even on openai.com",
      url: "https://api.openai.com/v1/chat/completions",
      body: { input: "hi" },
      expected: false,
    },
    {
      name: "does not match /v1/messages (anthropic path)",
      url: "https://api.anthropic.com/v1/messages",
      body: { input: "hi" },
      expected: false,
    },
    {
      name: "does not match /v1/responses on non-openai host without body.input",
      url: "https://proxy.example.com/v1/responses",
      body: { model: "gpt-4o" },
      expected: false,
    },
    {
      name: "does not match empty body on non-openai host",
      url: "https://proxy.example.com/v1/responses",
      body: {},
      expected: false,
    },
    {
      name: "does not match null body on non-openai host",
      url: "https://proxy.example.com/v1/responses",
      body: null,
      expected: false,
    },
    {
      name: "does not match non-record body on non-openai host",
      url: "https://proxy.example.com/v1/responses",
      body: "not an object",
      expected: false,
    },
    {
      name: "does not match completely unrelated URL",
      url: "https://example.com/foo",
      body: { input: "hi" },
      expected: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(openaiResponsesParser.match(c.url, c.body)).toBe(c.expected);
    });
  }
});

describe("openaiResponsesParser.parseRequest", () => {
  it("returns an empty conversation for non-record body", () => {
    const conv = openaiResponsesParser.parseRequest("not a body");
    expect(conv.provider).toBe("openai-responses");
    expect(conv.model).toBeNull();
    expect(conv.msgs).toEqual([]);
    expect(conv.usage).toBeNull();
    expect(conv.stream).toBe(false);
    expect(conv.sys).toBeUndefined();
    expect(conv.tool).toBeUndefined();
  });

  it("returns an empty conversation for null body", () => {
    const conv = openaiResponsesParser.parseRequest(null);
    expect(conv.msgs).toEqual([]);
    expect(conv.usage).toBeNull();
  });

  it("parses model field as string", () => {
    const conv = openaiResponsesParser.parseRequest({
      model: "gpt-4o",
      input: "hi",
    });
    expect(conv.model).toBe("gpt-4o");
  });

  it("parses model field as null when missing or not a string", () => {
    const conv = openaiResponsesParser.parseRequest({ input: "hi", model: 42 });
    expect(conv.model).toBeNull();
  });

  it("sets stream=true when body.stream === true", () => {
    const conv = openaiResponsesParser.parseRequest({ input: "hi", stream: true });
    expect(conv.stream).toBe(true);
  });

  it("sets stream=false when body.stream is missing or not boolean true", () => {
    expect(
      openaiResponsesParser.parseRequest({ input: "hi" }).stream,
    ).toBe(false);
    expect(
      openaiResponsesParser.parseRequest({ input: "hi", stream: "yes" }).stream,
    ).toBe(false);
  });

  describe("input handling", () => {
    it("treats string input as a user message with text block", () => {
      const conv = openaiResponsesParser.parseRequest({ input: "Hello there" });
      expect(conv.msgs).toHaveLength(1);
      const m = conv.msgs[0];
      expect(m.role).toBe("user");
      expect(m.blocks).toEqual([{ type: "text", text: "Hello there" }]);
    });

    it("parses input array with a single message containing input_text", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "What is the weather?" }],
          },
        ],
      });
      expect(conv.msgs).toHaveLength(1);
      expect(conv.msgs[0].role).toBe("user");
      expect(conv.msgs[0].blocks).toEqual([
        { type: "text", text: "What is the weather?" },
      ]);
    });

    it("parses input array with a message containing output_text", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Hi there" }],
          },
        ],
      });
      expect(conv.msgs[0].role).toBe("assistant");
      expect(conv.msgs[0].blocks).toEqual([
        { type: "text", text: "Hi there" },
      ]);
    });

    it("parses input array with a message containing plain text content", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          { type: "message", role: "user", content: "just a string" },
        ],
      });
      expect(conv.msgs[0].blocks).toEqual([
        { type: "text", text: "just a string" },
      ]);
    });

    it("parses input array with a message containing an image content part", () => {
      const imagePart = {
        type: "input_image",
        image_url: "https://example.com/cat.png",
        detail: "high",
      };
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "What's in this image?" },
              imagePart,
            ],
          },
        ],
      });
      expect(conv.msgs[0].blocks).toHaveLength(2);
      expect(conv.msgs[0].blocks[0]).toEqual({
        type: "text",
        text: "What's in this image?",
      });
      expect(conv.msgs[0].blocks[1]).toEqual({
        type: "other",
        raw: { type: "image", source: imagePart },
      });
    });

    it("parses input array with a message containing a file content part", () => {
      const filePart = {
        type: "input_file",
        file_id: "file_abc123",
        filename: "report.pdf",
      };
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "Summarize this" },
              filePart,
            ],
          },
        ],
      });
      expect(conv.msgs[0].blocks[1]).toEqual({
        type: "other",
        raw: { type: "file", source: filePart },
      });
    });

    it("parses function_call item with id, call_id, name, and string arguments", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "function_call",
            id: "fc_001",
            call_id: "call_abc",
            name: "get_weather",
            arguments: '{"city":"SF"}',
          },
        ],
      });
      expect(conv.msgs).toHaveLength(1);
      expect(conv.msgs[0].role).toBe("assistant");
      expect(conv.msgs[0].blocks).toEqual([
        {
          type: "tc",
          id: "fc_001",
          name: "get_weather",
          arguments: '{"city":"SF"}',
        },
      ]);
    });

    it("stringifies function_call arguments when they are an object", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "function_call",
            id: "fc_002",
            call_id: "call_xyz",
            name: "search",
            arguments: { q: "opencode", n: 5 },
          },
        ],
      });
      expect(conv.msgs[0].blocks[0]).toMatchObject({
        type: "tc",
        id: "fc_002",
        name: "search",
      });
      expect(
        (conv.msgs[0].blocks[0] as { arguments: string }).arguments,
      ).toBe(JSON.stringify({ q: "opencode", n: 5 }));
    });

    it("parses function_call_output item with string output", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "function_call_output",
            call_id: "call_abc",
            output: "sunny, 72F",
          },
        ],
      });
      expect(conv.msgs).toHaveLength(1);
      expect(conv.msgs[0].role).toBe("tool");
      expect(conv.msgs[0].blocks).toEqual([
        {
          type: "tr",
          toolCallId: "call_abc",
          content: "sunny, 72F",
        },
      ]);
    });

    it("stringifies function_call_output when output is an object", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "function_call_output",
            call_id: "call_xyz",
            output: { temperature: 72, unit: "F" },
          },
        ],
      });
      expect(conv.msgs[0].blocks[0]).toMatchObject({
        type: "tr",
        toolCallId: "call_xyz",
      });
      expect(
        (conv.msgs[0].blocks[0] as { content: string }).content,
      ).toBe(JSON.stringify({ temperature: 72, unit: "F" }));
    });

    it("preserves order of mixed input items in conversation", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          { type: "message", role: "user", content: "weather?" },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "c1",
            name: "get_weather",
            arguments: "{}",
          },
          {
            type: "function_call_output",
            call_id: "c1",
            output: "sunny",
          },
          { type: "message", role: "assistant", content: "It's sunny." },
        ],
      });
      expect(conv.msgs).toHaveLength(4);
      expect(conv.msgs.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
      expect(conv.msgs[0].blocks[0]).toMatchObject({
        type: "text",
        text: "weather?",
      });
      expect(conv.msgs[1].blocks[0]).toMatchObject({ type: "tc" });
      expect(conv.msgs[2].blocks[0]).toMatchObject({ type: "tr" });
      expect(conv.msgs[3].blocks[0]).toMatchObject({
        type: "text",
        text: "It's sunny.",
      });
    });

    it("parses string item inside input array as a user message", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: ["raw user text"],
      });
      expect(conv.msgs[0].role).toBe("user");
      expect(conv.msgs[0].blocks).toEqual([
        { type: "text", text: "raw user text" },
      ]);
    });

    it("defaults missing role to user", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [{ type: "message", content: "no role specified" }],
      });
      expect(conv.msgs[0].role).toBe("user");
    });

    it("treats message item with tool role and tool_call_id as a tool result", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "message",
            role: "tool",
            tool_call_id: "call_abc",
            content: [{ type: "input_text", text: "tool output text" }],
          },
        ],
      });
      expect(conv.msgs[0].role).toBe("tool");
      expect(conv.msgs[0].blocks).toEqual([
        {
          type: "tr",
          toolCallId: "call_abc",
          content: "tool output text",
        },
      ]);
    });

    it("falls back to JSON string for tool role content with no text blocks", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "message",
            role: "tool",
            tool_call_id: "call_abc",
            content: [{ type: "input_image", image_url: "x" }],
          },
        ],
      });
      expect(conv.msgs[0].role).toBe("tool");
      expect(conv.msgs[0].blocks[0]).toMatchObject({
        type: "tr",
        toolCallId: "call_abc",
      });
      const content = (conv.msgs[0].blocks[0] as { content: string }).content;
      expect(content).toBe(JSON.stringify([{ type: "input_image", image_url: "x" }]));
    });

    it("emits empty text block when message has no content parts", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [{ type: "message", role: "user" }],
      });
      expect(conv.msgs[0].blocks).toEqual([{ type: "text", text: "" }]);
    });

    it("falls through to other block for unknown content part type", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "totally_unknown_part", data: 1 }],
          },
        ],
      });
      expect(conv.msgs[0].blocks).toEqual([
        { type: "other", raw: { type: "totally_unknown_part", data: 1 } },
      ]);
    });
  });

  describe("tools handling", () => {
    it("parses function tool with full schema", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          },
        ],
      });
      expect(conv.tool).toBeDefined();
      expect(conv.tool?.id).toBe("tool");
      expect(conv.tool?.blocks).toHaveLength(1);
      expect(conv.tool?.blocks[0]).toEqual({
        type: "td",
        name: "get_weather",
        description: "Get the current weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      });
    });

    it("parses function tool without description as null", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [
          {
            type: "function",
            function: { name: "no_desc", parameters: {} },
          },
        ],
      });
      expect(conv.tool?.blocks[0]).toMatchObject({
        type: "td",
        name: "no_desc",
        description: null,
      });
    });

    it("parses web_search_preview tool", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [{ type: "web_search_preview" }],
      });
      expect(conv.tool?.blocks[0]).toEqual({
        type: "td",
        name: "web_search_preview",
        description: "Web search tool",
        inputSchema: null,
      });
    });

    it("parses web_search_preview_2025_03_11 tool variant as web_search_preview", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [{ type: "web_search_preview_2025_03_11" }],
      });
      expect(conv.tool?.blocks[0]).toMatchObject({
        type: "td",
        name: "web_search_preview",
      });
    });

    it("parses file_search tool without vector_store_ids", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [{ type: "file_search" }],
      });
      expect(conv.tool?.blocks[0]).toEqual({
        type: "td",
        name: "file_search",
        description: "File search tool",
        inputSchema: null,
      });
    });

    it("parses file_search tool with vector_store_ids string", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [
          { type: "file_search", vector_store_ids: "vs_abc,vs_def" },
        ],
      });
      expect(conv.tool?.blocks[0]).toMatchObject({
        type: "td",
        name: "file_search",
        description: "File search: vs_abc,vs_def",
      });
    });

    it("parses computer_use_preview tool", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [{ type: "computer_use_preview" }],
      });
      expect(conv.tool?.blocks[0]).toEqual({
        type: "td",
        name: "computer_use_preview",
        description: "Computer use tool",
        inputSchema: null,
      });
    });

    it("parses code_interpreter tool", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [{ type: "code_interpreter" }],
      });
      expect(conv.tool?.blocks[0]).toEqual({
        type: "td",
        name: "code_interpreter",
        description: "Code interpreter tool",
        inputSchema: null,
      });
    });

    it("parses multiple tool definitions in order", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [
          { type: "web_search_preview" },
          {
            type: "function",
            function: { name: "f1", description: "d", parameters: {} },
          },
          { type: "code_interpreter" },
        ],
      });
      const toolNames = conv.tool?.blocks
        .filter((b): b is ToolDefinitionBlock | ToolCallBlock => b.type === "td" || b.type === "tc")
        .map((b) => b.name) ?? [];
      expect(toolNames).toEqual([
        "web_search_preview",
        "f1",
        "code_interpreter",
      ]);
    });

    it("falls through to generic tool definition for unknown tool type with name", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        tools: [
          {
            type: "custom_tool",
            name: "my_tool",
            description: "custom",
          },
        ],
      });
      expect(conv.tool?.blocks[0]).toMatchObject({
        type: "td",
        name: "my_tool",
        description: "custom",
        inputSchema: null,
      });
    });

    it("omits tool entry when tools is missing", () => {
      const conv = openaiResponsesParser.parseRequest({ input: "hi" });
      expect(conv.tool).toBeUndefined();
    });

    it("omits tool entry when tools is an empty array", () => {
      const conv = openaiResponsesParser.parseRequest({ input: "hi", tools: [] });
      expect(conv.tool).toBeUndefined();
    });
  });

  describe("system instructions", () => {
    it("creates a sys entry from top-level instructions string", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        instructions: "You are a helpful assistant.",
      });
      expect(conv.sys).toBeDefined();
      expect(conv.sys?.id).toBe("sys");
      expect(conv.sys?.blocks).toEqual([
        { type: "text", text: "You are a helpful assistant." },
      ]);
    });

    it("omits sys entry when instructions is missing", () => {
      const conv = openaiResponsesParser.parseRequest({ input: "hi" });
      expect(conv.sys).toBeUndefined();
    });

    it("omits sys entry when instructions is not a string", () => {
      const conv = openaiResponsesParser.parseRequest({
        input: "hi",
        instructions: { not: "a string" },
      });
      expect(conv.sys).toBeUndefined();
    });
  });

  it("uses a stable id for message entries", () => {
    const conv = openaiResponsesParser.parseRequest({ input: "hello" });
    expect(conv.msgs[0].id).toEqual(expect.any(String));
    expect(conv.msgs[0].id.length).toBeGreaterThan(0);
  });
});

describe("openaiResponsesParser.parseResponse", () => {
  it("returns empty object for non-record body", () => {
    expect(openaiResponsesParser.parseResponse("not a body")).toEqual({});
    expect(openaiResponsesParser.parseResponse(null)).toEqual({});
  });

  it("returns a default Conversation-shaped partial for empty body", () => {
    expect(openaiResponsesParser.parseResponse({})).toEqual({
      model: undefined,
      msgs: [],
      usage: null,
    });
  });

  it("returns empty msgs for empty output array", () => {
    const result = openaiResponsesParser.parseResponse({ output: [] });
    expect(result.msgs!).toEqual([]);
  });

  it("extracts model from response body", () => {
    const result = openaiResponsesParser.parseResponse({ model: "gpt-4o" });
    expect(result.model).toBe("gpt-4o");
  });

  it("leaves model undefined when missing", () => {
    const result = openaiResponsesParser.parseResponse({});
    expect(result.model).toBeUndefined();
  });

  describe("output items", () => {
    it("parses message with output_text", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "Hello from the model", annotations: [] },
            ],
          },
        ],
      });
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0].role).toBe("assistant");
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "Hello from the model" },
      ]);
    });

    it("parses message with multiple output_text parts", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "part 1 " },
              { type: "output_text", text: "part 2" },
            ],
          },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "part 1 " },
        { type: "text", text: "part 2" },
      ]);
    });

    it("parses refusal content as bracketed text", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "I cannot help with that." }],
          },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "text", text: "[refused: I cannot help with that.]" },
      ]);
    });

    it("falls through to other block for unknown content part types", () => {
      const unknownPart = { type: "made_up_thing", payload: 1 };
      const result = openaiResponsesParser.parseResponse({
        output: [
          { type: "message", content: [unknownPart] },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([{ type: "other", raw: unknownPart }]);
    });

    it("emits empty text block for message with no content", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [{ type: "message" }],
      });
      expect(result.msgs![0].blocks).toEqual([{ type: "text", text: "" }]);
    });

    it("parses function_call with id, call_id, name and string arguments", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "function_call",
            id: "fc_001",
            call_id: "call_abc",
            name: "get_weather",
            arguments: '{"city":"SF"}',
          },
        ],
      });
      expect(result.msgs![0].role).toBe("assistant");
      expect(result.msgs![0].blocks).toEqual([
        {
          type: "tc",
          id: "fc_001",
          name: "get_weather",
          arguments: '{"city":"SF"}',
        },
      ]);
    });

    it("stringifies function_call arguments when they are an object", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "function_call",
            id: "fc_002",
            name: "search",
            arguments: { q: "opencode" },
          },
        ],
      });
      expect(result.msgs![0].blocks[0]).toMatchObject({
        type: "tc",
        id: "fc_002",
        name: "search",
      });
      expect(
        (result.msgs![0].blocks[0] as { arguments: string }).arguments,
      ).toBe(JSON.stringify({ q: "opencode" }));
    });

    it("parses reasoning item with summary_text into a thinking block", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "reasoning",
            id: "rs_1",
            summary: [
              { type: "summary_text", text: "Let me think about " },
              { type: "summary_text", text: "the answer." },
            ],
          },
        ],
      });
      expect(result.msgs![0].role).toBe("assistant");
      expect(result.msgs![0].blocks).toEqual([
        { type: "thinking", thinking: "Let me think about the answer." },
      ]);
    });

    it("emits empty text block for reasoning item with no summary", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [{ type: "reasoning", id: "rs_2" }],
      });
      expect(result.msgs![0].blocks).toEqual([{ type: "text", text: "" }]);
    });

    it("parses web_search_call as other block with status", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          { type: "web_search_call", id: "ws_1", status: "completed" },
        ],
      });
      expect(result.msgs![0].role).toBe("assistant");
      expect(result.msgs![0].blocks).toEqual([
        { type: "other", raw: { type: "web_search", status: "completed" } },
      ]);
    });

    it("parses file_search_call as other block with status", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          { type: "file_search_call", id: "fs_1", status: "in_progress" },
        ],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "other", raw: { type: "file_search", status: "in_progress" } },
      ]);
    });

    it("parses computer_call as other block with computer_use type", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [{ type: "computer_call", id: "cu_1" }],
      });
      expect(result.msgs![0].blocks).toEqual([
        { type: "other", raw: { type: "computer_use" } },
      ]);
    });

    it("parses function_call_output item from response as tool result", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "function_call_output",
            call_id: "call_abc",
            output: "ok",
          },
        ],
      });
      expect(result.msgs![0].role).toBe("tool");
      expect(result.msgs![0].blocks).toEqual([
        { type: "tr", toolCallId: "call_abc", content: "ok" },
      ]);
    });

    it("falls through unknown output item types to other block", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [{ type: "some_future_type", payload: 1 }],
      });
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0].role).toBe("assistant");
      expect(result.msgs![0].blocks).toEqual([
        { type: "other", raw: { type: "some_future_type", payload: 1 } },
      ]);
    });

    it("preserves order of multiple output items", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "thinking" }],
          },
          {
            type: "message",
            content: [{ type: "output_text", text: "final answer" }],
          },
          {
            type: "function_call",
            id: "fc_x",
            name: "do_it",
            arguments: "{}",
          },
        ],
      });
      expect(result.msgs!).toHaveLength(3);
      expect(result.msgs![0].blocks[0]).toMatchObject({ type: "thinking" });
      expect(result.msgs![1].blocks[0]).toMatchObject({
        type: "text",
        text: "final answer",
      });
      expect(result.msgs![2].blocks[0]).toMatchObject({ type: "tc" });
    });

    it("skips non-record items in output array", () => {
      const result = openaiResponsesParser.parseResponse({
        output: [
          "a string",
          null,
          42,
          {
            type: "message",
            content: [{ type: "output_text", text: "valid" }],
          },
        ],
      });
      expect(result.msgs!).toHaveLength(1);
      expect(result.msgs![0].blocks[0]).toMatchObject({
        type: "text",
        text: "valid",
      });
    });
  });

  describe("usage handling", () => {
    it("parses usage with full details (input, output, cached, reasoning)", () => {
      const result = openaiResponsesParser.parseResponse({
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          input_tokens_details: { cached_tokens: 30 },
          output_tokens_details: { reasoning_tokens: 20 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: 70,
        inputHitTokens: 30,
        outputTokens: 50,
      });
    });

    it("parses usage with only input and output tokens", () => {
      const result = openaiResponsesParser.parseResponse({
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      expect(result.usage).toEqual({
        inputMissTokens: 10,
        inputHitTokens: null,
        outputTokens: 5,
      });
    });

    it("parses usage with only cached tokens (input=0)", () => {
      const result = openaiResponsesParser.parseResponse({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          input_tokens_details: { cached_tokens: 5 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: null,
        inputHitTokens: 5,
        outputTokens: null,
      });
    });

    it("returns null usage when usage is missing", () => {
      const result = openaiResponsesParser.parseResponse({});
      expect(result.usage).toBeNull();
    });

    it("returns null usage when usage is not a record", () => {
      const result = openaiResponsesParser.parseResponse({ usage: "nope" });
      expect(result.usage).toBeNull();
    });

    it("treats non-numeric token fields as zero", () => {
      const result = openaiResponsesParser.parseResponse({
        usage: {
          input_tokens: "100",
          output_tokens: null,
          input_tokens_details: { cached_tokens: undefined },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: null,
        inputHitTokens: null,
        outputTokens: null,
      });
    });

    it("treats cached_tokens of 0 as no cache hit", () => {
      const result = openaiResponsesParser.parseResponse({
        usage: {
          input_tokens: 50,
          output_tokens: 10,
          input_tokens_details: { cached_tokens: 0 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: 50,
        inputHitTokens: null,
        outputTokens: 10,
      });
    });

    it("computes inputMissTokens as input minus cached tokens", () => {
      const result = openaiResponsesParser.parseResponse({
        usage: {
          input_tokens: 20,
          output_tokens: 1,
          input_tokens_details: { cached_tokens: 20 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: null,
        inputHitTokens: 20,
        outputTokens: 1,
      });
    });

    it("ignores output_tokens_details.reasoning_tokens (parser does not surface it)", () => {
      const result = openaiResponsesParser.parseResponse({
        usage: {
          input_tokens: 10,
          output_tokens: 10,
          output_tokens_details: { reasoning_tokens: 5 },
        },
      });
      expect(result.usage).toEqual({
        inputMissTokens: 10,
        inputHitTokens: null,
        outputTokens: 10,
      });
    });
  });

  it("uses a stable id for assistant message entries", () => {
    const result = openaiResponsesParser.parseResponse({
      output: [
        { type: "message", content: [{ type: "output_text", text: "hi" }] },
      ],
    });
    expect(result.msgs!?.[0].id).toEqual(expect.any(String));
    expect(result.msgs!?.[0].id.length).toBeGreaterThan(0);
  });
});
