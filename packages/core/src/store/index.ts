import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import AdmZip from "adm-zip";
import { getTraceDir as getDefaultTraceDir } from "../platform.js";
import type { TraceRecord } from "../types.js";
import { ConfigManager, SessionState } from "../state/index.js";
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

function resolveDir(options?: StoreOptions): string {
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

function safeReaddir(dir: string): string[] {
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

const managers = new Map<string, ConfigManager>();
const initPromises = new Map<string, Promise<void>>();

async function getManager(traceDir: string): Promise<ConfigManager> {
  if (!managers.has(traceDir)) {
    const manager = new ConfigManager(traceDir);
    managers.set(traceDir, manager);
    initPromises.set(traceDir, manager.init());
  }
  await initPromises.get(traceDir);
  return managers.get(traceDir)!;
}

function getManagerSync(traceDir: string): ConfigManager | null {
  return managers.get(traceDir) ?? null;
}

function sessionStateToMeta(session: SessionState): SessionMeta {
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

  const entries = safeReaddir(base);
  const sessions: SessionMeta[] = [];
    for (const entry of entries) {
      const full = join(base, entry);
      try {
        const stat = statSync(full);
        if (!stat.isDirectory()) continue;

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
          id: entry,
          requestCount,
          createdAt,
          updatedAt,
          title,
          parentID,
          folderPath,
        });

    } catch (err) {
      logger.error("Failed to process session entry for listing", {
        entry,
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

export async function writeRecord(
  sessionId: string,
  seq: number,
  record: TraceRecord,
  options?: StoreOptions,
): Promise<void> {
  const traceDir = resolveDir(options);
  const manager = await getManager(traceDir);
  await manager.writeRecord(sessionId, seq, record);
}

export async function initStore(options?: StoreOptions): Promise<void> {
  const traceDir = resolveDir(options);
  await getManager(traceDir);
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

export interface SessionMetadataFile {
  sessionId: string;
  title?: string;
  enabled?: boolean;
  parentID?: string;
  subSessions?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ExportManifest {
  exportedAt: string;
  mainSession: string;
  sessions: string[];
  version: string;
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

export function writeSessionMetadata(
  sessionId: string,
  metadata: SessionMetadataFile,
  traceDir: string,
): void {
  const sessionDir = join(traceDir, sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  const metadataPath = join(sessionDir, "metadata.json");
  const data = { ...metadata, sessionId };
  writeFileSync(metadataPath, JSON.stringify(data, null, 2), "utf-8");
}

export async function exportSessionZip(
  sessionId: string,
  options?: StoreOptions,
): Promise<Buffer> {
  const traceDir = resolveDir(options);
  const sessionDir = join(traceDir, sessionId);

  if (!existsSync(sessionDir)) {
    throw new Error("Session not found");
  }

  const metadata = readSessionMetadata(sessionId, traceDir);
  const storedSubSessions = metadata?.subSessions || [];

  const allSessions = listSessions({ traceDir });
  const discoveredChildren = allSessions
    .filter((s) => s.parentID === sessionId)
    .map((s) => s.id);

  const allSubSessions = [
    ...new Set([...storedSubSessions, ...discoveredChildren]),
  ];

  const allSessionIds = [sessionId, ...allSubSessions];

  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    mainSession: sessionId,
    sessions: allSessionIds,
    version: "1.0",
  };

  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("error", (err) => {
      reject(new Error("Failed to create archive: " + err.message));
    });

    archive.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    archive.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    for (const id of allSessionIds) {
      const dir = join(traceDir, id);
      if (existsSync(dir)) {
        archive.directory(dir, join("sessions", id));
      }
    }

    archive.append(JSON.stringify(manifest, null, 2), {
      name: "manifest.json",
    });

    archive.finalize();
  });
}

export interface ImportResult {
  status: "success" | "conflict";
  conflicts?: ConflictInfo[];
  importedSessions?: ImportedSessionInfo[];
}

export interface ConflictInfo {
  sessionId: string;
  existing: { requestCount: number; createdAt: string };
  importing: { requestCount: number; createdAt: string };
}

export interface ImportedSessionInfo {
  sessionId: string;
  requestCount: number;
  strategy: "none" | "rename" | "skip" | "overwrite";
  newId?: string;
}

interface ImportOptions extends StoreOptions {
  conflictStrategy?: "prompt" | "rename" | "skip" | "overwrite";
}

export async function importSessionZip(
  zipBuffer: Buffer,
  options?: ImportOptions,
): Promise<ImportResult> {
  const traceDir = resolveDir(options);
  const strategy = options?.conflictStrategy ?? "prompt";

  const tempDir = join(traceDir, ".temp-import-" + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(tempDir, true);
  } catch (err) {
    logger.error("Failed to extract ZIP file", {
      traceDir,
      error: String(err),
    });
    rmSync(tempDir, { recursive: true });
    throw new Error("Failed to extract ZIP file");
  }

  const manifestPath = join(tempDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    rmSync(tempDir, { recursive: true });
    throw new Error("Invalid export format: missing manifest.json");
  }

  const manifest: ExportManifest = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  );

  const conflicts: ConflictInfo[] = [];
  for (const sessionId of manifest.sessions) {
    const existingDir = join(traceDir, sessionId);
    if (existsSync(existingDir)) {
      const existingMeta = readSessionMetadata(sessionId, traceDir);
      const importingMetaPath = join(
        tempDir,
        "sessions",
        sessionId,
        "metadata.json",
      );
      const importingMeta = existsSync(importingMetaPath)
        ? JSON.parse(readFileSync(importingMetaPath, "utf-8"))
        : null;

      const existingRecords = safeReaddir(existingDir).filter(
        (f) => /^\d+\.json$/.test(f),
      );
      const importingRecords = existsSync(join(tempDir, "sessions", sessionId))
        ? safeReaddir(join(tempDir, "sessions", sessionId)).filter(
            (f) => /^\d+\.json$/.test(f),
          )
        : [];

      conflicts.push({
        sessionId,
        existing: {
          requestCount: existingRecords.length,
          createdAt: existingMeta?.createdAt ?? "",
        },
        importing: {
          requestCount: importingRecords.length,
          createdAt: importingMeta?.createdAt ?? "",
        },
      });
    }
  }

  if (conflicts.length > 0 && strategy === "prompt") {
    rmSync(tempDir, { recursive: true });
    return { status: "conflict", conflicts };
  }

  const importedSessions: ImportedSessionInfo[] = [];

  for (const sessionId of manifest.sessions) {
    const sourceDir = join(tempDir, "sessions", sessionId);
    if (!existsSync(sourceDir)) continue;

    let targetId = sessionId;
    let actualStrategy: "none" | "rename" | "skip" | "overwrite" = "none";

    if (existsSync(join(traceDir, sessionId))) {
      if (strategy === "skip") {
        actualStrategy = "skip";
        continue;
      } else if (strategy === "rename") {
        targetId = sessionId + "-imported";
        actualStrategy = "rename";
      } else if (strategy === "overwrite") {
        actualStrategy = "overwrite";
        rmSync(join(traceDir, sessionId), { recursive: true });
      }
    }

    const targetDir = join(traceDir, targetId);
    mkdirSync(targetDir, { recursive: true });

    const files = safeReaddir(sourceDir);
    for (const file of files) {
      writeFileSync(join(targetDir, file), readFileSync(join(sourceDir, file)));
    }

    const importedRecords = safeReaddir(targetDir).filter(
      (f) => /^\d+\.json$/.test(f),
    );

    importedSessions.push({
      sessionId,
      requestCount: importedRecords.length,
      strategy: actualStrategy,
      newId: actualStrategy === "rename" ? targetId : undefined,
    });
  }

  rmSync(tempDir, { recursive: true });

  return { status: "success", importedSessions };
}

export async function deleteSession(
  sessionId: string,
  options?: StoreOptions,
): Promise<void> {
  const traceDir = resolveDir(options);
  const sessionDir = join(traceDir, sessionId);

  if (!existsSync(sessionDir)) {
    throw new Error("Session not found");
  }

  const metadata = readSessionMetadata(sessionId, traceDir);
  const storedSubSessions = metadata?.subSessions || [];

  const allSessions = listSessions({ traceDir });
  const discoveredChildren = allSessions
    .filter((s) => s.parentID === sessionId)
    .map((s) => s.id);

  const allSubSessions = [
    ...new Set([...storedSubSessions, ...discoveredChildren]),
  ];

  for (const childId of allSubSessions) {
    const childDir = join(traceDir, childId);
    if (existsSync(childDir)) {
      rmSync(childDir, { recursive: true });
    }
  }

  rmSync(sessionDir, { recursive: true });
}

export async function deleteSessions(
  sessionIds: string[],
  options?: StoreOptions,
): Promise<{
  deleted: string[];
  errors: { sessionId: string; error: string }[];
}> {
  const deleted: string[] = [];
  const errors: { sessionId: string; error: string }[] = [];

  for (const sessionId of sessionIds) {
    try {
      await deleteSession(sessionId, options);
      deleted.push(sessionId);
    } catch (e) {
      errors.push({ sessionId, error: (e as Error).message });
    }
  }

  return { deleted, errors };
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
