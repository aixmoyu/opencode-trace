import { describe, it, expect } from "vitest";
import type { TraceRecord } from "./types.js";

describe("TraceRecord latency fields", () => {
  it("should accept latency metadata fields", () => {
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

    expect(record.requestSentAt).toBe(1234567.89);
    expect(record.firstTokenAt).toBe(1234570.12);
    expect(record.lastTokenAt).toBe(1234590.34);
  });

  it("should allow optional latency fields", () => {
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

    expect(record.requestSentAt).toBeUndefined();
    expect(record.firstTokenAt).toBeUndefined();
    expect(record.lastTokenAt).toBeUndefined();
  });
});