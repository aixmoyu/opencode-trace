import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => process.env._TEST_DIR_ || original.homedir(),
  };
});

vi.mock("@opencode-trace/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@opencode-trace/core")>();
  return {
    ...original,
    store: {
      listSessionsFromBothDirs: vi.fn().mockReturnValue([]),
      listSessionsTreeFromBothDirs: vi.fn().mockReturnValue([]),
      getSessionRecords: vi.fn().mockReturnValue([]),
      getRecord: vi.fn().mockReturnValue(null),
      getSSEStream: vi.fn().mockReturnValue(null),
      readTimelineIndex: vi.fn().mockReturnValue([]),
      getCachedParsed: vi.fn().mockReturnValue(null),
      readSessionMetadata: vi.fn().mockReturnValue(null),
      exportSessionZip: vi.fn().mockResolvedValue(Buffer.from("PK")),
      importSessionZip: vi.fn().mockResolvedValue({
        status: "success",
        importedSessions: [{ sessionId: "x", requestCount: 0, strategy: "none" }],
      }),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    },
    parse: {
      detectAndParse: vi.fn().mockReturnValue({
        provider: "openai-chat",
        model: "gpt-4",
        msgs: [],
        usage: null,
        stream: false,
      }),
      detectProvider: vi.fn().mockReturnValue("openai-chat"),
      extractUsage: vi.fn().mockReturnValue({
        inputMissTokens: 10,
        inputHitTokens: 0,
        outputTokens: 5,
      }),
      extractLatency: vi.fn().mockReturnValue({
        requestSentAt: 1,
        firstTokenAt: 101,
        lastTokenAt: 201,
        ttft: 100,
        tpot: null,
        totalDuration: 200,
      }),
      openaiChatParser: {
        parseRequest: vi.fn().mockReturnValue({
          provider: "openai-chat",
          model: "gpt-4",
          msgs: [],
          usage: null,
          stream: false,
        }),
        parseResponse: vi.fn().mockReturnValue({ msgs: [], usage: null }),
      },
      openaiResponsesParser: {
        parseRequest: vi.fn().mockReturnValue({
          provider: "openai-responses",
          model: "gpt-4",
          msgs: [],
          usage: null,
          stream: false,
        }),
        parseResponse: vi.fn().mockReturnValue({ msgs: [], usage: null }),
      },
      anthropicParser: {
        parseRequest: vi.fn().mockReturnValue({
          provider: "anthropic",
          model: "claude-3",
          msgs: [],
          usage: null,
          stream: false,
        }),
        parseResponse: vi.fn().mockReturnValue({ msgs: [], usage: null }),
      },
    },
    query: {
      buildSessionTimeline: vi.fn().mockReturnValue({
        sessionId: "x",
        totalRequests: 0,
        changes: [],
      }),
      buildSessionMetadata: vi.fn().mockReturnValue({
        sessionId: "x",
        tokenUsage: {
          inputMissTokens: 0,
          inputHitTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheHitRate: 0,
        },
        requestCount: 0,
        subSessions: [],
        parentSession: null,
        createdAt: null,
        updatedAt: null,
        latencyStats: null,
        durationStats: null,
      }),
    },
    transform: {
      sseAnthropicToMessages: vi.fn().mockReturnValue([]),
      sseOpenaiChatToMessages: vi.fn().mockReturnValue([]),
      sseOpenaiResponsesToMessages: vi.fn().mockReturnValue([]),
    },
    record: {
      initStateManager: vi.fn().mockResolvedValue(undefined),
      getGlobalTraceEnabled: vi.fn().mockReturnValue(false),
      setGlobalTraceEnabled: vi.fn(),
    },
    getTraceDir: vi.fn().mockReturnValue("/tmp/test-trace"),
  };
});

import { createViewer, type ViewerInstance } from "./server.js";
import {
  store,
  parse,
  transform,
  record,
  query,
  type TraceRecord,
} from "@opencode-trace/core";

