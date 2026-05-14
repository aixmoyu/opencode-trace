import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { store, parse, type TraceRecord } from "@opencode-trace/core";
import { type ViewerInstance } from "./server.js";

function buildTestApp() {
  const app = Fastify({ logger: false });

  app.register(cors, { origin: "*" });
  app.register(multipart);

  app.get("/", async (_req, reply) => {
    reply.type("text/html; charset=utf-8").send("<html></html>");
  });

  app.get("/api/sessions", async (_req, reply) => {
    return store.listSessions();
  });

  app.get("/api/sessions/tree", async (_req, reply) => {
    return store.listSessionsTree();
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/timeline", async (req, reply) => {
    const { sessionId } = req.params;
    const records = store.getSessionRecords(sessionId);
    const parsedRecords = records.map((rec) => {
      const parsed = parse.detectAndParse(rec);
      const provider = parse.detectProvider(rec.request.url, rec.request.body);
      let requestMsgs = parsed.msgs;
      if (provider === "openai-chat") {
        requestMsgs = parse.openaiChatParser.parseRequest(rec.request.body).msgs;
      } else if (provider === "openai-responses") {
        requestMsgs = parse.openaiResponsesParser.parseRequest(rec.request.body).msgs;
      } else if (provider === "anthropic") {
        requestMsgs = parse.anthropicParser.parseRequest(rec.request.body).msgs;
      }
      return { id: rec.id, requestAt: rec.requestAt, requestMsgs, parsed };
    }).filter((c) => c.parsed.provider !== "unknown" || c.parsed.msgs.length > 0);
    const timeline = { messages: [], recordMeta: [] };
    return { ...timeline, recordMeta: parsedRecords.map((r) => ({ id: r.id, model: r.parsed.model, provider: r.parsed.provider })) };
  });

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/latency",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = parseInt(recordId, 10);
      const rec = store.getRecord(sessionId, rid);
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      const latency = parse.extractLatency(rec);
      return latency ?? { error: "No latency data available" };
    }
  );

  return app;
}

describe("Server API", () => {
  let server: ViewerInstance | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  describe("Latency endpoint", () => {
    it("should return latency info for stream requests", async () => {
      const mockRecord: TraceRecord = {
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

      vi.spyOn(store, "getRecord").mockReturnValue(mockRecord);

      const app = buildTestApp();
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/api/sessions/test/records/1/latency",
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.ttft).toBeDefined();
      expect(data.totalDuration).toBeDefined();
    });

    it("should return 404 for non-existent record", async () => {
      vi.spyOn(store, "getRecord").mockReturnValue(null);

      const app = buildTestApp();
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/api/sessions/test/records/999/latency",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
