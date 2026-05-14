import { describe, it, expect } from "vitest";
import {
  TraceRecordSchema,
  TraceRequestSchema,
  TraceResponseSchema,
  TraceErrorSchema,
} from "./types.js";
import {
  TextBlockSchema,
  ThinkingBlockSchema,
  ToolCallBlockSchema,
  ToolResultBlockSchema,
  BlockSchema,
  EntrySchema,
  ConversationSchema,
} from "./parse-types.js";
import {
  DeltaSchema,
  EntryDeltaSchema,
  SessionTimelineSchema,
  SessionMetadataSchema,
} from "./query-types.js";
import {
  SessionMetaSchema,
  SessionMetadataFileSchema,
  ExportManifestSchema,
} from "./store-types.js";

describe("TraceRecordSchema", () => {
  const validRecord = {
    id: 1,
    purpose: "",
    requestAt: "2026-01-01T00:00:00.000Z",
    responseAt: "2026-01-01T00:00:01.000Z",
    request: {
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      headers: { "content-type": "application/json" },
      body: { model: "gpt-4" },
    },
    response: {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: { choices: [] },
    },
    error: null,
  };

  it("should parse a valid TraceRecord", () => {
    const result = TraceRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  it("should parse a TraceRecord with latency fields", () => {
    const result = TraceRecordSchema.safeParse({
      ...validRecord,
      requestSentAt: 1234.56,
      firstTokenAt: 1235.0,
      lastTokenAt: 1240.0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestSentAt).toBe(1234.56);
      expect(result.data.firstTokenAt).toBe(1235.0);
    }
  });

  it("should parse a TraceRecord with null response and error", () => {
    const result = TraceRecordSchema.safeParse({
      ...validRecord,
      response: null,
      error: { message: "Network error", stack: "Error: ..." },
    });
    expect(result.success).toBe(true);
  });

  it("should reject a TraceRecord with missing required fields", () => {
    const result = TraceRecordSchema.safeParse({ id: 1 });
    expect(result.success).toBe(false);
  });

  it("should reject a TraceRecord with invalid id type", () => {
    const result = TraceRecordSchema.safeParse({ ...validRecord, id: "abc" });
    expect(result.success).toBe(false);
  });

  it("should reject a TraceRecord with non-integer id", () => {
    const result = TraceRecordSchema.safeParse({ ...validRecord, id: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe("Block schemas", () => {
  it("should parse a TextBlock", () => {
    const result = TextBlockSchema.safeParse({ type: "text", text: "Hello" });
    expect(result.success).toBe(true);
  });

  it("should parse a ThinkingBlock", () => {
    const result = ThinkingBlockSchema.safeParse({ type: "thinking", thinking: "Hmm..." });
    expect(result.success).toBe(true);
  });

  it("should parse a ToolCallBlock", () => {
    const result = ToolCallBlockSchema.safeParse({
      type: "tc",
      id: "call_123",
      name: "read_file",
      arguments: '{"path":"/tmp"}',
    });
    expect(result.success).toBe(true);
  });

  it("should parse a ToolResultBlock", () => {
    const result = ToolResultBlockSchema.safeParse({
      type: "tr",
      toolCallId: "call_123",
      content: "file contents",
    });
    expect(result.success).toBe(true);
  });

  it("should parse discriminated union Block", () => {
    const result = BlockSchema.safeParse({ type: "text", text: "Hello" });
    expect(result.success).toBe(true);
  });

  it("should reject unknown block type", () => {
    const result = BlockSchema.safeParse({ type: "unknown", data: "x" });
    expect(result.success).toBe(false);
  });
});

describe("EntrySchema", () => {
  it("should parse a valid Entry", () => {
    const result = EntrySchema.safeParse({
      id: "msg_1",
      role: "user",
      blocks: [{ type: "text", text: "Hello" }],
    });
    expect(result.success).toBe(true);
  });

  it("should parse an Entry without role", () => {
    const result = EntrySchema.safeParse({
      id: "msg_1",
      blocks: [{ type: "text", text: "Hello" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("ConversationSchema", () => {
  it("should parse a valid Conversation", () => {
    const result = ConversationSchema.safeParse({
      provider: "openai-chat",
      model: "gpt-4",
      msgs: [{ id: "1", role: "user", blocks: [{ type: "text", text: "Hi" }] }],
      usage: { inputMissTokens: 10, inputHitTokens: 0, outputTokens: 5 },
      stream: false,
    });
    expect(result.success).toBe(true);
  });

  it("should parse a Conversation with null model and usage", () => {
    const result = ConversationSchema.safeParse({
      provider: "unknown",
      model: null,
      msgs: [],
      usage: null,
      stream: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("Delta schemas", () => {
  it("should parse a valid Delta", () => {
    const result = DeltaSchema.safeParse({
      msgs: [{ id: "1", added: [{ type: "text", text: "new" }] }],
    });
    expect(result.success).toBe(true);
  });

  it("should parse a Delta with sys and tool", () => {
    const result = DeltaSchema.safeParse({
      sys: { id: "sys", added: [{ type: "text", text: "system" }] },
      tool: { id: "tool", removed: [{ type: "td", name: "f", description: null, inputSchema: {} }] },
      msgs: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("SessionTimelineSchema", () => {
  it("should parse a valid SessionTimeline", () => {
    const result = SessionTimelineSchema.safeParse({
      sessionId: "abc123",
      totalRequests: 2,
      changes: [
        {
          requestId: 1,
          delta: { msgs: [] },
          interRequestDuration: null,
          isUserCall: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("SessionMetadataSchema", () => {
  it("should parse valid SessionMetadata", () => {
    const result = SessionMetadataSchema.safeParse({
      sessionId: "abc",
      tokenUsage: { inputMissTokens: 100, inputHitTokens: 50, outputTokens: 200, totalTokens: 350, cacheHitRate: 0.33 },
      requestCount: 5,
      subSessions: [],
      parentSession: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      latencyStats: { avgTTFT: 0.5, maxTTFT: 1.0, avgTPOT: 0.1, maxTPOT: 0.2, streamRequestCount: 3 },
      durationStats: { wallTime: 60000, totalRequestDuration: 30000 },
    });
    expect(result.success).toBe(true);
  });
});

describe("Store schemas", () => {
  it("should parse a valid SessionMeta", () => {
    const result = SessionMetaSchema.safeParse({
      id: "abc",
      requestCount: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("should parse SessionMetadataFile", () => {
    const result = SessionMetadataFileSchema.safeParse({
      sessionId: "abc",
      title: "My Session",
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("should parse ExportManifest", () => {
    const result = ExportManifestSchema.safeParse({
      exportedAt: "2026-01-01T00:00:00.000Z",
      mainSession: "abc",
      sessions: ["abc", "def"],
      version: "1.0",
    });
    expect(result.success).toBe(true);
  });
});
