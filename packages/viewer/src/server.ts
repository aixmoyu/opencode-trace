import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { store, parse, query, transform, record, getTraceDir } from "@opencode-trace/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

function validateSessionId(sessionId: string): boolean {
  return typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= 256 && /^[a-zA-Z0-9_-]+$/.test(sessionId);
}

function validateRecordId(recordId: string): { valid: boolean; value: number } {
  const num = parseInt(recordId, 10);
  return { valid: !isNaN(num) && num > 0 && num <= 999999, value: num };
}

function validateParams(reply: any, sessionId: string, recordId?: string): number | null {
  if (!validateSessionId(sessionId)) {
    reply.code(400);
    reply.send({ error: "Invalid session ID format" });
    return null;
  }
  if (recordId !== undefined) {
    const result = validateRecordId(recordId);
    if (!result.valid) {
      reply.code(400);
      reply.send({ error: "Invalid record ID format" });
      return null;
    }
    return result.value;
  }
  return 0;
}

export interface ViewerOptions {
  port?: number;
  traceDir?: string;
  globalDir?: string;
  localDir?: string;
  open?: boolean;
  corsOrigin?: string | string[] | RegExp | boolean;
}

export interface ViewerInstance {
  url: string;
  close: () => Promise<void>;
}

export async function createViewer(options?: ViewerOptions): Promise<ViewerInstance> {
  const port = options?.port ?? 3210;
  const globalDir = options?.globalDir ?? options?.traceDir ?? getTraceDir();
  const localDir = options?.localDir ?? options?.traceDir;
  const bothDirsOpts = { globalDir, localDir };

  function findSessionTraceDir(sessionId: string): string | null {
    if (localDir) {
      const localMeta = store.readSessionMetadata(sessionId, localDir);
      if (localMeta) return localDir;
      const localRecords = store.getSessionRecords(sessionId, { traceDir: localDir });
      if (localRecords.length > 0) return localDir;
    }
    const globalMeta = store.readSessionMetadata(sessionId, globalDir);
    if (globalMeta) return globalDir;
    const globalRecords = store.getSessionRecords(sessionId, { traceDir: globalDir });
    if (globalRecords.length > 0) return globalDir;
    return null;
  }

  function validateSessionAndFindDir(reply: any, sessionId: string): string | null {
    if (!validateSessionId(sessionId)) {
      reply.code(400);
      reply.send({ error: "Invalid session ID format" });
      return null;
    }
    const sessionTraceDir = findSessionTraceDir(sessionId);
    if (!sessionTraceDir) {
      reply.code(404);
      reply.send({ error: "Session not found" });
      return null;
    }
    return sessionTraceDir;
  }

  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: options?.corsOrigin ?? [/^https?:\/\/localhost(:\d+)?$/],
  });
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: "1 minute",
    allowList: ["127.0.0.1", "::1"],
  });
  await app.register(multipart);

  const publicDir = join(__dirname, "public");
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
    });
  }

  app.setNotFoundHandler(async (_req, reply) => {
    const indexPath = join(publicDir, "index.html");
    if (existsSync(indexPath)) {
      reply.type("text/html; charset=utf-8").send(readFileSync(indexPath, "utf-8"));
    } else {
      reply.code(404).send({ error: "Not found" });
    }
  });

  app.get("/api/sessions", async (_req, reply) => {
    const sessions = store.listSessionsFromBothDirs(bothDirsOpts);
    return sessions;
  });

  app.get("/api/sessions/tree", async (_req, reply) => {
    const tree = store.listSessionsTreeFromBothDirs(bothDirsOpts);
    return tree;
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/timeline", async (req, reply) => {
    const { sessionId } = req.params;
    if (!validateSessionId(sessionId)) {
      reply.code(400);
      return { error: "Invalid session ID format" };
    }
    const sessionTraceDir = findSessionTraceDir(sessionId);
    if (!sessionTraceDir) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const records = store.getSessionRecords(sessionId, { traceDir: sessionTraceDir });
    const parsedRecords = records
      .map((rec) => {
        const parsed = parse.detectAndParse(rec);
        const provider = parse.detectProvider(rec.request.url, rec.request.body);
        let requestMsgs = parsed.msgs;

        if (provider === "openai-chat") {
          const reqParsed = parse.openaiChatParser.parseRequest(rec.request.body);
          requestMsgs = reqParsed.msgs;
        } else if (provider === "openai-responses") {
          const reqParsed = parse.openaiResponsesParser.parseRequest(rec.request.body);
          requestMsgs = reqParsed.msgs;
        } else if (provider === "anthropic") {
          const reqParsed = parse.anthropicParser.parseRequest(rec.request.body);
          requestMsgs = reqParsed.msgs;
        }

        return {
          id: rec.id,
          requestAt: rec.requestAt,
          requestMsgs,
          parsed,
        };
      })
      .filter((c) => c.parsed.provider !== "unknown" || c.parsed.msgs.length > 0);
    const timeline = query.buildSessionTimeline(sessionId, parsedRecords);
    const recordMeta = parsedRecords.map((r) => ({
      id: r.id,
      model: r.parsed.model,
      provider: r.parsed.provider,
    }));
    return { ...timeline, recordMeta };
  });

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/metadata", async (req, reply) => {
    const { sessionId } = req.params;
    if (!validateSessionId(sessionId)) {
      reply.code(400);
      return { error: "Invalid session ID format" };
    }
    const sessionTraceDir = findSessionTraceDir(sessionId);
    if (!sessionTraceDir) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const records = store.getSessionRecords(sessionId, { traceDir: sessionTraceDir });
    const parsedRecords = records
      .map((rec) => ({
        id: rec.id,
        record: rec,
        parsed: parse.detectAndParse(rec),
      }))
      .filter((c) => c.parsed.provider !== "unknown" || c.parsed.msgs.length > 0);

    const sessions = store.listSessionsFromBothDirs(bothDirsOpts);
    const sessionMeta = sessions.find((s) => s.id === sessionId);

    const tree = store.listSessionsTreeFromBothDirs(bothDirsOpts);
    const node = tree.find((n) => n.id === sessionId);

    const metadata = query.buildSessionMetadata(
      sessionId,
      parsedRecords,
      sessionMeta?.folderPath
    );

    if (sessionMeta) {
      metadata.createdAt = sessionMeta.createdAt;
      metadata.updatedAt = sessionMeta.updatedAt;
      metadata.subSessions = node?.children?.map(c => c.id) ?? [];
      metadata.parentSession = sessionMeta.parentID ?? null;
    }

    return metadata;
  });

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/parsed",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const rec = store.getRecord(sessionId, rid, { traceDir: sessionTraceDir });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      const parsed = parse.detectAndParse(rec);
      return parsed;
    }
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/usage",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const rec = store.getRecord(sessionId, rid, { traceDir: sessionTraceDir });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      const usage = parse.extractUsage(rec);
      return usage;
    }
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/latency",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const rec = store.getRecord(sessionId, rid, { traceDir: sessionTraceDir });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      const latency = parse.extractLatency(rec);
      return latency ?? { error: "No latency data available" };
    }
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/sse",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const sseData = store.getSSEStream(sessionId, rid, { traceDir: sessionTraceDir });
      if (!sseData) {
        reply.code(404);
        return { error: "No SSE data found" };
      }
      const rec = store.getRecord(sessionId, rid, { traceDir: sessionTraceDir });
      const provider = rec?.request
        ? parse.detectProvider(rec.request.url, rec.request.body)
        : null;
      let messages;
      if (provider === "anthropic") {
        messages = transform.sseAnthropicToMessages(sseData);
      } else if (provider === "openai-responses") {
        messages = transform.sseOpenaiResponsesToMessages(sseData);
      } else {
        messages = transform.sseOpenaiChatToMessages(sseData);
      }
      return { raw: sseData, messages };
    }
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const rec = store.getRecord(sessionId, rid, { traceDir: sessionTraceDir });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      return rec;
    }
  );

  app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params;
    if (!validateSessionId(sessionId)) {
      reply.code(400);
      return { error: "Invalid session ID format" };
    }
    const sessionTraceDir = findSessionTraceDir(sessionId);
    const sessions = store.listSessionsFromBothDirs(bothDirsOpts);
    const sessionMeta = sessions.find((s) => s.id === sessionId);
    const records = sessionTraceDir ? store.getSessionRecords(sessionId, { traceDir: sessionTraceDir }) : [];
    const enriched = records.map((rec) => ({
      ...rec,
      provider: rec?.request
        ? parse.detectProvider(rec.request.url, rec.request.body)
        : null,
    }));
    return {
      session:
        sessionMeta ??
        ({
          id: sessionId,
          requestCount: records.length,
          createdAt: null,
          updatedAt: null,
        } as store.SessionMeta),
      records: enriched,
    };
  });

  app.get("/api/trace/status", async (_req, reply) => {
    const enabled = record.getGlobalTraceEnabled(globalDir);
    return { globalEnabled: enabled };
  });

  app.get("/api/trace/enable", async (_req, reply) => {
    record.setGlobalTraceEnabled(true, globalDir);
    return { success: true, globalEnabled: true };
  });

  app.get("/api/trace/disable", async (_req, reply) => {
    record.setGlobalTraceEnabled(false, globalDir);
    return { success: true, globalEnabled: false };
  });

  app.get("/api/trace-dir", async (_req, reply) => {
    return { traceDir: globalDir, localDir };
  });

  app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/export", async (req, reply) => {
    try {
      const { sessionId } = req.params;
      if (!validateSessionId(sessionId)) {
        reply.code(400);
        return { error: "Invalid session ID format" };
      }
      const sessionTraceDir = findSessionTraceDir(sessionId);
      if (!sessionTraceDir) {
        reply.code(404);
        return { error: "Session not found" };
      }
      const buffer = await store.exportSessionZip(sessionId, { traceDir: sessionTraceDir });

      reply
        .type("application/zip")
        .header("Content-Disposition", `attachment; filename="session-${sessionId}.zip"`)
        .send(buffer);
    } catch (e) {
      const err = e as Error;
      if (err.message === "Session not found") {
        reply.code(404);
        return { error: "Session not found" };
      }
      reply.code(500);
      return { error: "Export failed: " + err.message };
    }
  });

  app.post("/api/sessions/import", async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) {
        reply.code(400);
        return { error: "No file in multipart data" };
      }

      const fileBuffer = await data.toBuffer();
      const conflictStrategy = (data.fields.conflictStrategy as { value: string })?.value ?? "prompt";

      const validStrategies = ["prompt", "rename", "skip", "overwrite"];
      if (!validStrategies.includes(conflictStrategy)) {
        reply.code(400);
        return { error: `Invalid conflict strategy: ${conflictStrategy}. Valid: ${validStrategies.join(", ")}` };
      }

      const result = await store.importSessionZip(fileBuffer, {
        traceDir: globalDir,
        conflictStrategy: conflictStrategy as "prompt" | "rename" | "skip" | "overwrite",
      });

      return result;
    } catch (e) {
      const err = e as Error;
      if (err.message.includes("Invalid") || err.message.includes("No file")) {
        reply.code(400);
        return { error: err.message };
      }
      reply.code(500);
      return { error: "Import failed: " + err.message };
    }
  });

  app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/delete", async (req, reply) => {
    try {
      const { sessionId } = req.params;
      if (!validateSessionId(sessionId)) {
        reply.code(400);
        return { error: "Invalid session ID format" };
      }
      const sessionTraceDir = findSessionTraceDir(sessionId);
      if (!sessionTraceDir) {
        reply.code(404);
        return { error: "Session not found" };
      }
      await store.deleteSession(sessionId, { traceDir: sessionTraceDir });
      return { success: true, sessionId };
    } catch (e) {
      const err = e as Error;
      reply.code(500);
      return { error: "Delete failed: " + err.message };
    }
  });

  app.post("/api/sessions/batch-delete", async (req, reply) => {
    try {
      const body = req.body as { sessionIds?: string[] };
      if (!body || !Array.isArray(body.sessionIds) || body.sessionIds.length === 0) {
        reply.code(400);
        return { error: "sessionIds must be a non-empty array" };
      }
      const deleted: string[] = [];
      const errors: { sessionId: string; error: string }[] = [];
      for (const sessionId of body.sessionIds) {
        try {
          const sessionTraceDir = findSessionTraceDir(sessionId);
          if (sessionTraceDir) {
            await store.deleteSession(sessionId, { traceDir: sessionTraceDir });
            deleted.push(sessionId);
          } else {
            errors.push({ sessionId, error: "Session not found" });
          }
        } catch (e) {
          errors.push({ sessionId, error: (e as Error).message });
        }
      }
      return { success: true, deleted, errors };
    } catch (e) {
      reply.code(500);
      return { error: "Batch delete failed: " + (e as Error).message };
    }
  });

  await app.listen({ port, host: "0.0.0.0" });

  const addr = `http://localhost:${port}`;

  if (options?.open) {
    import("node:child_process").then(({ exec }) => {
      const cmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      exec(`${cmd} ${addr}`);
    });
  }

  return {
    url: addr,
    close: () => app.close(),
  };
}
