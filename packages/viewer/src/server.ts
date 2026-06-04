import { readFileSync, readdirSync, existsSync, writeFileSync, promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import chokidar from "chokidar";
import {
  store,
  parse,
  query,
  transform,
  record,
  getTraceDir,
} from "@opencode-trace/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

function validateSessionId(sessionId: string): boolean {
  return (
    typeof sessionId === "string" &&
    sessionId.length > 0 &&
    sessionId.length <= 256 &&
    /^[a-zA-Z0-9_-]+$/.test(sessionId)
  );
}

function validateRecordId(recordId: string): { valid: boolean; value: number } {
  const num = parseInt(recordId, 10);
  return { valid: !isNaN(num) && num > 0 && num <= 999999, value: num };
}

function validateParams(
  reply: any,
  sessionId: string,
  recordId?: string,
): number | null {
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

interface SSEClient {
  id: string;
  reply: any;
}

export async function createViewer(
  options?: ViewerOptions,
): Promise<ViewerInstance> {
  const port = options?.port ?? 3210;
  const globalDir = options?.globalDir ?? options?.traceDir ?? getTraceDir();
  const localDir = options?.localDir ?? options?.traceDir;
  const bothDirsOpts = { globalDir, localDir };

  const sseClients = new Set<SSEClient>();

  // SSE keep-alive heartbeat — prevents proxies from closing idle connections
  const sseKeepAlive = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.reply.raw.write(": heartbeat\n\n");
      } catch {
        sseClients.delete(client);
      }
    }
  }, 15000);

  let clientIdCounter = 0;

  function broadcastSSE(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.reply.raw.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  function findSessionTraceDir(sessionId: string): string | null {
    if (localDir) {
      const localMeta = store.readSessionMetadata(sessionId, localDir);
      if (localMeta) return localDir;
      const localRecords = store.getSessionRecords(sessionId, {
        traceDir: localDir,
      });
      if (localRecords.length > 0) return localDir;
    }
    const globalMeta = store.readSessionMetadata(sessionId, globalDir);
    if (globalMeta) return globalDir;
    const globalRecords = store.getSessionRecords(sessionId, {
      traceDir: globalDir,
    });
    if (globalRecords.length > 0) return globalDir;
    return null;
  }

  function validateSessionAndFindDir(
    reply: any,
    sessionId: string,
  ): string | null {
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
      reply
        .type("text/html; charset=utf-8")
        .send(readFileSync(indexPath, "utf-8"));
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

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/timeline",
    async (req, reply) => {
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

      const timelineEntries = store.readTimelineIndex(sessionId, {
        traceDir: sessionTraceDir,
      });

      if (timelineEntries.length > 0) {
        // Build timeline records from ndjinx + parsed cache (same pattern as /metadata)
        // This avoids a full JSON scan + detectAndParse for every record.
        type TLConv = ReturnType<typeof parse.detectAndParse>;
        const timelineRecords: {
          id: number;
          requestAt?: string;
          parsed: TLConv;
        }[] = [];

        for (const entry of timelineEntries) {
          const cached = store.getCachedParsed(sessionId, entry.seq, {
            traceDir: sessionTraceDir,
          });
          if (cached) {
            timelineRecords.push({
              id: entry.seq,
              requestAt: entry.requestAt,
              parsed: cached as unknown as TLConv,
            });
          } else {
            const rec = store.getRecord(sessionId, entry.seq, {
              traceDir: sessionTraceDir,
            });
            if (rec) {
              const parsed = parse.detectAndParse(rec);
              timelineRecords.push({
                id: rec.id,
                requestAt: rec.requestAt,
                parsed,
              });
            }
          }
        }

        const timeline = query.buildSessionTimeline(
          sessionId,
          timelineRecords,
        );
        const recordMeta = timelineRecords.map((r) => ({
          id: r.id,
          model: r.parsed.model,
          provider: r.parsed.provider,
        }));
        return { ...timeline, recordMeta };
      }

      const records = store.getSessionRecords(sessionId, {
        traceDir: sessionTraceDir,
      });
      const parsedRecords = records
        .map((rec) => {
          const parsed = parse.detectAndParse(rec);
          const provider = parse.detectProvider(
            rec.request.url,
            rec.request.body,
          );
          let requestMsgs = parsed.msgs;

          if (provider === "openai-chat") {
            const reqParsed = parse.openaiChatParser.parseRequest(
              rec.request.body,
            );
            requestMsgs = reqParsed.msgs;
          } else if (provider === "openai-responses") {
            const reqParsed = parse.openaiResponsesParser.parseRequest(
              rec.request.body,
            );
            requestMsgs = reqParsed.msgs;
          } else if (provider === "anthropic") {
            const reqParsed = parse.anthropicParser.parseRequest(
              rec.request.body,
            );
            requestMsgs = reqParsed.msgs;
          }

          return {
            id: rec.id,
            requestAt: rec.requestAt,
            requestMsgs,
            parsed,
          };
        })
        .filter(
          (c) => c.parsed.provider !== "unknown" || c.parsed.msgs.length > 0,
        );

      // Fire-and-forget rebuild timeline.ndjson from full-parse results
      // so subsequent requests use the fast ndjson path
      const ndjsonSessionDir = join(sessionTraceDir, sessionId);
      const ndjsonLines: string[] = [];
      for (const rec of records) {
        try {
          ndjsonLines.push(JSON.stringify({
            seq: rec.id,
            url: rec.request.url,
            method: rec.request.method,
            purpose: rec.purpose,
            requestAt: rec.requestAt,
            responseAt: rec.responseAt,
            status: rec.response?.status ?? 0,
            provider: parse.detectProvider(rec.request.url, rec.request.body),
            model: null,
            inputTokens: null,
            outputTokens: null,
            totalDurationMs: null,
          }));
        } catch {
          // skip records that can't be serialized
        }
      }
      setImmediate(async () => {
        try {
          if (ndjsonLines.length > 0) {
            await fs.writeFile(join(ndjsonSessionDir, "timeline.ndjson"), ndjsonLines.join("\n") + "\n");
          }
        } catch {
          // rebuild is optional
        }
      });
      const timeline = query.buildSessionTimeline(sessionId, parsedRecords);
      const recordMeta = parsedRecords.map((r) => ({
        id: r.id,
        model: r.parsed.model,
        provider: r.parsed.provider,
      }));
      return { ...timeline, recordMeta };
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/metadata",
    async (req, reply) => {
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

      // Read timeline.ndjson for record list + basic timing data
      const timelineEntries = store.readTimelineIndex(sessionId, {
        traceDir: sessionTraceDir,
      });

      type MetaConversation = ReturnType<typeof parse.detectAndParse>;
      interface MetaRecord {
        id: number;
        record?: import("@opencode-trace/core").TraceRecord;
        parsed: MetaConversation;
      }
      const metaRecords: MetaRecord[] = [];

      if (timelineEntries.length > 0) {
        // Use ndjson + parsed cache — no full JSON scan + parse
        for (const entry of timelineEntries) {
          const cached = store.getCachedParsed(sessionId, entry.seq, {
            traceDir: sessionTraceDir,
          });
          if (cached) {
            metaRecords.push({
              id: entry.seq,
              record: undefined,
              parsed: cached as unknown as MetaConversation,
            });
          } else {
            const rec = store.getRecord(sessionId, entry.seq, {
              traceDir: sessionTraceDir,
            });
            if (rec) {
              const parsed = parse.detectAndParse(rec);
              metaRecords.push({ id: entry.seq, record: rec, parsed });
            }
          }
        }
      } else {
        // No ndjson — full fallback (legacy sessions before this upgrade)
        const records = store.getSessionRecords(sessionId, {
          traceDir: sessionTraceDir,
        });
        for (const rec of records) {
          const parsed = parse.detectAndParse(rec);
          metaRecords.push({ id: rec.id, record: rec, parsed });
        }
      }

      const filtered = metaRecords.filter(
        (r) => r.parsed.provider !== "unknown" || r.parsed.msgs.length > 0,
      );

      const sessions = store.listSessionsFromBothDirs(bothDirsOpts);
      const sessionMeta = sessions.find((s) => s.id === sessionId);

      const tree = store.listSessionsTreeFromBothDirs(bothDirsOpts);
      const node = tree.find((n) => n.id === sessionId);

      const metadata = query.buildSessionMetadata(
        sessionId,
        filtered,
        sessionMeta?.folderPath,
      );

      if (sessionMeta) {
        metadata.createdAt = sessionMeta.createdAt;
        metadata.updatedAt = sessionMeta.updatedAt;
        metadata.subSessions = node?.children?.map((c) => c.id) ?? [];
        metadata.parentSession = sessionMeta.parentID ?? null;
      }

      return metadata;
    },
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/parsed",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;

      const cached = store.getCachedParsed(sessionId, rid, {
        traceDir: sessionTraceDir,
      });
      if (cached) return cached;

      const rec = store.getRecord(sessionId, rid, {
        traceDir: sessionTraceDir,
      });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      const parsed = parse.detectAndParse(rec);
      return parsed;
    },
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/usage",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const rec = store.getRecord(sessionId, rid, {
        traceDir: sessionTraceDir,
      });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      const usage = parse.extractUsage(rec);
      return usage;
    },
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/latency",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const rec = store.getRecord(sessionId, rid, {
        traceDir: sessionTraceDir,
      });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      const latency = parse.extractLatency(rec);
      return latency ?? { error: "No latency data available" };
    },
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId/sse",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const sseData = store.getSSEStream(sessionId, rid, {
        traceDir: sessionTraceDir,
      });
      if (!sseData) {
        reply.code(404);
        return { error: "No SSE data found" };
      }
      const rec = store.getRecord(sessionId, rid, {
        traceDir: sessionTraceDir,
      });
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
    },
  );

  app.get<{ Params: { sessionId: string; recordId: string } }>(
    "/api/sessions/:sessionId/records/:recordId",
    async (req, reply) => {
      const { sessionId, recordId } = req.params;
      const rid = validateParams(reply, sessionId, recordId);
      if (rid === null) return;
      const sessionTraceDir = validateSessionAndFindDir(reply, sessionId);
      if (sessionTraceDir === null) return;
      const rec = store.getRecord(sessionId, rid, {
        traceDir: sessionTraceDir,
      });
      if (!rec) {
        reply.code(404);
        return { error: "Record not found" };
      }
      return rec;
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId",
    async (req, reply) => {
      const { sessionId } = req.params;
      if (!validateSessionId(sessionId)) {
        reply.code(400);
        return { error: "Invalid session ID format" };
      }
      const sessionTraceDir = findSessionTraceDir(sessionId);
      const sessions = store.listSessionsFromBothDirs(bothDirsOpts);
      const sessionMeta = sessions.find((s) => s.id === sessionId);
      const records = sessionTraceDir
        ? store.getSessionRecords(sessionId, { traceDir: sessionTraceDir })
        : [];
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
    },
  );

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

  app.get("/api/events", async (req, reply) => {
    const clientId = String(++clientIdCounter);
    const client: SSEClient = { id: clientId, reply };

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    reply.raw.write(`event: connected\ndata: {"clientId":"${clientId}"}\n\n`);

    sseClients.add(client);


    req.raw.on("close", () => {
      sseClients.delete(client);
    });
  });

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/export",
    async (req, reply) => {
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
        const buffer = await store.exportSessionZip(sessionId, {
          traceDir: sessionTraceDir,
        });

        reply
          .type("application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="session-${sessionId}.zip"`,
          )
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
    },
  );

  app.post("/api/sessions/import", async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) {
        reply.code(400);
        return { error: "No file in multipart data" };
      }

      const fileBuffer = await data.toBuffer();
      const conflictStrategy =
        (data.fields.conflictStrategy as { value: string })?.value ?? "prompt";

      const validStrategies = ["prompt", "rename", "skip", "overwrite"];
      if (!validStrategies.includes(conflictStrategy)) {
        reply.code(400);
        return {
          error: `Invalid conflict strategy: ${conflictStrategy}. Valid: ${validStrategies.join(", ")}`,
        };
      }

      const result = await store.importSessionZip(fileBuffer, {
        traceDir: globalDir,
        conflictStrategy: conflictStrategy as
          | "prompt"
          | "rename"
          | "skip"
          | "overwrite",
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

  app.post<{ Params: { sessionId: string } }>(
    "/api/sessions/:sessionId/delete",
    async (req, reply) => {
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
    },
  );

  app.post("/api/sessions/batch-delete", async (req, reply) => {
    try {
      const body = req.body as { sessionIds?: string[] };
      if (
        !body ||
        !Array.isArray(body.sessionIds) ||
        body.sessionIds.length === 0
      ) {
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

  const watchDirs = [globalDir];
  if (localDir && localDir !== globalDir) {
    watchDirs.push(localDir);
  }

  const watcher = chokidar.watch(watchDirs, {
    ignored: /(\.tmp$|\.parsed$)/,
    persistent: true,
    ignoreInitial: true,
    depth: 2,
  });

  watcher.on("add", (filePath) => {
    const match = filePath.match(/\/([^/]+)\/(\d+)\.json$/);
    if (match) {
      const sessionId = match[1];
      const seq = parseInt(match[2], 10);
      broadcastSSE("record:added", { sessionId, seq });
    }
  });

  watcher.on("change", (filePath) => {
    const match = filePath.match(/\/([^/]+)\/(\d+)\.json$/);
    if (match) {
      const sessionId = match[1];
      const seq = parseInt(match[2], 10);
      broadcastSSE("record:updated", { sessionId, seq });
    }
  });

  watcher.on("unlink", (filePath) => {
    const match = filePath.match(/\/([^/]+)\/(\d+)\.json$/);
    if (match) {
      const sessionId = match[1];
      const seq = parseInt(match[2], 10);

      // Clean up the ndjinx entry so the timeline fast path doesn't show ghost
      // records pointing to deleted JSON files.
      const sessionDir = dirname(filePath);
      const ndjinxPath = join(sessionDir, "timeline.ndjinx");
      try {
        if (existsSync(ndjinxPath)) {
          const raw = readFileSync(ndjinxPath, "utf-8");
          const lines = raw
            .split("\n")
            .filter((l) => {
              if (!l.trim()) return false;
              try {
                return JSON.parse(l).seq !== seq;
              } catch {
                return false;
              }
            });
          writeFileSync(ndjinxPath, lines.join("\n") + "\n");
        }
      } catch {
        // ndjinx cleanup is best-effort
      }

      broadcastSSE("record:deleted", { sessionId, seq });
    }
  });

  watcher.on("addDir", (dirPath) => {
    const match = dirPath.match(/\/([^/]+)$/);
    if (match) {
      const sessionId = match[1];
      // Validate it's a real session dir (has at least one JSON file or metadata)
      if (/^\d+\.json$/.test(sessionId)) return; // not a session dir (it's a record number match)
      try {
        const files = readdirSync(dirPath);
        const hasRecord = files.some((f) => /^\d+\.json$/.test(f));
        const hasMeta = files.some((f) => f === "metadata.json");
        if (hasRecord || hasMeta) {
          broadcastSSE("session:created", { sessionId });
        }
      } catch {
        // best-effort validation
      }
    }
  });

  watcher.on("unlinkDir", (dirPath) => {
    const match = dirPath.match(/\/([^/]+)$/);
    if (match) {
      const sessionId = match[1];
      broadcastSSE("session:deleted", { sessionId });
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
    close: async () => {
      clearInterval(sseKeepAlive);
      await watcher.close();
      await app.close();
    },
  };
}
