import { describe, it, expect, beforeEach } from "vitest";
import "./openai-chat.js";
import "./openai-responses.js";
import "./anthropic.js";
import {
  detectAndParse,
  detectProvider,
  extractUsage,
  extractLatency,
} from "./detect.js";
import { openaiChatParser } from "./openai-chat.js";
import { openaiResponsesParser } from "./openai-responses.js";
import { anthropicParser } from "./anthropic.js";
import { clearParsersForTesting, registerParser } from "./registry.js";
import type { TraceRecord } from "../types.js";

describe("extractLatency", () => {
  it("should calculate TTFT from latency metadata", () => {
    const record: TraceRecord = {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: {
        method: "POST",
        url: "https://example.com",
        headers: {},
        body: null,
      },
      response: null,
      error: null,
      requestSentAt: 1234567.89,
      firstTokenAt: 1234570.12,
      lastTokenAt: 1234590.34,
    };

    const latency = extractLatency(record);
    expect(latency?.ttft).toBeCloseTo(2.23, 1);
    expect(latency?.totalDuration).toBeCloseTo(22.45, 1);
  });

  it("should return null for non-stream requests", () => {
    const record: TraceRecord = {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: {
        method: "POST",
        url: "https://example.com",
        headers: {},
        body: null,
      },
      response: null,
      error: null,
    };

    const latency = extractLatency(record);
    expect(latency).toBeNull();
  });

  it("should calculate TPOT from OpenAI chat response usage", () => {
    const record: TraceRecord = {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 100 },
        },
      },
      error: null,
      requestSentAt: 1234567.89,
      firstTokenAt: 1234570.12,
      lastTokenAt: 1234590.34,
    };

    const latency = extractLatency(record);
    expect(latency?.tpot).toBeCloseTo(0.2, 2); // (90.34 - 70.12) / 100 = 0.2022
  });

  it("should return null TPOT when response has no usage", () => {
    const record: TraceRecord = {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
        },
      },
      error: null,
      requestSentAt: 1234567.89,
      firstTokenAt: 1234570.12,
      lastTokenAt: 1234590.34,
    };

    expect(extractLatency(record)?.tpot).toBeNull();
  });
});

describe("detectProvider", () => {
  beforeEach(() => {
    clearParsersForTesting();
    registerParser(openaiChatParser, "/chat/completions");
    registerParser(openaiResponsesParser, "/responses");
    registerParser(anthropicParser, "/v1/messages");
  });

  it("returns 'openai-chat' for /chat/completions URL with messages array body", () => {
    expect(
      detectProvider("https://api.openai.com/v1/chat/completions", {
        messages: [],
      }),
    ).toBe("openai-chat");
  });

  it("returns 'openai-responses' for /responses URL with input field", () => {
    expect(
      detectProvider("https://api.openai.com/v1/responses", { input: [] }),
    ).toBe("openai-responses");
  });

  it("returns 'anthropic' for /v1/messages URL", () => {
    expect(
      detectProvider("https://api.anthropic.com/v1/messages", {}),
    ).toBe("anthropic");
  });

  it("returns null when no parser matches", () => {
    expect(detectProvider("https://example.com/unknown", {})).toBeNull();
  });
});

