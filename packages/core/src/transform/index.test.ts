import { describe, it, expect } from "vitest";
import {
  sseOpenaiChatParse,
  sseOpenaiChatToMessages,
  sseOpenaiResponsesParse,
  sseOpenaiResponsesToMessages,
  sseAnthropicParse,
  sseAnthropicToMessages,
} from "./index.js";
import type { Block, Entry } from "../model/types.js";

function textOf(blocks: Block[]): string {
  const b = blocks[0];
  if (b.type !== "text") {
    throw new Error(`expected text block, got ${b.type}`);
  }
  return b.text;
}

function thinkingOf(blocks: Block[]): string {
  const b = blocks[0];
  if (b.type !== "thinking") {
    throw new Error(`expected thinking block, got ${b.type}`);
  }
  return b.thinking;
}

function toolCallOf(blocks: Block[], index: number) {
  const b = blocks[index];
  if (b.type !== "tc") {
    throw new Error(`expected tc block, got ${b.type}`);
  }
  return b;
}

describe("sseOpenaiChatParse", () => {
  it("returns empty messages and null usage for empty input", () => {
    const result = sseOpenaiChatParse("");
    expect(result.messages).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("returns empty messages and null usage for a stream that only contains [DONE]", () => {
    const result = sseOpenaiChatParse("data: [DONE]\n\n");
    expect(result.messages).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("accumulates text content deltas across chunks into a single text block", () => {
    const raw =
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"!"}}]}\n\n' +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.messages).toHaveLength(1);
    const entry: Entry = result.messages[0];
    expect(entry.role).toBe("assistant");
    expect(typeof entry.id).toBe("string");
    expect(entry.blocks).toHaveLength(1);
    expect(entry.blocks[0].type).toBe("text");
    expect(textOf(entry.blocks)).toBe("Hello world!");
  });

  it("uses only the first choice in a multi-choice stream", () => {
    const raw =
      "data: {\"choices\":[" +
      "{\"index\":0,\"delta\":{\"content\":\"First\"}}," +
      "{\"index\":1,\"delta\":{\"content\":\"Second\"}}" +
      "]}\n\n" +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("First");
  });

  it("accumulates incremental tool_call function name and arguments", () => {
    const argPart1 = '{"loc';
    const argPart2 = 'ation": "NYC"}';
    const raw =
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[" +
      "{\"index\":0,\"id\":\"call_abc\",\"type\":\"function\"," +
      "\"function\":{\"name\":\"get_weather\",\"arguments\":\"\"}}" +
      "]}}]}\n\n" +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":${JSON.stringify(argPart1)}}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":${JSON.stringify(argPart2)}}}]}}]}\n\n` +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(1);
    const tc = toolCallOf(result.messages[0].blocks, 0);
    expect(tc.id).toBe("call_abc");
    expect(tc.name).toBe("get_weather");
    expect(tc.arguments).toBe('{"location": "NYC"}');
  });

  it("emits a separate thinking block when reasoning_content deltas are present", () => {
    const raw =
      'data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}\n\n' +
      'data: {"choices":[{"delta":{"reasoning_content":" about this"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Final answer"}}]}\n\n' +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(2);
    expect(result.messages[0].blocks[0].type).toBe("thinking");
    expect(thinkingOf(result.messages[0].blocks)).toBe(
      "Let me think about this",
    );
    expect(result.messages[0].blocks[1].type).toBe("text");
    expect(textOf(result.messages[0].blocks.slice(1))).toBe("Final answer");
  });

  it("extracts usage including cache details from a usage chunk", () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      "data: {\"choices\":[],\"usage\":{" +
      "\"prompt_tokens\":100,\"completion_tokens\":50," +
      "\"prompt_tokens_details\":{\"cached_tokens\":20}" +
      "}}\n\n" +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.usage).toEqual({
      inputMissTokens: 80,
      inputHitTokens: 20,
      outputTokens: 50,
    });
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("hi");
  });

  it("returns empty messages when only a usage chunk is present", () => {
    const raw =
      "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n" +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.messages).toEqual([]);
    expect(result.usage).toEqual({
      inputMissTokens: 10,
      inputHitTokens: null,
      outputTokens: 5,
    });
  });

  it("skips events with invalid JSON without crashing", () => {
    const raw =
      "data: {not valid json}\n\n" +
      'data: {"choices":[{"delta":{"content":"recovered"}}]}\n\n' +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("recovered");
  });

  it("ignores model, object, created, id fields in chunks (real API style)", () => {
    const raw =
      'data: {"id":"chatcmpl-64aeb901","created":1780631328,"model":"GLM-5.1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"reasoning_content":"The","role":"assistant"}}]}\n\n' +
      'data: {"id":"chatcmpl-64aeb901","created":1780631328,"model":"GLM-5.1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"reasoning_content":" user"}}]}\n\n' +
      'data: {"id":"chatcmpl-64aeb901","created":1780631328,"model":"GLM-5.1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n' +
      "data: [DONE]\n\n";
    const result = sseOpenaiChatParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(2);
    expect(result.messages[0].blocks[0].type).toBe("thinking");
    expect(thinkingOf(result.messages[0].blocks)).toBe("The user");
    expect(result.messages[0].blocks[1].type).toBe("text");
    expect(textOf(result.messages[0].blocks.slice(1))).toBe("Hello");
  });
});

describe("sseOpenaiChatToMessages", () => {
  it("returns the messages array from a parsed stream", () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      "data: [DONE]\n\n";
    const messages = sseOpenaiChatToMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(textOf(messages[0].blocks)).toBe("hi");
  });

  it("returns an empty array for an empty stream", () => {
    expect(sseOpenaiChatToMessages("")).toEqual([]);
  });
});

describe("sseOpenaiResponsesParse", () => {
  it("returns empty messages and null usage for empty input", () => {
    const result = sseOpenaiResponsesParse("");
    expect(result.messages).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("accumulates response.output_text.delta into a text block", () => {
    const raw =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"Hello"}\n\n' +
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":" world"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("Hello world");
  });

  it("accumulates response.reasoning_summary_text.delta into a thinking block", () => {
    const raw =
      'event: response.reasoning_summary_text.delta\n' +
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Let me think"}\n\n' +
      'event: response.reasoning_summary_text.delta\n' +
      'data: {"type":"response.reasoning_summary_text.delta","delta":" more"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(1);
    expect(thinkingOf(result.messages[0].blocks)).toBe("Let me think more");
  });

  it("builds a function_call tool block from added+delta+done events", () => {
    const argPart1 = '{"loc';
    const argPart2 = 'ation": "NYC"}';
    const raw =
      'event: response.output_item.added\n' +
      'data: {"type":"response.output_item.added","output_index":1,' +
      '"item":{"type":"function_call","id":"fc_1","name":"get_weather"}}\n\n' +
      'event: response.function_call_arguments.delta\n' +
      `data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":${JSON.stringify(argPart1)}}\n\n` +
      'event: response.function_call_arguments.delta\n' +
      `data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":${JSON.stringify(argPart2)}}\n\n` +
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","output_index":1,' +
      '"item":{"type":"function_call","id":"fc_1","name":"get_weather"}}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(1);
    const tc = toolCallOf(result.messages[0].blocks, 0);
    expect(tc.id).toBe("fc_1");
    expect(tc.name).toBe("get_weather");
    expect(tc.arguments).toBe('{"location": "NYC"}');
  });

  it("prefers item.arguments from response.output_item.done when present", () => {
    const raw =
      'event: response.output_item.added\n' +
      'data: {"type":"response.output_item.added","output_index":0,' +
      '"item":{"type":"function_call","id":"fc_2","name":"echo","arguments":""}}\n\n' +
      'event: response.function_call_arguments.delta\n' +
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"stale-partial"}\n\n' +
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","output_index":0,' +
      '"item":{"type":"function_call","id":"fc_2","name":"echo","arguments":"{\\"msg\\":\\"final\\"}"}}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    const tc = toolCallOf(result.messages[0].blocks, 0);
    expect(tc.arguments).toBe('{"msg":"final"}');
  });

  it("ignores non-function_call output_item.done events (web_search, file_search, computer_use)", () => {
    const raw =
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","item":{"type":"web_search_call","id":"ws_1"}}\n\n' +
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","item":{"type":"file_search_call","id":"fs_1"}}\n\n' +
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","item":{"type":"computer_use_call","id":"cu_1"}}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("emits a combined message with text and tool_call blocks on response.completed", () => {
    const raw =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"Calling tool..."}\n\n' +
      'event: response.output_item.added\n' +
      'data: {"type":"response.output_item.added","output_index":1,' +
      '"item":{"type":"function_call","id":"fc_3","name":"lookup","arguments":""}}\n\n' +
      'event: response.function_call_arguments.delta\n' +
      'data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{}"}\n\n' +
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","output_index":1,' +
      '"item":{"type":"function_call","id":"fc_3","name":"lookup","arguments":"{}"}}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed","usage":{"input_tokens":200,"output_tokens":50,"input_tokens_details":{"cached_tokens":30}}}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(2);
    expect(result.messages[0].blocks[0].type).toBe("text");
    expect(textOf(result.messages[0].blocks)).toBe("Calling tool...");
    expect(result.messages[0].blocks[1].type).toBe("tc");
    expect(toolCallOf(result.messages[0].blocks, 1).name).toBe("lookup");
    expect(result.usage).toEqual({
      inputMissTokens: 170,
      inputHitTokens: 30,
      outputTokens: 50,
    });
  });

  it("captures usage from response.completed even with no content blocks", () => {
    const raw =
      'event: response.completed\n' +
      'data: {"type":"response.completed","usage":{"input_tokens":100,"output_tokens":50,"input_tokens_details":{"cached_tokens":10}}}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toEqual([]);
    expect(result.usage).toEqual({
      inputMissTokens: 90,
      inputHitTokens: 10,
      outputTokens: 50,
    });
  });

  it("falls back to building a message at end-of-stream when no response.completed is present", () => {
    const raw =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"Hello"}\n\n' +
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":" world"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("Hello world");
  });

  it("ignores response.created and response.in_progress events (real API style)", () => {
    const raw =
      'event: response.created\n' +
      'data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress","output":[]}}\n\n' +
      'event: response.in_progress\n' +
      'data: {"type":"response.in_progress","response":{"id":"resp_1","status":"in_progress","output":[]}}\n\n' +
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"hi"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("hi");
  });

  it("ignores response.content_part.added and response.content_part.done events (real API style)", () => {
    const raw =
      'event: response.content_part.added\n' +
      'data: {"type":"response.content_part.added","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}\n\n' +
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"Hello"}\n\n' +
      'event: response.output_text.done\n' +
      'data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"Hello"}\n\n' +
      'event: response.content_part.done\n' +
      'data: {"type":"response.content_part.done","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text","text":"Hello","annotations":[]}}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("Hello");
  });

  it("ignores response.output_text.done event (real API style)", () => {
    const raw =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"Hello"}\n\n' +
      'event: response.output_text.done\n' +
      'data: {"type":"response.output_text.done","output_index":0,"text":"Hello"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("Hello");
  });

  it("ignores response.reasoning_summary_text.done event (real API style)", () => {
    const raw =
      'event: response.reasoning_summary_text.delta\n' +
      'data: {"type":"response.reasoning_summary_text.delta","delta":"thinking"}\n\n' +
      'event: response.reasoning_summary_text.done\n' +
      'data: {"type":"response.reasoning_summary_text.done","text":"thinking"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(thinkingOf(result.messages[0].blocks)).toBe("thinking");
  });

  it("ignores response.function_call_arguments.done event (real API style)", () => {
    const raw =
      'event: response.output_item.added\n' +
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","name":"f"}}\n\n' +
      'event: response.function_call_arguments.delta\n' +
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{}"}\n\n' +
      'event: response.function_call_arguments.done\n' +
      'data: {"type":"response.function_call_arguments.done","output_index":0,"arguments":"{}"}\n\n' +
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_1","name":"f","arguments":"{}"}}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(toolCallOf(result.messages[0].blocks, 0).name).toBe("f");
  });

  it("captures usage from response.completed with nested response object (real API style)", () => {
    const raw =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"hi"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":37,"output_tokens":11,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":48}}}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("hi");
    expect(result.usage).toEqual({
      inputMissTokens: 37,
      inputHitTokens: null,
      outputTokens: 11,
    });
  });

  it("handles full streaming flow with all event types (real API style)", () => {
    const raw =
      'event: response.created\n' +
      'data: {"type":"response.created","response":{"id":"resp_1","status":"in_progress","output":[]}}\n\n' +
      'event: response.in_progress\n' +
      'data: {"type":"response.in_progress","response":{"id":"resp_1","status":"in_progress","output":[]}}\n\n' +
      'event: response.output_item.added\n' +
      'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_1","type":"message","status":"in_progress","role":"assistant","content":[]}}\n\n' +
      'event: response.content_part.added\n' +
      'data: {"type":"response.content_part.added","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}\n\n' +
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"Hello"}\n\n' +
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":" world"}\n\n' +
      'event: response.output_text.done\n' +
      'data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"Hello world"}\n\n' +
      'event: response.content_part.done\n' +
      'data: {"type":"response.content_part.done","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text","text":"Hello world","annotations":[]}}\n\n' +
      'event: response.output_item.done\n' +
      'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Hello world","annotations":[]}]}}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("Hello world");
    expect(result.usage).toEqual({
      inputMissTokens: 10,
      inputHitTokens: null,
      outputTokens: 2,
    });
  });

  it("handles reasoning + text combined in a single stream (real API style)", () => {
    const raw =
      'event: response.reasoning_summary_text.delta\n' +
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Let me think"}\n\n' +
      'event: response.reasoning_summary_text.delta\n' +
      'data: {"type":"response.reasoning_summary_text.delta","delta":" about this"}\n\n' +
      'event: response.reasoning_summary_text.done\n' +
      'data: {"type":"response.reasoning_summary_text.done","text":"Let me think about this"}\n\n' +
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"Final answer"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const result = sseOpenaiResponsesParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(2);
    expect(result.messages[0].blocks[0].type).toBe("thinking");
    expect(thinkingOf(result.messages[0].blocks)).toBe("Let me think about this");
    expect(result.messages[0].blocks[1].type).toBe("text");
    expect(textOf(result.messages[0].blocks.slice(1))).toBe("Final answer");
  });
});

