import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { promises as fs } from "node:fs";
import type { TraceRecord } from "../types.js";
import { logger } from "../logger.js";

export interface SessionState {
  id: string;
  status: "active" | "stopped" | "archived";
  startedAt: string | null;
  endedAt: string | null;
  requestCount: number;
  title?: string;
  parentID?: string;
  subSessions?: string[];
  enabled?: boolean;
  folderPath?: string;
}

export interface SessionMetadata {
  title?: string;
  parentID?: string;
  subSessions?: string[];
  enabled?: boolean;
  folderPath?: string;
  startedAt?: string;
}

export interface GlobalState {
  key: string;
  value: string | null;
  updatedAt: string;
}

const CONFIG_FILENAME = "config.json";
const CURRENT_SCHEMA_VERSION = 2;

interface ConfigFile {
  global_trace_enabled: boolean;
  plugin_enabled: boolean;
  current_session: string | null;
  schema_version: number;
}

const DEFAULT_CONFIG: ConfigFile = {
  global_trace_enabled: false,
  plugin_enabled: true,
  current_session: null,
  schema_version: CURRENT_SCHEMA_VERSION,
};

export class ConfigManager {
  private traceDir: string;
  private configPath: string;
  private configCache: ConfigFile | null = null;

  constructor(traceDir: string) {
    this.traceDir = traceDir;
    this.configPath = join(traceDir, CONFIG_FILENAME);

    if (!existsSync(traceDir)) {
      mkdirSync(traceDir, { recursive: true });
    }
  }

  async init(): Promise<void> {
    mkdirSync(this.traceDir, { recursive: true });

    if (!existsSync(this.configPath)) {
      this.writeConfig({ ...DEFAULT_CONFIG });
    }

    this.configCache = this.readConfig();
  }

  private readConfig(): ConfigFile {
    try {
      if (!existsSync(this.configPath)) {
        return { ...DEFAULT_CONFIG };
      }
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      return {
        global_trace_enabled: normalizeBoolean(
          parsed.global_trace_enabled,
          DEFAULT_CONFIG.global_trace_enabled,
        ),
        plugin_enabled: normalizeBoolean(
          parsed.plugin_enabled,
          DEFAULT_CONFIG.plugin_enabled,
        ),
        current_session:
          typeof parsed.current_session === "string"
            ? parsed.current_session
            : null,
        schema_version:
          typeof parsed.schema_version === "number"
            ? parsed.schema_version
            : CURRENT_SCHEMA_VERSION,
      };
    } catch (err) {
      logger.error("Failed to read config.json, using defaults", {
        configPath: this.configPath,
        error: String(err),
      });
      return { ...DEFAULT_CONFIG };
    }
  }

  private writeConfig(config: ConfigFile): void {
    try {
      const tmpPath = this.configPath + ".tmp";
      writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8");
      renameSync(tmpPath, this.configPath);
      this.configCache = config;
    } catch (err) {
      logger.error("Failed to write config.json", {
        configPath: this.configPath,
        error: String(err),
      });
    }
  }

  reloadConfig(): void {
    this.configCache = this.readConfig();
  }

  getGlobalState(key: string): string | null {
    if (!this.configCache) {
      this.configCache = this.readConfig();
    }
    const v = (this.configCache as unknown as Record<string, unknown>)[key];
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  }

  setGlobalState(key: string, value: string | null): void {
    const config = this.readConfig();
    if (key === "global_trace_enabled") {
      config.global_trace_enabled = value === "true";
    } else if (key === "plugin_enabled") {
      config.plugin_enabled = value !== "false";
    } else if (key === "current_session") {
      config.current_session = value;
    } else {
      (config as unknown as Record<string, unknown>)[key] = value;
    }
    this.writeConfig(config);
  }

  startSession(sessionId?: string): string {
    const id = sessionId ?? this.generateSessionId();
    mkdirSync(join(this.traceDir, id), { recursive: true });
    this.setGlobalState("current_session", id);
    this.updateSessionMetadata(id, { startedAt: new Date().toISOString() });
    return id;
  }

  stopSession(sessionId: string): void {
    const current = this.getGlobalState("current_session");
    if (current === sessionId) {
      this.setGlobalState("current_session", null);
    }
  }

  getSession(sessionId: string): SessionState | null {
    return this.getSessionFromFs(sessionId);
  }

  getActiveSession(): string | null {
    const sessionId = this.getGlobalState("current_session");
    if (!sessionId) return null;

    const sessionDir = join(this.traceDir, sessionId);
    if (!existsSync(sessionDir)) {
      this.setGlobalState("current_session", null);
      return null;
    }

    return sessionId;
  }

  async writeRecord(
    sessionId: string,
    seq: number,
    record: TraceRecord,
  ): Promise<void> {
    const sessionDir = join(this.traceDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const filePath = join(sessionDir, `${seq}.json`);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(record, null, 2));
    await fs.rename(tmpPath, filePath);
  }

  listSessions(): SessionState[] {
    return this.listSessionsFromFs();
  }

  private generateSessionId(): string {
    return randomUUID();
  }

  private scanFsSessions(): string[] {
    try {
      const entries = readdirSync(this.traceDir);
      return entries.filter((e) => {
        const full = join(this.traceDir, e);
        try {
          const stat = statSync(full);
          return stat.isDirectory();
        } catch {
          return false;
        }
      });
    } catch (err) {
      logger.error("Failed to scan filesystem sessions", {
        traceDir: this.traceDir,
        error: String(err),
      });
      return [];
    }
  }

