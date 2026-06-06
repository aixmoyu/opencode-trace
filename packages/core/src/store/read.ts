import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { getTraceDir as getDefaultTraceDir } from "../paths.js";
import type { TraceRecord } from "../types.js";
import { ConfigManager, getConfigManager, hasConfigManager } from "../state/index.js";
import { TraceRecordSchema } from "../schemas/types.js";
import { SessionMetadataFileSchema } from "../schemas/store-types.js";
import { PARSED_CACHE_VERSION } from "../parse/index.js";
import { logger } from "../logger.js";

export interface StoreOptions {
  traceDir?: string;
}

export interface BothDirsOptions {
  globalDir: string;
  localDir?: string;
}

export function resolveDir(options?: StoreOptions): string {
  return options?.traceDir ?? getDefaultTraceDir();
}

export interface SessionMeta {
  id: string;
  requestCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  title?: string;
  parentID?: string;
  subSessions?: string[];
  folderPath?: string;
  scope?: "global" | "local";
}

export interface SessionMetaWithScope extends SessionMeta {
  scope: "global" | "local";
}

export interface SessionTreeNodeWithScope extends SessionMetaWithScope {
  children: SessionMetaWithScope[];
}

export interface SessionTreeNode extends SessionMeta {
  children: SessionMeta[];
}

export interface TimelineEntry {
  seq: number;
  url: string;
  method: string;
  purpose: string;
  requestAt: string;
  responseAt: string | null;
  status: number;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalDurationMs: number | null;
}

export interface SessionMetadataFile {
  sessionId: string;
  title?: string;
  enabled?: boolean;
  parentID?: string;
  subSessions?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code;
    if (errCode === "ENOENT") {
      logger.warn("Trace directory does not exist", { dir });
    } else {
      logger.error("Failed to read directory", { dir, error: String(err) });
    }
    return [];
  }
}

function safeReaddirWithTypes(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code;
    if (errCode === "ENOENT") {
      logger.warn("Trace directory does not exist", { dir });
    } else {
      logger.error("Failed to read directory", { dir, error: String(err) });
    }
    return [];
  }
}

function getManagerSync(traceDir: string): ConfigManager | null {
  return hasConfigManager(traceDir) ? getConfigManager(traceDir) : null;
}

function sessionStateToMeta(session: import("../state/index.js").SessionState): SessionMeta {
  return {
    id: session.id,
    requestCount: session.requestCount,
    createdAt: session.startedAt,
    updatedAt: session.endedAt,
    title: session.title,
    parentID: session.parentID,
    subSessions: session.subSessions,
    folderPath: session.folderPath,
  };
}

export function listSessions(options?: StoreOptions): SessionMeta[] {
  const base = resolveDir(options);
  const manager = getManagerSync(base);

  if (manager) {
    return manager.listSessions().map(sessionStateToMeta);
  }

  const entries = safeReaddirWithTypes(base);
  const sessions: SessionMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(base, entry.name);
      try {

        let title: string | undefined;
        let parentID: string | undefined;
        let folderPath: string | undefined;
        try {
          const metaPath = join(full, "metadata.json");
          const metaRaw = readFileSync(metaPath, "utf-8");
          const meta = JSON.parse(metaRaw) as {
            title?: string;
            parentID?: string;
            folderPath?: string;
          };
          title = meta.title;
          parentID = meta.parentID;
          folderPath = meta.folderPath;
        } catch {
          // no metadata, that's ok
        }

        // Fast path: read timing from timeline.ndjson
        let createdAt: string | null = null;
        let updatedAt: string | null = null;
        let requestCount = 0;
        let usedNdjson = false;

        const ndjsonPath = join(full, "timeline.ndjson");
        if (existsSync(ndjsonPath)) {
          try {
            const raw = readFileSync(ndjsonPath, "utf-8");
            const lines = raw.split("\n").filter((l) => l.trim());
            if (lines.length > 0) {
              requestCount = lines.length;
              usedNdjson = true;
              let lastResponseAt: string | null = null;
              for (const line of lines) {
                try {
                  const entry = JSON.parse(line) as { requestAt?: string; responseAt?: string | null };
                  if (entry.requestAt && (!createdAt || entry.requestAt < createdAt)) {
                    createdAt = entry.requestAt;
                  }
                  if (entry.responseAt && (!lastResponseAt || entry.responseAt > lastResponseAt)) {
                    lastResponseAt = entry.responseAt;
                  }
                } catch {
                  // skip malformed line
                }
              }
              updatedAt = lastResponseAt;
            }
          } catch {
            // ndjson unreadable, fall through to JSON file scan
          }
        }

        // Fall back to scanning JSON files when ndjson unavailable
        if (!usedNdjson) {
          const files = safeReaddir(full).filter(
            (f) => /^\d+\.json$/.test(f),
          );
          if (files.length === 0 && !title) continue;
          requestCount = files.length;

          for (const f of files) {
            try {
              const raw = readFileSync(join(full, f), "utf-8");
              const rec: TraceRecord = JSON.parse(raw);
              if (!createdAt || rec.requestAt < createdAt) createdAt = rec.requestAt;
              if (!updatedAt || rec.responseAt > updatedAt) updatedAt = rec.responseAt;
            } catch (err) {
              logger.error("Failed to read record file for session listing", {
                sessionDir: full,
                file: f,
                error: String(err),
              });
            }
          }
        }

        sessions.push({
          id: entry.name,
          requestCount,
          createdAt,
          updatedAt,
          title,
          parentID,
          folderPath,
        });

    } catch (err) {
      logger.error("Failed to process session entry for listing", {
        entry: entry.name,
        traceDir: base,
        error: String(err),
      });
    }
  }

  return sessions.sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
}