describe("sseOpenaiResponsesToMessages", () => {
  it("returns the messages array from a parsed stream", () => {
    const raw =
      'event: response.output_text.delta\n' +
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"hi"}\n\n' +
      'event: response.completed\n' +
      'data: {"type":"response.completed"}\n\n';
    const messages = sseOpenaiResponsesToMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(textOf(messages[0].blocks)).toBe("hi");
  });

  it("returns an empty array for an empty stream", () => {
    expect(sseOpenaiResponsesToMessages("")).toEqual([]);
  });
});

describe("sseAnthropicParse", () => {
  it("returns empty messages and null usage for empty input", () => {
    const result = sseAnthropicParse("");
    expect(result.messages).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("accumulates a text content block from text_delta events", () => {
    const raw =
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("Hello world");
  });

  it("captures thinking from content_block_start.thinking and thinking_delta", () => {
    const raw =
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"Hmm"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" let me think"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(1);
    expect(result.messages[0].blocks[0].type).toBe("thinking");
    expect(thinkingOf(result.messages[0].blocks)).toBe("Hmm let me think");
  });

  it("accumulates a tool_use block from input_json_delta partials", () => {
    const argPart1 = '{"loc';
    const argPart2 = 'ation": "NYC"}';
    const raw =
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}\n\n' +
      'event: content_block_delta\n' +
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(argPart1)}}}\n\n` +
      'event: content_block_delta\n' +
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(argPart2)}}}\n\n` +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(1);
    const tc = toolCallOf(result.messages[0].blocks, 0);
    expect(tc.id).toBe("toolu_1");
    expect(tc.name).toBe("get_weather");
    expect(tc.arguments).toBe('{"location": "NYC"}');
  });

  it("emits thinking, text, and tool_use blocks in order from interleaved content blocks", () => {
    const raw =
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Answer: "}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":"Plan: "}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"look up weather"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":1}\n\n' +
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_2","name":"lookup"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":2}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].blocks).toHaveLength(3);
    expect(result.messages[0].blocks[0].type).toBe("thinking");
    expect(thinkingOf(result.messages[0].blocks)).toBe("Plan: look up weather");
    expect(result.messages[0].blocks[1].type).toBe("text");
    expect(textOf(result.messages[0].blocks.slice(1))).toBe("Answer: ");
    expect(result.messages[0].blocks[2].type).toBe("tc");
    expect(toolCallOf(result.messages[0].blocks, 2).name).toBe("lookup");
  });

  it("captures usage and stop_reason from message_delta", () => {
    const raw =
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_delta\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":50,"output_tokens":10,"cache_read_input_tokens":5}}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.usage).toEqual({
      inputMissTokens: 45,
      inputHitTokens: 5,
      outputTokens: 10,
    });
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("done");
  });

  it("does not crash on message_stop with no preceding content", () => {
    const raw =
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toEqual([]);
    expect(result.usage).toBeNull();
  });

  it("ignores ping events (real API style)", () => {
    const raw =
      'event: ping\n' +
      'data: {}\n\n' +
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("hi");
  });

  it("ignores signature_delta events (real API style)", () => {
    const raw =
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig123"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("hi");
  });

  it("captures usage from message_start event (real API style)", () => {
    const raw =
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"MiniMax-M3","content":[],"usage":{"input_tokens":100,"output_tokens":0,"cache_read_input_tokens":50,"cache_creation_input_tokens":10}}}\n\n' +
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const result = sseAnthropicParse(raw);
    expect(result.messages).toHaveLength(1);
    expect(textOf(result.messages[0].blocks)).toBe("hi");
    expect(result.usage).toEqual({
      inputMissTokens: 50,
      inputHitTokens: 50,
      outputTokens: null,
    });
  });
});

describe("sseAnthropicToMessages", () => {
  it("returns the messages array from a parsed stream", () => {
    const raw =
      'event: content_block_start\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: content_block_stop\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const messages = sseAnthropicToMessages(raw);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(textOf(messages[0].blocks)).toBe("hi");
  });

  it("returns an empty array for an empty stream", () => {
    expect(sseAnthropicToMessages("")).toEqual([]);
  });
});