  private getSessionFromFs(sessionId: string): SessionState | null {
    const sessionDir = join(this.traceDir, sessionId);
    if (!existsSync(sessionDir)) return null;

    const metadata = this.readMetadataFile(sessionId);
    const isCurrentSession =
      this.configCache?.current_session === sessionId;

    // Fast path: read timeline.ndjson instead of all JSON files
    const ndjsonData = this.readNdjsonTiming(sessionDir);
    if (ndjsonData) {
      return {
        id: sessionId,
        status: isCurrentSession ? "active" : "stopped",
        startedAt: metadata.startedAt ?? ndjsonData.startedAt,
        endedAt: ndjsonData.endedAt,
        requestCount: ndjsonData.count,
        ...metadata,
      };
    }

    // Fall back: read all {seq}.json files
    const files = readdirSync(sessionDir).filter(
      (f) => /^\d+\.json$/.test(f),
    );

    if (files.length === 0) {
      return {
        id: sessionId,
        status: isCurrentSession ? "active" : "stopped",
        startedAt: metadata.startedAt ?? null,
        endedAt: null,
        requestCount: 0,
        ...metadata,
      };
    }

    let startedAt: string | null = null;
    let endedAt: string | null = null;
    let count = 0;

    for (const f of files) {
      try {
        const raw = readFileSync(join(sessionDir, f), "utf-8");
        const rec: TraceRecord = JSON.parse(raw);
        count++;
        if (!startedAt || rec.requestAt < startedAt) startedAt = rec.requestAt;
        if (!endedAt || rec.responseAt > endedAt) endedAt = rec.responseAt;
      } catch (err) {
        logger.error("Failed to read session record file", {
          sessionId,
          file: f,
          traceDir: this.traceDir,
          error: String(err),
        });
      }
    }

    return {
      id: sessionId,
      status: isCurrentSession ? "active" : "stopped",
      startedAt: metadata.startedAt ?? startedAt,
      endedAt,
      requestCount: count,
      ...metadata,
    };
  }

  private listSessionsFromFs(): SessionState[] {
    const ids = this.scanFsSessions();
    const sessions: SessionState[] = [];

    for (const id of ids) {
      const session = this.getSessionFromFs(id);
      if (session) sessions.push(session);
    }

    return sessions.sort((a, b) =>
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );
  }

  /** Try to read timing data from timeline.ndjson for O(S+logR) session listing. */
  private readNdjsonTiming(sessionDir: string): { startedAt: string | null; endedAt: string | null; count: number } | null {
    const indexPath = join(sessionDir, "timeline.ndjson");
    if (!existsSync(indexPath)) return null;
    try {
      const raw = readFileSync(indexPath, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return { startedAt: null, endedAt: null, count: 0 };

      let startedAt: string | null = null;
      let endedAt: string | null = null;
      let count = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { requestAt?: string; responseAt?: string | null };
          count++;
          if (entry.requestAt && (!startedAt || entry.requestAt < startedAt)) {
            startedAt = entry.requestAt;
          }
          if (entry.responseAt && (!endedAt || entry.responseAt > endedAt)) {
            endedAt = entry.responseAt;
          }
        } catch {
          // skip malformed line
        }
      }

      return { startedAt, endedAt, count };
    } catch {
      return null;
    }
  }

  private getMetadataPath(sessionId: string): string {
    return join(this.traceDir, sessionId, "metadata.json");
  }

  private readMetadataFile(sessionId: string): SessionMetadata {
    const metaPath = this.getMetadataPath(sessionId);
    if (!existsSync(metaPath)) {
      return {};
    }

    try {
      const raw = readFileSync(metaPath, "utf-8");
      return JSON.parse(raw) as SessionMetadata;
    } catch (err) {
      logger.error("Failed to read session metadata file", {
        sessionId,
        metaPath,
        traceDir: this.traceDir,
        error: String(err),
      });
      return {};
    }
  }

  private writeMetadataFile(
    sessionId: string,
    metadata: SessionMetadata,
  ): void {
    const sessionDir = join(this.traceDir, sessionId);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const metaPath = this.getMetadataPath(sessionId);
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  updateSessionMetadata(
    sessionId: string,
    metadata: Partial<SessionMetadata>,
  ): void {
    const existing = this.readMetadataFile(sessionId);
    const updated: SessionMetadata = { ...existing };

    if (metadata.title !== undefined) {
      updated.title = metadata.title;
    }
    if (metadata.parentID !== undefined) {
      updated.parentID = metadata.parentID;
    }
    if (metadata.folderPath !== undefined) {
      updated.folderPath = metadata.folderPath;
    }
    if (metadata.startedAt !== undefined) {
      updated.startedAt = metadata.startedAt;
    }

    this.writeMetadataFile(sessionId, updated);
  }

  setSessionEnabled(sessionId: string, enabled: boolean): void {
    const existing = this.readMetadataFile(sessionId);
    this.writeMetadataFile(sessionId, { ...existing, enabled });
  }

  getSessionEnabled(sessionId: string): boolean {
    const metadata = this.readMetadataFile(sessionId);
    return metadata.enabled ?? true;
  }

  isTraceEnabled(sessionId?: string): boolean {
    const globalEnabled =
      this.getGlobalState("global_trace_enabled") === "true";

    if (globalEnabled) return true;

    if (!sessionId) return false;

    return this.getSessionEnabled(sessionId);
  }

  addSubSession(parentSessionId: string, subSessionId: string): void {
    const existing = this.readMetadataFile(parentSessionId);
    const subSessions = existing.subSessions ?? [];

    if (!subSessions.includes(subSessionId)) {
      subSessions.push(subSessionId);
      this.writeMetadataFile(parentSessionId, { ...existing, subSessions });
    }
  }
}

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

export type StateManager = ConfigManager;
