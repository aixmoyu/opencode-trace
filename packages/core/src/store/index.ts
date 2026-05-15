import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import AdmZip from "adm-zip";
import { getTraceDir as getDefaultTraceDir } from "../platform.js";
import type { TraceRecord } from "../types.js";
import { StateManager, SessionState } from "../state/index.js";
import { TraceRecordSchema } from "../schemas/types.js";
import { SessionMetadataFileSchema } from "../schemas/store-types.js";
import { logger } from "../logger.js";

export interface StoreOptions {
  traceDir?: string;
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
}

/**
 * Represents a session in a tree structure with child sessions.
 * Used for displaying hierarchical session relationships in the viewer.
 * 
 * Children are a flat list (SessionMeta[]) - not recursive (SessionTreeNode[]).
 * This design supports only one level of nesting (parent → children, no grandchildren).
 */
export interface SessionTreeNode extends SessionMeta {
  children: SessionMeta[];
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

const managers = new Map<string, StateManager>();
const initPromises = new Map<string, Promise<void>>();

async function getManager(traceDir: string): Promise<StateManager> {
  if (!managers.has(traceDir)) {
    const manager = new StateManager(traceDir);
    managers.set(traceDir, manager);
    initPromises.set(traceDir, manager.init());
  }
  await initPromises.get(traceDir);
  return managers.get(traceDir)!;
}

function getManagerSync(traceDir: string): StateManager | null {
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
      const files = safeReaddir(full).filter((f) => f.endsWith(".json") && f !== "metadata.json");
      const hasRecords = files.length > 0;

      let title: string | undefined;
      let parentID: string | undefined;

      let folderPath: string | undefined;
      try {
        const metaPath = join(full, "metadata.json");
        const metaRaw = readFileSync(metaPath, "utf-8");
        const meta = JSON.parse(metaRaw) as { title?: string; parentID?: string; folderPath?: string };
        title = meta.title;
        parentID = meta.parentID;
        folderPath = meta.folderPath;
      } catch (err) {
        logger.error("Failed to read metadata for session listing", {
          sessionDir: full,
          error: String(err),
        });
      }

      if (!hasRecords && !title) continue;

      let createdAt: string | null = null;
      let updatedAt: string | null = null;

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

      sessions.push({
        id: entry,
        requestCount: files.length,
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

  return sessions.sort(
    (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
  );
}

export function listSessionsTree(options?: StoreOptions): SessionTreeNode[] {
  const sessions = listSessions(options);
  const tree: SessionTreeNode[] = [];

  for (const session of sessions) {
    if (!session.parentID) {
      const node: SessionTreeNode = {
        ...session,
        children: sessions.filter(s => s.parentID === session.id)
      };
      tree.push(node);
    }
  }

  return tree.sort((a, b) =>
    (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
  );
}

export function getSessionRecords(
  sessionId: string,
  options?: StoreOptions
): TraceRecord[] {
  const sessionDir = join(resolveDir(options), sessionId);
  if (!existsSync(sessionDir)) return [];

  const files = safeReaddir(sessionDir)
    .filter((f) => f.endsWith(".json") && f !== "metadata.json")
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
  options?: StoreOptions
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
  options?: StoreOptions
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
  options?: StoreOptions
): Promise<void> {
  const traceDir = resolveDir(options);
  const manager = await getManager(traceDir);
  await manager.writeRecord(sessionId, seq, record);
}

export async function initStore(options?: StoreOptions): Promise<void> {
  const traceDir = resolveDir(options);
  await getManager(traceDir);
}

export function syncStore(options?: StoreOptions): void {
  const traceDir = resolveDir(options);
  const manager = getManagerSync(traceDir);
  if (manager) {
    manager.sync();
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
  traceDir: string
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
  traceDir: string
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
  options?: StoreOptions
): Promise<NodeJS.ReadableStream> {
  const traceDir = resolveDir(options);
  const sessionDir = join(traceDir, sessionId);

  if (!existsSync(sessionDir)) {
    throw new Error("Session not found");
  }

  const metadata = readSessionMetadata(sessionId, traceDir);
  const subSessions = metadata?.subSessions || [];

  const allSessionIds = [sessionId, ...subSessions];

  const archive = archiver("zip", { zlib: { level: 9 } });

  for (const id of allSessionIds) {
    const dir = join(traceDir, id);
    if (existsSync(dir)) {
      archive.directory(dir, join("sessions", id));
    }
  }

  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    mainSession: sessionId,
    sessions: allSessionIds,
    version: "1.0"
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  archive.finalize();

  return archive;
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
  options?: ImportOptions
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

  const manifest: ExportManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  const conflicts: ConflictInfo[] = [];
  for (const sessionId of manifest.sessions) {
    const existingDir = join(traceDir, sessionId);
    if (existsSync(existingDir)) {
      const existingMeta = readSessionMetadata(sessionId, traceDir);
      const importingMetaPath = join(tempDir, "sessions", sessionId, "metadata.json");
      const importingMeta = existsSync(importingMetaPath)
        ? JSON.parse(readFileSync(importingMetaPath, "utf-8"))
        : null;

      const existingRecords = safeReaddir(existingDir).filter(f => f.endsWith(".json") && f !== "metadata.json");
      const importingRecords = existsSync(join(tempDir, "sessions", sessionId))
        ? safeReaddir(join(tempDir, "sessions", sessionId)).filter(f => f.endsWith(".json") && f !== "metadata.json")
        : [];

      conflicts.push({
        sessionId,
        existing: {
          requestCount: existingRecords.length,
          createdAt: existingMeta?.createdAt ?? ""
        },
        importing: {
          requestCount: importingRecords.length,
          createdAt: importingMeta?.createdAt ?? ""
        }
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

    const importedRecords = safeReaddir(targetDir).filter(f => f.endsWith(".json") && f !== "metadata.json");

    importedSessions.push({
      sessionId,
      requestCount: importedRecords.length,
      strategy: actualStrategy,
      newId: actualStrategy === "rename" ? targetId : undefined
    });
  }

  rmSync(tempDir, { recursive: true });

  return { status: "success", importedSessions };
}

export async function deleteSession(
  sessionId: string,
  options?: StoreOptions
): Promise<void> {
  const traceDir = resolveDir(options);
  const sessionDir = join(traceDir, sessionId);

  if (!existsSync(sessionDir)) {
    throw new Error("Session not found");
  }

  const metadata = readSessionMetadata(sessionId, traceDir);
  const subSessions = metadata?.subSessions || [];

  for (const childId of subSessions) {
    const childDir = join(traceDir, childId);
    if (existsSync(childDir)) {
      rmSync(childDir, { recursive: true });
    }
  }

  rmSync(sessionDir, { recursive: true });
}