function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  file?: { name: string; filename: string; contentType: string; content: Buffer },
): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(
      Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`),
    );
    parts.push(Buffer.from(`${value}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\n`));
    parts.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`,
      ),
    );
    parts.push(Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`));
    parts.push(file.content);
    parts.push(Buffer.from(`\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

const mockRecord: TraceRecord = {
  id: 1,
  purpose: "test",
  requestAt: "2024-01-01T00:00:00.000Z",
  responseAt: "2024-01-01T00:00:01.000Z",
  request: {
    method: "POST",
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "content-type": "application/json" },
    body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
  },
  response: {
    status: 200,
    statusText: "OK",
    headers: {},
    body: { choices: [{ message: { role: "assistant", content: "hello" } }] },
  },
  error: null,
  requestSentAt: 1000,
  firstTokenAt: 1100,
  lastTokenAt: 1200,
};

describe("createViewer (real integration)", () => {
  let testDir: string;
  let instance: ViewerInstance | null = null;

  function reapplyMocks(): void {
    vi.mocked(store.listSessionsFromBothDirs).mockReturnValue([]);
    vi.mocked(store.listSessionsTreeFromBothDirs).mockReturnValue([]);
    vi.mocked(store.getSessionRecords).mockReturnValue([]);
    vi.mocked(store.getRecord).mockReturnValue(null);
    vi.mocked(store.getSSEStream).mockReturnValue(null);
    vi.mocked(store.readTimelineIndex).mockReturnValue([]);
    vi.mocked(store.getCachedParsed).mockReturnValue(null);
    vi.mocked(store.readSessionMetadata).mockReturnValue(null);
    vi.mocked(store.exportSessionZip).mockResolvedValue(Buffer.from("PK"));
    vi.mocked(store.importSessionZip).mockResolvedValue({
      status: "success",
      importedSessions: [
        { sessionId: "x", requestCount: 0, strategy: "none" },
      ],
    });
    vi.mocked(store.deleteSession).mockResolvedValue(undefined);
    vi.mocked(parse.detectAndParse).mockReturnValue({
      provider: "openai-chat",
      model: "gpt-4",
      msgs: [],
      usage: null,
      stream: false,
    });
    vi.mocked(parse.detectProvider).mockReturnValue("openai-chat");
    vi.mocked(parse.extractUsage).mockReturnValue({
      inputMissTokens: 10,
      inputHitTokens: 0,
      outputTokens: 5,
    });
    vi.mocked(parse.extractLatency).mockReturnValue({
      requestSentAt: 1,
      firstTokenAt: 101,
      lastTokenAt: 201,
      ttft: 100,
      tpot: null,
      totalDuration: 200,
    });
    vi.mocked(parse.openaiChatParser.parseRequest).mockReturnValue({
      provider: "openai-chat",
      model: "gpt-4",
      msgs: [],
      usage: null,
      stream: false,
    });
    vi.mocked(parse.openaiResponsesParser.parseRequest).mockReturnValue({
      provider: "openai-responses",
      model: "gpt-4",
      msgs: [],
      usage: null,
      stream: false,
    });
    vi.mocked(parse.anthropicParser.parseRequest).mockReturnValue({
      provider: "anthropic",
      model: "claude-3",
      msgs: [],
      usage: null,
      stream: false,
    });
    vi.mocked(query.buildSessionTimeline).mockReturnValue({
      sessionId: "x",
      totalRequests: 0,
      changes: [],
    });
    vi.mocked(query.buildSessionMetadata).mockReturnValue({
      sessionId: "x",
      tokenUsage: {
        inputMissTokens: 0,
        inputHitTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheHitRate: 0,
      },
      requestCount: 0,
      subSessions: [],
      parentSession: null,
      createdAt: null,
      updatedAt: null,
      latencyStats: null,
      durationStats: null,
    });
    vi.mocked(transform.sseAnthropicToMessages).mockReturnValue([]);
    vi.mocked(transform.sseOpenaiChatToMessages).mockReturnValue([]);
    vi.mocked(transform.sseOpenaiResponsesToMessages).mockReturnValue([]);
    vi.mocked(record.getGlobalTraceEnabled).mockReturnValue(false);
  }

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "viewer-server-test-"));
    vi.clearAllMocks();
    reapplyMocks();
  });

  afterEach(async () => {
    if (instance) {
      await instance.close();
      instance = null;
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("GET /api/sessions", () => {
    it("returns the list from store", async () => {
      const mockSessions = [
        {
          id: "abc",
          requestCount: 1,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:01Z",
          scope: "global" as const,
        },
      ];
      vi.mocked(store.listSessionsFromBothDirs).mockReturnValue(mockSessions);
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockSessions);
    });
  });

  describe("GET /api/sessions/tree", () => {
    it("returns the tree from store", async () => {
      const mockTree = [
        {
          id: "abc",
          requestCount: 1,
          createdAt: null,
          updatedAt: null,
          scope: "global" as const,
          children: [],
        },
      ];
      vi.mocked(store.listSessionsTreeFromBothDirs).mockReturnValue(mockTree);
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/tree",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockTree);
    });
  });

  describe("GET /api/sessions/:sessionId/timeline", () => {
    it("returns timeline built from cached parsed entries", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.readTimelineIndex).mockReturnValue([
        {
          seq: 1,
          url: "https://api.openai.com/v1/chat/completions",
          method: "POST",
          purpose: "test",
          requestAt: "2024-01-01T00:00:00.000Z",
          responseAt: "2024-01-01T00:00:01.000Z",
          status: 200,
          provider: "openai-chat",
          model: "gpt-4",
          inputTokens: 10,
          outputTokens: 5,
          totalDurationMs: 200,
        },
      ]);
      vi.mocked(store.getCachedParsed).mockReturnValue({
        provider: "openai-chat",
        model: "gpt-4",
        msgs: [],
        usage: null,
        stream: false,
      });
      vi.mocked(query.buildSessionTimeline).mockReturnValue({
        sessionId: "abc",
        totalRequests: 1,
        changes: [],
      } as never);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/timeline",
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.sessionId).toBe("abc");
      expect(data.totalRequests).toBe(1);
    });

    it("falls back to full record parse when cache is empty", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.readTimelineIndex).mockReturnValue([
        {
          seq: 1,
          url: "https://api.openai.com/v1/chat/completions",
          method: "POST",
          purpose: "test",
          requestAt: "2024-01-01T00:00:00.000Z",
          responseAt: "2024-01-01T00:00:01.000Z",
          status: 200,
          provider: "openai-chat",
          model: "gpt-4",
          inputTokens: 10,
          outputTokens: 5,
          totalDurationMs: 200,
        },
      ]);
      vi.mocked(store.getCachedParsed).mockReturnValue(null);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/timeline",
      });
      expect(response.statusCode).toBe(200);
      expect(parse.detectAndParse).toHaveBeenCalled();
    });

    it("returns 404 when session not found", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/missing/timeline",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Session not found" });
    });

    it("returns 400 for invalid sessionId", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/has%20space/timeline",
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/sessions/:sessionId/metadata", () => {
    it("returns metadata when session exists", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.readTimelineIndex).mockReturnValue([
        {
          seq: 1,
          url: "https://api.openai.com/v1/chat/completions",
          method: "POST",
          purpose: "test",
          requestAt: "2024-01-01T00:00:00.000Z",
          responseAt: "2024-01-01T00:00:01.000Z",
          status: 200,
          provider: "openai-chat",
          model: "gpt-4",
          inputTokens: 10,
          outputTokens: 5,
          totalDurationMs: 200,
        },
      ]);
      vi.mocked(store.getCachedParsed).mockReturnValue({
        provider: "openai-chat",
        model: "gpt-4",
        msgs: [],
        usage: null,
        stream: false,
      });
      vi.mocked(query.buildSessionMetadata).mockReturnValue({
        sessionId: "abc",
        tokenUsage: {
          inputMissTokens: 0,
          inputHitTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheHitRate: 0,
        },
        requestCount: 1,
        subSessions: [],
        parentSession: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:01.000Z",
        latencyStats: null,
        durationStats: null,
      } as never);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/metadata",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().sessionId).toBe("abc");
    });

    it("returns 404 when session not found", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/missing/metadata",
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for invalid sessionId", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/bad!id/metadata",
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/sessions/:sessionId/records/:recordId/parsed", () => {
    it("returns cached parsed when available", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getCachedParsed).mockReturnValue({
        provider: "openai-chat",
        model: "gpt-4",
        msgs: [],
        usage: null,
        stream: false,
      });

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/parsed",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().provider).toBe("openai-chat");
      expect(store.getRecord).not.toHaveBeenCalled();
    });

    it("falls back to detectAndParse when no cache", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getCachedParsed).mockReturnValue(null);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/parsed",
      });
      expect(response.statusCode).toBe(200);
      expect(parse.detectAndParse).toHaveBeenCalled();
    });

    it("returns 404 when record not found", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(null);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/99/parsed",
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for invalid recordId", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/0/parsed",
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/sessions/:sessionId/records/:recordId/usage", () => {
    it("returns usage for a valid record", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/usage",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().outputTokens).toBe(5);
    });

    it("returns 404 when record not found", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(null);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/99/usage",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/sessions/:sessionId/records/:recordId/latency", () => {
    it("returns latency for a streaming record", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/latency",
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ttft).toBe(100);
      expect(data.totalDuration).toBe(200);
    });

    it("returns no-latency error when extractLatency returns null", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);
      vi.mocked(parse.extractLatency).mockReturnValue(null);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/latency",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ error: "No latency data available" });
    });

    it("returns 404 when record not found", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(null);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/99/latency",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/sessions/:sessionId/records/:recordId/sse", () => {
    it("returns raw + messages for an openai-chat record", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);
      vi.mocked(store.getSSEStream).mockReturnValue("data: hello\n\n");
      vi.mocked(parse.detectProvider).mockReturnValue("openai-chat");

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/sse",
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.raw).toBe("data: hello\n\n");
      expect(transform.sseOpenaiChatToMessages).toHaveBeenCalled();
    });

    it("uses sseAnthropicToMessages for anthropic provider", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);
      vi.mocked(store.getSSEStream).mockReturnValue("event: message_start\n\n");
      vi.mocked(parse.detectProvider).mockReturnValue("anthropic");

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/sse",
      });
      expect(transform.sseAnthropicToMessages).toHaveBeenCalled();
    });

    it("uses sseOpenaiResponsesToMessages for openai-responses provider", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);
      vi.mocked(store.getSSEStream).mockReturnValue("event: response.created\n\n");
      vi.mocked(parse.detectProvider).mockReturnValue("openai-responses");

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/sse",
      });
      expect(transform.sseOpenaiResponsesToMessages).toHaveBeenCalled();
    });

    it("returns 404 when no SSE data", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getSSEStream).mockReturnValue(null);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1/sse",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/sessions/:sessionId/records/:recordId", () => {
    it("returns the full record", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(mockRecord);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(1);
    });

    it("returns 404 when record not found", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.getRecord).mockReturnValue(null);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/99",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/sessions/:sessionId", () => {
    it("returns enriched session + records when session exists", async () => {
      const mockSession = {
        id: "abc",
        requestCount: 2,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:01Z",
        scope: "global" as const,
      };
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.listSessionsFromBothDirs).mockReturnValue([mockSession]);
      vi.mocked(store.getSessionRecords).mockReturnValue([mockRecord]);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc",
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.session.id).toBe("abc");
      expect(data.records).toHaveLength(1);
      expect(data.records[0].provider).toBe("openai-chat");
    });

    it("returns placeholder session meta when session meta missing", async () => {
      vi.mocked(store.listSessionsFromBothDirs).mockReturnValue([]);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc",
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.session.id).toBe("abc");
      expect(data.records).toEqual([]);
    });
  });

  describe("GET /api/trace/status", () => {
    it("returns globalEnabled flag", async () => {
      vi.mocked(record.getGlobalTraceEnabled).mockReturnValue(true);
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/trace/status",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ globalEnabled: true });
    });
  });

  describe("GET /api/trace/enable", () => {
    it("enables tracing and returns success", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/trace/enable",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, globalEnabled: true });
      expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, testDir);
    });
  });

  describe("GET /api/trace/disable", () => {
    it("disables tracing and returns success", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/trace/disable",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, globalEnabled: false });
      expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(false, testDir);
    });
  });

  describe("GET /api/trace-dir", () => {
    it("returns globalDir and localDir", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/trace-dir",
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.traceDir).toBe(testDir);
      expect(data.localDir).toBe(testDir);
    });
  });

  describe("GET /api/events (SSE)", () => {
    it("writes connected event with clientId on raw stream", async () => {
      const realInstance = await createViewer({
        port: 0,
        noListen: false,
        traceDir: testDir,
      });
      try {
        const addr = realInstance.app!.server.address();
        const port =
          typeof addr === "object" && addr ? addr.port : Number(realInstance.url.split(":").pop());
        const http = await import("node:http");
        const body = await new Promise<string>((resolve, reject) => {
          const req = http.request(
            {
              hostname: "127.0.0.1",
              port,
              path: "/api/events",
              method: "GET",
              headers: { Accept: "text/event-stream" },
            },
            (res) => {
              let data = "";
              res.on("data", (chunk: Buffer) => {
                data += chunk.toString("utf-8");
                if (data.includes("\n\n")) {
                  req.destroy();
                  resolve(data);
                }
              });
              res.on("error", () => resolve(data));
            },
          );
          req.on("error", (e) => reject(e));
          req.end();
          setTimeout(() => {
            req.destroy();
            reject(new Error("SSE timeout"));
          }, 3000);
        });
        expect(body).toContain("event: connected");
        expect(body).toMatch(/"clientId":"\d+"/);
      } finally {
        await realInstance.close();
      }
    });
  });

  describe("POST /api/sessions/:sessionId/export", () => {
    it("returns the ZIP buffer with proper content-type", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.exportSessionZip).mockResolvedValue(
        Buffer.from("PK\x03\x04hello"),
      );

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/abc/export",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/zip");
      expect(response.headers["content-disposition"]).toContain(
        'filename="session-abc.zip"',
      );
    });

    it("returns 404 when session not found", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/missing/export",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Session not found" });
    });

    it("returns 500 when export throws generic error", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);
      vi.mocked(store.exportSessionZip).mockRejectedValue(
        new Error("disk exploded"),
      );

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/abc/export",
      });
      expect(response.statusCode).toBe(500);
      expect(response.json().error).toContain("disk exploded");
    });
  });

  describe("POST /api/sessions/import", () => {
    it("imports a session with conflict strategy=rename", async () => {
      const boundary = "----formdata-test-1234";
      const file = Buffer.from("PK\x03\x04zip content");
      const body = buildMultipart(
        boundary,
        { conflictStrategy: "rename" },
        {
          name: "file",
          filename: "test.zip",
          contentType: "application/zip",
          content: file,
        },
      );

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/import",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("success");
      expect(store.importSessionZip).toHaveBeenCalledWith(
        file,
        expect.objectContaining({ conflictStrategy: "rename" }),
      );
    });

    it("returns 400 for invalid conflict strategy", async () => {
      const boundary = "----formdata-test-1234";
      const file = Buffer.from("PK\x03\x04zip content");
      const body = buildMultipart(
        boundary,
        { conflictStrategy: "bogus" },
        {
          name: "file",
          filename: "test.zip",
          contentType: "application/zip",
          content: file,
        },
      );

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/import",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when no file is provided", async () => {
      const boundary = "----formdata-test-1234";
      const body = buildMultipart(boundary, { conflictStrategy: "rename" });

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/import",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /api/sessions/:sessionId/delete", () => {
    it("deletes the session and returns success", async () => {
      vi.mocked(store.readSessionMetadata).mockReturnValue({
        sessionId: "abc",
      } as never);

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/abc/delete",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, sessionId: "abc" });
      expect(store.deleteSession).toHaveBeenCalledWith(
        "abc",
        expect.objectContaining({ traceDir: testDir }),
      );
    });

    it("returns 404 when session not found", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/missing/delete",
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 400 for invalid sessionId", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/bad%21id/delete",
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /api/sessions/batch-delete", () => {
    it("returns mixed success/failure for batch", async () => {
      vi.mocked(store.readSessionMetadata).mockImplementation(
        ((id: string) =>
          id === "exists" ? ({ sessionId: id } as never) : null) as never,
      );

      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/batch-delete",
        payload: { sessionIds: ["exists", "missing"] },
      });
      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.deleted).toEqual(["exists"]);
      expect(data.errors).toEqual([
        { sessionId: "missing", error: "Session not found" },
      ]);
    });

    it("returns 400 for empty array", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/batch-delete",
        payload: { sessionIds: [] },
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for missing body", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "POST",
        url: "/api/sessions/batch-delete",
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("setNotFoundHandler", () => {
    it("returns 404 JSON when public dir is not built", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/some/random/path",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Not found" });
    });
  });

  describe("validateSessionId (via 400 responses)", () => {
    it("rejects empty sessionId (in URL path)", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions//timeline",
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("rejects sessionId with special characters", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/foo%24bar/timeline",
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects sessionId with slash", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/foo%2Fbar/timeline",
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("rejects sessionId with non-alphanumeric special chars", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/foo!bar/timeline",
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects sessionId with hyphen at edge (still valid in regex)", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/valid-id-123/timeline",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Session not found" });
    });

    it("rejects sessionId with dot", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/foo.bar/timeline",
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("validateRecordId (via 400 responses)", () => {
    it("rejects recordId=0", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/0/latency",
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects negative recordId", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/-1/latency",
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("rejects non-numeric recordId", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/abc/latency",
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects recordId > 999999", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/1000000/latency",
      });
      expect(response.statusCode).toBe(400);
    });

    it("rejects recordId that is purely non-numeric", async () => {
      instance = await createViewer({
        port: 0,
        noListen: true,
        traceDir: testDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/abc/records/abc/latency",
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("findSessionTraceDir dual-dir resolution", () => {
    it("finds session in local dir when only local has metadata", async () => {
      const localDir = join(testDir, "local-trace");
      const globalDir = join(testDir, "global-trace");

      vi.mocked(store.readSessionMetadata)
        .mockImplementation(((sessionId: string, dir: string) => {
          if (dir === localDir && sessionId === "local-only-session") {
            return { title: "Local Session" } as never;
          }
          return null;
        }) as never);

      instance = await createViewer({
        port: 0,
        noListen: true,
        globalDir,
        localDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/local-only-session/timeline",
      });
      expect(response.statusCode).toBe(200);
    });

    it("finds session in global dir when only global has metadata", async () => {
      const localDir = join(testDir, "local-trace");
      const globalDir = join(testDir, "global-trace");

      vi.mocked(store.readSessionMetadata)
        .mockImplementation(((sessionId: string, dir: string) => {
          if (dir === globalDir && sessionId === "global-only-session") {
            return { title: "Global Session" } as never;
          }
          return null;
        }) as never);

      instance = await createViewer({
        port: 0,
        noListen: true,
        globalDir,
        localDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/global-only-session/timeline",
      });
      expect(response.statusCode).toBe(200);
    });

    it("returns 404 when session exists in neither dir", async () => {
      const localDir = join(testDir, "local-trace");
      const globalDir = join(testDir, "global-trace");

      vi.mocked(store.readSessionMetadata).mockReturnValue(null);
      vi.mocked(store.getSessionRecords).mockReturnValue([]);

      instance = await createViewer({
        port: 0,
        noListen: true,
        globalDir,
        localDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/nonexistent-session/timeline",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Session not found" });
    });

    it("prefers local dir over global when session exists in both", async () => {
      const localDir = join(testDir, "local-trace");
      const globalDir = join(testDir, "global-trace");

      vi.mocked(store.readSessionMetadata)
        .mockImplementation(((sessionId: string, dir: string) => {
          if (sessionId === "both-dir-session") {
            return { title: dir === localDir ? "Local" : "Global" } as never;
          }
          return null;
        }) as never);
      vi.mocked(store.readTimelineIndex).mockReturnValue([]);
      vi.mocked(store.getSessionRecords).mockReturnValue([]);

      instance = await createViewer({
        port: 0,
        noListen: true,
        globalDir,
        localDir,
      });

      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/both-dir-session",
      });
      expect(response.statusCode).toBe(200);

      const calls = vi.mocked(store.getSessionRecords).mock.calls;
      const usedDir = calls.length > 0 ? calls[calls.length - 1][1]?.traceDir : null;
      expect(usedDir).toBe(localDir);
    });

    it("finds session in local dir via records when metadata is null", async () => {
      const localDir = join(testDir, "local-trace");
      const globalDir = join(testDir, "global-trace");

      vi.mocked(store.readSessionMetadata).mockReturnValue(null);
      vi.mocked(store.getSessionRecords)
        .mockImplementation(((sessionId: string, opts?: any) => {
          if (opts?.traceDir === localDir && sessionId === "local-records-only") {
            return [mockRecord];
          }
          return [];
        }) as never);

      instance = await createViewer({
        port: 0,
        noListen: true,
        globalDir,
        localDir,
      });
      const response = await instance.app!.inject({
        method: "GET",
        url: "/api/sessions/local-records-only",
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