describe("detectAndParse", () => {
  beforeEach(() => {
    clearParsersForTesting();
    registerParser(openaiChatParser, "/chat/completions");
    registerParser(openaiResponsesParser, "/responses");
    registerParser(anthropicParser, "/v1/messages");
  });

  function makeRecord(overrides: Partial<TraceRecord>): TraceRecord {
    return {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: null,
      },
      response: null,
      error: null,
      ...overrides,
    };
  }

  it("routes to openai-chat parser for /chat/completions URL", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [
            { message: { role: "assistant", content: "hello" } },
          ],
        },
      },
    });
    const conv = detectAndParse(record);
    expect(conv.provider).toBe("openai-chat");
    expect(conv.model).toBe("gpt-4");
    expect(conv.msgs).toHaveLength(2);
    expect(conv.stream).toBe(false);
  });

  it("routes to openai-responses parser for /responses URL", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/responses",
        headers: {},
        body: {
          model: "gpt-4",
          input: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          model: "gpt-4",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "hello" }],
            },
          ],
        },
      },
    });
    const conv = detectAndParse(record);
    expect(conv.provider).toBe("openai-responses");
    expect(conv.msgs).toHaveLength(2);
  });

  it("routes to anthropic parser for /v1/messages URL", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        headers: {},
        body: {
          model: "claude-3",
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          content: [{ type: "text", text: "hello" }],
        },
      },
    });
    const conv = detectAndParse(record);
    expect(conv.provider).toBe("anthropic");
    expect(conv.msgs).toHaveLength(2);
  });

  it("falls back to 'unknown' provider when no parser matches", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://example.com/other",
        headers: {},
        body: { messages: [{ role: "user", content: "hi" }] },
      },
    });
    const conv = detectAndParse(record);
    expect(conv.provider).toBe("unknown");
    expect(conv.msgs).toHaveLength(1);
  });

  it("falls back when URL and body match no parser", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://example.com/other",
        headers: {},
        body: "raw string",
      },
    });
    const conv = detectAndParse(record);
    expect(conv.provider).toBe("unknown");
    expect(conv.msgs).toEqual([]);
  });

  it("uses SSE parsing when stream=true and response body contains 'data:'", () => {
    const sseBody =
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
      "data: [DONE]\n\n";
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: sseBody,
      },
    });
    const conv = detectAndParse(record);
    expect(conv.stream).toBe(true);
    expect(conv.usage).toEqual({
      inputMissTokens: 10,
      inputHitTokens: null,
      outputTokens: 5,
    });
    expect(conv.msgs).toHaveLength(2);
    const assistantMsg = conv.msgs[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.blocks[0]).toEqual({ type: "text", text: "Hello world" });
  });

  it("uses non-stream parseResponse when stream=false", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
        },
      },
    });
    const conv = detectAndParse(record);
    expect(conv.stream).toBe(false);
    expect(conv.msgs).toHaveLength(2);
  });

  it("uses non-stream path when stream=true but response is not SSE", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hello" } }],
        },
      },
    });
    const conv = detectAndParse(record);
    expect(conv.stream).toBe(true);
    expect(conv.msgs).toHaveLength(2);
    expect(conv.msgs[1].blocks[0]).toEqual({ type: "text", text: "hello" });
  });

  it("preserves response model over request model", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          model: "gpt-4-0613",
          choices: [{ message: { role: "assistant", content: "hi" } }],
        },
      },
    });
    expect(detectAndParse(record).model).toBe("gpt-4-0613");
  });

  it("uses request model when response has no model", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hi" } }],
        },
      },
    });
    expect(detectAndParse(record).model).toBe("gpt-4");
  });

  it("returns only request msgs when response is null", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: null,
    });
    const conv = detectAndParse(record);
    expect(conv.msgs).toHaveLength(1);
    expect(conv.msgs[0].role).toBe("user");
  });
});

