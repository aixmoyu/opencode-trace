import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { promises as fs } from "node:fs";
import initSqlJs, { Database, type SqlJsStatic } from "sql.js";
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
}

export interface GlobalState {
  key: string;
  value: string | null;
  updatedAt: string;
}

const DB_FILENAME = "state.db";
const DB_CORRUPT_SUFFIX = ".corrupt";
const CURRENT_SCHEMA_VERSION = 1;

interface Migration {
  version: number;
  migrate: (db: Database) => void;
}

const MIGRATIONS: Migration[] = [];

export class StateManager {
  private traceDir: string;
  private db: Database | null = null;
  private dbPath: string;
  private sqlJs: SqlJsStatic | null = null;

  constructor(traceDir: string) {
    this.traceDir = traceDir;
    this.dbPath = join(traceDir, DB_FILENAME);

    if (!existsSync(traceDir)) {
      mkdirSync(traceDir, { recursive: true });
    }
  }

  async init(): Promise<void> {
    try {
      const SQL = await initSqlJs();
      this.sqlJs = SQL;

      if (existsSync(this.dbPath)) {
        try {
          const buffer = readFileSync(this.dbPath);
          this.db = new SQL.Database(buffer);
          this.validateDb();
          this.runMigrations();
        } catch (err) {
          logger.error("Database validation failed, recreating", {
            traceDir: this.traceDir,
            error: String(err),
          });
          this.handleCorruptDb();
          this.db = new SQL.Database();
          this.createSchema();
        }
      } else {
        this.db = new SQL.Database();
        this.createSchema();
      }

      this.insertDefaultState();
      this.persistDb();
    } catch (err) {
      logger.error("StateManager initialization failed", {
        traceDir: this.traceDir,
        error: String(err),
      });
      this.db = null;
    }
  }

  private validateDb(): void {
    if (!this.db) return;
    try {
      this.db.exec("SELECT 1 FROM schema_version LIMIT 1");
      this.db.exec("SELECT 1 FROM sessions LIMIT 1");
      this.db.exec("SELECT 1 FROM global_state LIMIT 1");
    } catch {
      throw new Error("Schema invalid");
    }
  }

  private getSchemaVersion(): number {
    if (!this.db) return 0;
    try {
      const result = this.db.exec("SELECT MAX(version) FROM schema_version");
      if (result.length === 0 || result[0].values.length === 0 || result[0].values[0][0] === null) return 0;
      return result[0].values[0][0] as number;
    } catch (err) {
      logger.error("Failed to read schema version", {
        traceDir: this.traceDir,
        error: String(err),
      });
      return 0;
    }
  }

