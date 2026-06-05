import {
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import archiver from "archiver";
import AdmZip from "adm-zip";
import { logger } from "../logger.js";
import type { StoreOptions } from "./read.js";
import { resolveDir, readSessionMetadata, listSessions, safeReaddir } from "./read.js";

export interface ExportManifest {
  exportedAt: string;
  mainSession: string;
  sessions: string[];
  version: string;
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
