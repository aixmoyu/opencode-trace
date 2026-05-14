import { describe, it, expect } from "vitest";
import "./openai-chat.js";
import { extractLatency } from "./detect.js";
import type { TraceRecord } from "../types.js";

describe("extractLatency", () => {
  it("should calculate TTFT from latency metadata", () => {
    const record: TraceRecord = {
      id: 1,
      purpose: "",
      requestAt: "2026-04-29T00:00:00.000Z",
      responseAt: "2026-04-29T00:00:01.000Z",
      request: { method: "POST", url: "https://example.com", headers: {}, body: null },
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
      request: { method: "POST", url: "https://example.com", headers: {}, body: null },
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
    expect(latency?.tpot).toBeCloseTo(0.20, 2); // (90.34 - 70.12) / 100 = 0.2022
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