describe("extractUsage", () => {
  beforeEach(() => {
    clearParsersForTesting();
    registerParser(openaiChatParser, "/chat/completions");
    registerParser(openaiResponsesParser, "/responses");
    registerParser(anthropicParser, "/v1/messages");
  });

  function makeRecord(overrides: Partial<TraceRecord>): TraceRecord {
    return {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: { method: "POST", url: "x", headers: {}, body: null },
      response: null,
      error: null,
      ...overrides,
    };
  }

  it("returns null when no parser matches the URL", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://example.com/other",
        headers: {},
        body: {},
      },
    });
    expect(extractUsage(record)).toBeNull();
  });

  it("extracts usage from a non-stream OpenAI Chat response", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "hi" } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        },
      },
    });
    expect(extractUsage(record)).toEqual({
      inputMissTokens: 100,
      inputHitTokens: null,
      outputTokens: 50,
    });
  });

  it("extracts usage from a stream SSE body (OpenAI Chat)", () => {
    const sseBody =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
      "data: [DONE]\n\n";
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: {
          model: "gpt-4",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: sseBody,
      },
    });
    expect(extractUsage(record)).toEqual({
      inputMissTokens: 10,
      inputHitTokens: null,
      outputTokens: 5,
    });
  });

  it("extracts usage from an OpenAI Responses response (input_tokens_details.cached_tokens)", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/responses",
        headers: {},
        body: { model: "gpt-4", input: [] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          output: [],
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            input_tokens_details: { cached_tokens: 50 },
          },
        },
      },
    });
    expect(extractUsage(record)).toEqual({
      inputMissTokens: 150,
      inputHitTokens: 50,
      outputTokens: 100,
    });
  });

  it("returns null when response is null and not a stream", () => {
    const record = makeRecord({
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [] },
      },
      response: null,
    });
    expect(extractUsage(record)).toBeNull();
  });
});

describe("extractLatency (additional edge cases)", () => {
  beforeEach(() => {
    clearParsersForTesting();
    registerParser(openaiChatParser, "/chat/completions");
    registerParser(openaiResponsesParser, "/responses");
    registerParser(anthropicParser, "/v1/messages");
  });

  function makeRecord(overrides: Partial<TraceRecord>): TraceRecord {
    return {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: { method: "POST", url: "x", headers: {}, body: null },
      response: null,
      error: null,
      ...overrides,
    };
  }

  it("returns null when requestSentAt is missing", () => {
    const record = makeRecord({
      firstTokenAt: 100,
      lastTokenAt: 200,
    });
    expect(extractLatency(record)).toBeNull();
  });

  it("returns null when firstTokenAt is missing", () => {
    const record = makeRecord({
      requestSentAt: 0,
      lastTokenAt: 200,
    });
    expect(extractLatency(record)).toBeNull();
  });

  it("returns null when lastTokenAt is missing", () => {
    const record = makeRecord({
      requestSentAt: 0,
      firstTokenAt: 100,
    });
    expect(extractLatency(record)).toBeNull();
  });

  it("returns latency info with raw timing values when no usage", () => {
    const record = makeRecord({
      requestSentAt: 1000,
      firstTokenAt: 1010,
      lastTokenAt: 1050,
    });
    const latency = extractLatency(record);
    expect(latency).not.toBeNull();
    expect(latency!.requestSentAt).toBe(1000);
    expect(latency!.firstTokenAt).toBe(1010);
    expect(latency!.lastTokenAt).toBe(1050);
    expect(latency!.ttft).toBe(10);
    expect(latency!.totalDuration).toBe(50);
    expect(latency!.tpot).toBeNull();
  });

  it("returns tpot=0 when firstTokenAt === lastTokenAt and outputTokens > 0", () => {
    const record = makeRecord({
      requestSentAt: 1000,
      firstTokenAt: 1010,
      lastTokenAt: 1010,
      request: {
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        headers: {},
        body: { model: "gpt-4", messages: [] },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: {},
        body: {
          choices: [{ message: { role: "assistant", content: "x" } }],
          usage: { prompt_tokens: 1, completion_tokens: 10 },
        },
      },
    });
    expect(extractLatency(record)!.tpot).toBe(0);
  });

  it("handles latency = 0 (firstTokenAt === requestSentAt)", () => {
    const record = makeRecord({
      requestSentAt: 100,
      firstTokenAt: 100,
      lastTokenAt: 100,
    });
    const latency = extractLatency(record);
    expect(latency!.ttft).toBe(0);
    expect(latency!.totalDuration).toBe(0);
    expect(latency!.tpot).toBeNull();
  });
});
