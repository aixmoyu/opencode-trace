import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TraceRecord } from "../types.js";
import { ConfigManager, initConfigManager } from "../state/index.js";
import type { StoreOptions } from "./read.js";
import { resolveDir, readSessionMetadata, listSessions } from "./read.js";
import { PARSED_CACHE_VERSION } from "../parse/index.js";

async function getManager(traceDir: string): Promise<ConfigManager> {
  return initConfigManager(traceDir);
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

export function writeSessionMetadata(
  sessionId: string,
  metadata: import("./read.js").SessionMetadataFile,
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

export function writeParsedCache(
  sessionId: string,
  seq: number,
  parsed: Record<string, unknown>,
  options?: StoreOptions,
): void {
  const sessionDir = join(resolveDir(options), sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  const cachePath = join(sessionDir, `${seq}.parsed`);
  const data = { ...parsed, _pcv: PARSED_CACHE_VERSION };
  writeFileSync(cachePath, JSON.stringify(data), "utf-8");
}