export function listSessionsTree(options?: StoreOptions): SessionTreeNode[] {
  const sessions = listSessions(options);
  const tree: SessionTreeNode[] = [];

  for (const session of sessions) {
    if (!session.parentID) {
      const node: SessionTreeNode = {
        ...session,
        children: sessions.filter((s) => s.parentID === session.id),
      };
      tree.push(node);
    }
  }

  return tree.sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
}

export function getSessionRecords(
  sessionId: string,
  options?: StoreOptions,
): TraceRecord[] {
  const sessionDir = join(resolveDir(options), sessionId);
  if (!existsSync(sessionDir)) return [];

  const files = safeReaddir(sessionDir)
    .filter((f) => /^\d+\.json$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      return na - nb;
    });

  const records: TraceRecord[] = [];
  for (const f of files) {
    try {
      const raw = readFileSync(join(sessionDir, f), "utf-8");
      const parsed = TraceRecordSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        records.push(parsed.data);
      }
    } catch (err) {
      logger.error("Failed to read session record", {
        sessionId,
        file: f,
        error: String(err),
      });
    }
  }
  return records;
}

export function getRecord(
  sessionId: string,
  recordId: number,
  options?: StoreOptions,
): TraceRecord | null {
  const filePath = join(resolveDir(options), sessionId, `${recordId}.json`);
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = TraceRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    logger.error("Failed to read record", {
      sessionId,
      recordId,
      filePath,
      error: String(err),
    });
    return null;
  }
}

export function getSSEStream(
  sessionId: string,
  recordId: number,
  options?: StoreOptions,
): string | null {
  const filePath = join(resolveDir(options), sessionId, `${recordId}.sse`);
  try {
    return readFileSync(filePath, "utf-8");
  } catch (err) {
    logger.error("Failed to read SSE stream", {
      sessionId,
      recordId,
      filePath,
      error: String(err),
    });
    return null;
  }
}

export function getTraceDir(options?: StoreOptions): string {
  return resolveDir(options);
}

export function readTimelineIndex(
  sessionId: string,
  options?: StoreOptions,
): TimelineEntry[] {
  const sessionDir = join(resolveDir(options), sessionId);
  const indexPath = join(sessionDir, "timeline.ndjson");
  if (!existsSync(indexPath)) return [];

  const entries: TimelineEntry[] = [];
  try {
    const raw = readFileSync(indexPath, "utf-8");
    const lines = raw.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as TimelineEntry;
        entries.push(entry);
      } catch {
        // skip malformed lines
      }
    }
  } catch (err) {
    logger.error("Failed to read timeline index", {
      sessionId,
      indexPath,
      error: String(err),
    });
  }
  return entries;
}

export function getCachedParsed(
  sessionId: string,
  seq: number,
  options?: StoreOptions,
): Record<string, unknown> | null {
  const sessionDir = join(resolveDir(options), sessionId);
  const cachePath = join(sessionDir, `${seq}.parsed`);
  if (!existsSync(cachePath)) return null;

  try {
    const jsonPath = join(sessionDir, `${seq}.json`);
    if (existsSync(jsonPath)) {
      const cacheStat = statSync(cachePath);
      const jsonStat = statSync(jsonPath);
      if (cacheStat.mtimeMs < jsonStat.mtimeMs) {
        return null;
      }
    }

    const raw = readFileSync(cachePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    // Version check: reject cache from an incompatible parser version
    if (data._pcv !== PARSED_CACHE_VERSION) return null;

    // Strip the internal version marker before returning
    const { _pcv: _, ...clean } = data;
    return clean;
  } catch (err) {
    logger.error("Failed to read parsed cache", {
      sessionId,
      seq,
      cachePath,
      error: String(err),
    });
    return null;
  }
}

export function readSessionMetadata(
  sessionId: string,
  traceDir: string,
): SessionMetadataFile | null {
  const sessionDir = join(traceDir, sessionId);
  const metadataPath = join(sessionDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    return null;
  }
  try {
    const content = readFileSync(metadataPath, "utf-8");
    const parsed = SessionMetadataFileSchema.safeParse(JSON.parse(content));
    if (parsed.success) {
      parsed.data.sessionId = sessionId;
      return parsed.data;
    }
    return null;
  } catch (err) {
    logger.error("Failed to read session metadata", {
      sessionId,
      metadataPath,
      error: String(err),
    });
    return null;
  }
}

export function listSessionsFromBothDirs(
  options: BothDirsOptions,
): SessionMetaWithScope[] {
  const { globalDir, localDir } = options;

  const globalSessions = listSessions({ traceDir: globalDir }).map((s) => ({
    ...s,
    scope: "global" as const,
  }));

  if (!localDir) {
    return globalSessions;
  }

  const localSessions = listSessions({ traceDir: localDir }).map((s) => ({
    ...s,
    scope: "local" as const,
  }));

  const sessionMap = new Map<string, SessionMetaWithScope>();

  for (const session of globalSessions) {
    sessionMap.set(session.id, session);
  }

  for (const session of localSessions) {
    sessionMap.set(session.id, session);
  }

  return Array.from(sessionMap.values()).sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
}

export function listSessionsTreeFromBothDirs(
  options: BothDirsOptions,
): SessionTreeNodeWithScope[] {
  const sessions = listSessionsFromBothDirs(options);
  const tree: SessionTreeNodeWithScope[] = [];

  for (const session of sessions) {
    if (!session.parentID) {
      const children = sessions.filter((s) => s.parentID === session.id);
      const node: SessionTreeNodeWithScope = {
        ...session,
        children,
      };
      tree.push(node);
    }
  }

  return tree.sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
}