  private runMigrations(): void {
    if (!this.db) return;

    const currentVersion = this.getSchemaVersion();
    const pending = MIGRATIONS.filter(m => m.version > currentVersion).sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      try {
        migration.migrate(this.db);
        this.db.exec(`INSERT INTO schema_version (version) VALUES (${migration.version})`);
        logger.info("Database migration applied", { version: migration.version, traceDir: this.traceDir });
      } catch (err) {
        logger.error("Database migration failed", {
          version: migration.version,
          traceDir: this.traceDir,
          error: String(err),
        });
        throw err;
      }
    }
  }

  private handleCorruptDb(): void {
    const corruptPath = this.dbPath + DB_CORRUPT_SUFFIX;
    try {
      renameSync(this.dbPath, corruptPath);
    } catch (err) {
      logger.error("Failed to rename corrupt database, removing", {
        dbPath: this.dbPath,
        error: String(err),
      });
      try {
        rmSync(this.dbPath, { force: true });
      } catch (rmErr) {
        logger.error("Failed to remove corrupt database", {
          dbPath: this.dbPath,
          error: String(rmErr),
        });
      }
    }
  }

  private createSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'active',
        started_at TEXT,
        ended_at TEXT,
        request_count INTEGER DEFAULT 0,
        synced_at TEXT
      );
      
      CREATE TABLE IF NOT EXISTS global_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS request_index (
        session_id TEXT,
        seq INTEGER,
        url TEXT,
        method TEXT,
        purpose TEXT,
        request_at TEXT,
        PRIMARY KEY (session_id, seq)
      );
    `);

    this.db.exec(`INSERT INTO schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION})`);
  }

  private insertDefaultState(): void {
    if (!this.db) return;

    const existing = this.db.exec("SELECT key FROM global_state");
    const existingKeys = existing.length > 0 && existing[0].values.length > 0
      ? existing[0].values.map((v) => v[0] as string)
      : [];

    const defaults: { key: string; value: string | null }[] = [
      { key: "current_session", value: null },
      { key: "plugin_enabled", value: "true" },
      { key: "global_trace_enabled", value: "false" },
    ];

    for (const { key, value } of defaults) {
      if (!existingKeys.includes(key)) {
        const escapedValue = value === null ? "NULL" : `'${value}'`;
        this.db.exec(`INSERT INTO global_state (key, value) VALUES ('${key}', ${escapedValue})`);
      }
    }
  }

  private persistDb(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
    } catch (err) {
      logger.error("Failed to persist database", {
        traceDir: this.traceDir,
        error: String(err),
      });
    }
  }

  getGlobalState(key: string): string | null {
    if (!this.db) return null;

    const result = this.db.exec(`SELECT value FROM global_state WHERE key = '${key}'`);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return result[0].values[0][0] as string | null;
  }

  setGlobalState(key: string, value: string | null): void {
    if (!this.db) return;

    const escapedValue = value === null ? "NULL" : `'${value}'`;
    this.db.exec(`UPDATE global_state SET value = ${escapedValue}, updated_at = CURRENT_TIMESTAMP WHERE key = '${key}'`);
    this.persistDb();
  }

  startSession(sessionId?: string): string {
    const id = sessionId ?? this.generateSessionId();

    if (!this.db) {
      mkdirSync(join(this.traceDir, id), { recursive: true });
      return id;
    }

    const now = new Date().toISOString();
    this.db.exec(`
      INSERT INTO sessions (id, status, started_at, request_count)
      VALUES ('${id}', 'active', '${now}', 0)
    `);
    this.setGlobalState("current_session", id);

    mkdirSync(join(this.traceDir, id), { recursive: true });
    this.persistDb();

    return id;
  }

  stopSession(sessionId: string): void {
    if (!this.db) return;

    const now = new Date().toISOString();
    this.db.exec(`UPDATE sessions SET status = 'stopped', ended_at = '${now}' WHERE id = '${sessionId}'`);

    const current = this.getGlobalState("current_session");
    if (current === sessionId) {
      this.setGlobalState("current_session", null);
    }

    this.persistDb();
  }

  getSession(sessionId: string): SessionState | null {
    if (!this.db) {
      return this.getSessionFromFs(sessionId);
    }

    const result = this.db.exec(`SELECT id, status, started_at, ended_at, request_count FROM sessions WHERE id = '${sessionId}'`);
    if (result.length === 0 || result[0].values.length === 0) return null;

    const row = result[0].values[0];
    const baseState = {
      id: row[0] as string,
      status: row[1] as SessionState["status"],
      startedAt: row[2] as string | null,
      endedAt: row[3] as string | null,
      requestCount: row[4] as number,
    };

    const metadata = this.readMetadataFile(sessionId);
    return { ...baseState, ...metadata };
  }

  getActiveSession(): string | null {
    const sessionId = this.getGlobalState("current_session");
    if (!sessionId) return null;

    const sessionDir = join(this.traceDir, sessionId);
    if (!existsSync(sessionDir)) {
      if (this.db) {
        this.db.exec(`DELETE FROM sessions WHERE id = '${sessionId}'`);
        this.db.exec(`DELETE FROM request_index WHERE session_id = '${sessionId}'`);
        this.setGlobalState("current_session", null);
        this.persistDb();
      }
      return null;
    }

    return sessionId;
  }

  async writeRecord(sessionId: string, seq: number, record: TraceRecord): Promise<void> {
    const sessionDir = join(this.traceDir, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    await fs.writeFile(
      join(sessionDir, `${seq}.json`),
      JSON.stringify(record, null, 2)
    );

    if (this.db) {
      try {
        this.db.exec(`UPDATE sessions SET request_count = request_count + 1 WHERE id = '${sessionId}'`);
        this.db.exec(`
          INSERT INTO request_index (session_id, seq, url, method, purpose, request_at)
          VALUES ('${sessionId}', ${seq}, '${record.request.url}', '${record.request.method}', '${record.purpose}', '${record.requestAt}')
        `);
        this.persistDb();
      } catch (err) {
        logger.error("Failed to update SQLite index for record", {
          sessionId,
          seq,
          traceDir: this.traceDir,
          error: String(err),
        });
      }
    }
  }

  sync(): void {
    if (!this.db) return;

    const fsSessions = this.scanFsSessions();
    const dbResult = this.db.exec("SELECT id FROM sessions");
    const dbSessions = dbResult.length > 0 ? dbResult[0].values.map((r: (string | number | null | Uint8Array)[]) => r[0] as string) : [];

    for (const dbId of dbSessions) {
      if (!fsSessions.includes(dbId)) {
        this.db.exec(`DELETE FROM sessions WHERE id = '${dbId}'`);
        this.db.exec(`DELETE FROM request_index WHERE session_id = '${dbId}'`);
      }
    }

    for (const fsId of fsSessions) {
      if (!dbSessions.includes(fsId)) {
        const meta = this.getSessionFromFs(fsId);
        if (meta) {
          const now = new Date().toISOString();
          this.db.exec(`
            INSERT INTO sessions (id, status, started_at, ended_at, request_count, synced_at)
            VALUES ('${fsId}', '${meta.status}', ${meta.startedAt ? `'${meta.startedAt}'` : 'NULL'}, ${meta.endedAt ? `'${meta.endedAt}'` : 'NULL'}, ${meta.requestCount}, '${now}')
          `);
        }
      }
    }

    this.persistDb();
  }

  listSessions(): SessionState[] {
    if (!this.db) {
      return this.listSessionsFromFs();
    }

    const result = this.db.exec("SELECT id, status, started_at, ended_at, request_count FROM sessions ORDER BY started_at DESC");
    if (result.length === 0) return [];

    return result[0].values.map((row: (string | number | null | Uint8Array)[]) => {
      const sessionId = row[0] as string;
      const metadata = this.readMetadataFile(sessionId);
      return {
        id: sessionId,
        status: row[1] as SessionState["status"],
        startedAt: row[2] as string | null,
        endedAt: row[3] as string | null,
        requestCount: row[4] as number,
        ...metadata,
      };
    });
  }

  private generateSessionId(): string {
    return randomUUID();
  }

  private scanFsSessions(): string[] {
    try {
      const entries = readdirSync(this.traceDir);
      return entries.filter(e => {
        const full = join(this.traceDir, e);
        try {
          const stat = require("fs").statSync(full);
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

    const files = readdirSync(sessionDir).filter(f => f.endsWith(".json") && f !== "metadata.json");
    if (files.length === 0) {
      const metadata = this.readMetadataFile(sessionId);
      if (Object.keys(metadata).length > 0) {
        return {
          id: sessionId,
          status: "active",
          startedAt: null,
          endedAt: null,
          requestCount: 0,
          ...metadata,
        };
      }
      return null;
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

    const metadata = this.readMetadataFile(sessionId);
    return {
      id: sessionId,
      status: "active",
      startedAt,
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
      (b.startedAt ?? "").localeCompare(a.startedAt ?? "")
    );
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

  private writeMetadataFile(sessionId: string, metadata: SessionMetadata): void {
    const sessionDir = join(this.traceDir, sessionId);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const metaPath = this.getMetadataPath(sessionId);
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  updateSessionMetadata(sessionId: string, metadata: { title?: string; parentID?: string; folderPath?: string }): void {
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

  reload(): void {
    if (!this.sqlJs || !existsSync(this.dbPath)) return;
    try {
      const buffer = readFileSync(this.dbPath);
      if (this.db) {
        this.db.close();
      }
      this.db = new this.sqlJs.Database(buffer);
    } catch (err) {
      logger.error("Failed to reload database from disk", {
        traceDir: this.traceDir,
        error: String(err),
      });
    }
  }

  isTraceEnabled(sessionId?: string): boolean {
    const globalEnabled = this.getGlobalState("global_trace_enabled") === "true";

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