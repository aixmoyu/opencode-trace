import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { StateManager, SessionState } from "../state/index.js";
import { logger } from "../logger.js";

const DEFAULT_TRACE_DIR = join(homedir(), ".opencode-trace");
const RECORDING_MARKER = ".recording";

export interface RecordingStatus {
  active: boolean;
  sessionId?: string;
  startedAt?: string;
}

function resolveDir(traceDir?: string): string {
  return traceDir ?? DEFAULT_TRACE_DIR;
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

function sessionToRecording(session: SessionState | null): RecordingStatus {
  if (!session) return { active: false };
  return {
    active: session.status === "active",
    sessionId: session.id,
    startedAt: session.startedAt ?? undefined,
  };
}

export async function startRecording(sessionId?: string, traceDir?: string): Promise<string> {
  const dir = resolveDir(traceDir);
  const manager = await getManager(dir);
  return manager.startSession(sessionId);
}

export function stopRecording(sessionId: string, traceDir?: string): boolean {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);

  if (manager) {
    manager.stopSession(sessionId);
    return true;
  }

  const markerPath = join(dir, sessionId, RECORDING_MARKER);
  if (!existsSync(markerPath)) return false;
  try {
    rmSync(markerPath);
    return true;
  } catch (err) {
    logger.error("Failed to remove recording marker", {
      sessionId,
      markerPath,
      error: String(err),
    });
    return false;
  }
}

export function setGlobalTraceEnabled(enabled: boolean, traceDir?: string): void {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);
  if (manager) {
    manager.setGlobalState("global_trace_enabled", enabled ? "true" : "false");
  }
}

export function getGlobalTraceEnabled(traceDir?: string): boolean {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);
  if (manager) {
    return manager.getGlobalState("global_trace_enabled") === "true";
  }
  return true;
}

export function setSessionEnabled(sessionId: string, enabled: boolean, traceDir?: string): void {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);
  if (manager) {
    manager.setSessionEnabled(sessionId, enabled);
  }
}

export function getSessionEnabled(sessionId: string, traceDir?: string): boolean {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);
  if (manager) {
    return manager.getSessionEnabled(sessionId);
  }
  return true;
}

export function shouldRecord(sessionId?: string, traceDir?: string): boolean {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);
  if (manager) {
    return manager.isTraceEnabled(sessionId);
  }
  return true;
}

export function isRecording(sessionId: string, traceDir?: string): boolean {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);

  if (manager) {
    const session = manager.getSession(sessionId);
    return session?.status === "active";
  }

  const markerPath = join(dir, sessionId, RECORDING_MARKER);
  return existsSync(markerPath);
}

export function getRecordingStatus(sessionId: string, traceDir?: string): RecordingStatus {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);

  if (manager) {
    return sessionToRecording(manager.getSession(sessionId));
  }

  const markerPath = join(dir, sessionId, RECORDING_MARKER);
  if (!existsSync(markerPath)) return { active: false };

  try {
    const raw = readFileSync(markerPath, "utf-8");
    const data = JSON.parse(raw);
    return {
      active: true,
      sessionId,
      startedAt: data.startedAt,
    };
  } catch (err) {
    logger.error("Failed to read recording marker", {
      sessionId,
      markerPath,
      error: String(err),
    });
    return { active: true, sessionId };
  }
}

export function listRecordings(traceDir?: string): RecordingStatus[] {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);

  if (manager) {
    return manager.listSessions()
      .filter(s => s.status === "active")
      .map(sessionToRecording);
  }

  const base = dir;
  try {
    const entries = readdirSync(base);
    const results: RecordingStatus[] = [];
    for (const entry of entries) {
      const markerPath = join(base, entry, RECORDING_MARKER);
      if (existsSync(markerPath)) {
        results.push(getRecordingStatus(entry, traceDir));
      }
    }
    return results;
  } catch (err) {
    logger.error("Failed to list recordings from filesystem", {
      traceDir: base,
      error: String(err),
    });
    return [];
  }
}

export async function initStateManager(traceDir?: string): Promise<void> {
  const dir = resolveDir(traceDir);
  await getManager(dir);
}

export function syncState(traceDir?: string): void {
  const dir = resolveDir(traceDir);
  const manager = getManagerSync(dir);
  if (manager) {
    manager.sync();
  }
}