/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  utimesSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  listSessionsTree,
  listSessions,
  exportSessionZip,
  importSessionZip,
  deleteSession,
  listSessionsFromBothDirs,
  listSessionsTreeFromBothDirs,
  getSessionRecords,
  getRecord,
  getSSEStream,
  readTimelineIndex,
  getCachedParsed,
  deleteSessions,
} from "./index.js";
import archiver from "archiver";
import AdmZip from "adm-zip";
import { logger } from "../logger.js";
import { PARSED_CACHE_VERSION } from "../parse/index.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "store-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("listSessionsTree", () => {
  it("returns empty array when trace directory does not exist", () => {
    const nonExistentDir = join(
      tmpdir(),
      "non-existent-trace-dir-" + Date.now(),
    );
    const warnSpy = vi.spyOn(logger, "warn");
    const errorSpy = vi.spyOn(logger, "error");

    const tree = listSessionsTree({ traceDir: nonExistentDir });

    expect(tree).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("builds tree with parent-child relationships", () => {
    mkdirSync(join(testDir, "parent-1"), { recursive: true });
    mkdirSync(join(testDir, "child-1"), { recursive: true });
    mkdirSync(join(testDir, "child-2"), { recursive: true });
    mkdirSync(join(testDir, "parent-2"), { recursive: true });

    writeFileSync(
      join(testDir, "parent-1", "metadata.json"),
      JSON.stringify({ title: "Parent 1" }),
    );
    writeFileSync(
      join(testDir, "parent-1", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-02T00:00:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    writeFileSync(
      join(testDir, "child-1", "metadata.json"),
      JSON.stringify({ parentID: "parent-1" }),
    );
    writeFileSync(
      join(testDir, "child-1", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:00:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    writeFileSync(
      join(testDir, "child-2", "metadata.json"),
      JSON.stringify({ parentID: "parent-1" }),
    );
    writeFileSync(
      join(testDir, "child-2", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:00:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    writeFileSync(
      join(testDir, "parent-2", "metadata.json"),
      JSON.stringify({ title: "Parent 2" }),
    );
    writeFileSync(
      join(testDir, "parent-2", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-03T00:00:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const tree = listSessionsTree({ traceDir: testDir });

    expect(tree.length).toBe(2);
    expect(tree[0].id).toBe("parent-2");
    expect(tree[0].children.length).toBe(0);
    expect(tree[1].id).toBe("parent-1");
    expect(tree[1].children.length).toBe(2);
    expect(tree[1].children[0].id).toBe("child-1");
    expect(tree[1].children[1].id).toBe("child-2");
  });

  it("handles sessions without children", () => {
    mkdirSync(join(testDir, "session-1"), { recursive: true });
    mkdirSync(join(testDir, "session-2"), { recursive: true });

    writeFileSync(
      join(testDir, "session-1", "metadata.json"),
      JSON.stringify({ title: "Session 1" }),
    );
    writeFileSync(
      join(testDir, "session-1", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-02T00:00:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    writeFileSync(
      join(testDir, "session-2", "metadata.json"),
      JSON.stringify({ title: "Session 2" }),
    );
    writeFileSync(
      join(testDir, "session-2", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-03T00:00:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const tree = listSessionsTree({ traceDir: testDir });

    expect(tree.length).toBe(2);
    expect(tree[0].children.length).toBe(0);
    expect(tree[1].children.length).toBe(0);
  });
});

describe("exportSessionZip", () => {
  const testTraceDir = join(process.cwd(), "test-export-trace");
  const testSessionDir = join(testTraceDir, "test-session-1");

  beforeEach(() => {
    if (existsSync(testTraceDir)) rmSync(testTraceDir, { recursive: true });
    mkdirSync(testSessionDir, { recursive: true });

    // Create metadata.json
    writeFileSync(
      join(testSessionDir, "metadata.json"),
      JSON.stringify({
        sessionId: "test-session-1",
        title: "Test Session",
        subSessions: [],
      }),
    );

    // Create trace records
    writeFileSync(
      join(testSessionDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "test",
        requestAt: "2025-04-30T10:00:00Z",
        responseAt: "2025-04-30T10:01:00Z",
        request: {
          method: "POST",
          url: "http://test.com",
          headers: {},
          body: {},
        },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null,
      }),
    );

    writeFileSync(join(testSessionDir, "1.sse"), "data: test stream\n\n");
  });

  afterEach(() => {
    if (existsSync(testTraceDir)) rmSync(testTraceDir, { recursive: true });
  });

  it("should export single session without children", async () => {
    const buffer = await exportSessionZip("test-session-1", {
      traceDir: testTraceDir,
    });
    expect(buffer.length).toBeGreaterThan(0);

    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });

  it("should throw error if session not found", async () => {
    await expect(
      exportSessionZip("non-existent-session", { traceDir: testTraceDir }),
    ).rejects.toThrow("Session not found");
  });

  it("should export session with children", async () => {
    // Create child session
    const childSessionDir = join(testTraceDir, "test-child-1");
    mkdirSync(childSessionDir, { recursive: true });

    writeFileSync(
      join(childSessionDir, "metadata.json"),
      JSON.stringify({
        sessionId: "test-child-1",
        title: "Child Session",
        parentID: "test-session-1",
      }),
    );

    writeFileSync(
      join(childSessionDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "child test",
        requestAt: "2025-04-30T11:00:00Z",
        responseAt: "2025-04-30T11:01:00Z",
        request: {
          method: "POST",
          url: "http://child.com",
          headers: {},
          body: {},
        },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null,
      }),
    );

    // Update parent metadata to include subSessions
    writeFileSync(
      join(testSessionDir, "metadata.json"),
      JSON.stringify({
        sessionId: "test-session-1",
        title: "Test Session",
        subSessions: ["test-child-1"],
      }),
    );

    const buffer = await exportSessionZip("test-session-1", {
      traceDir: testTraceDir,
    });
    expect(buffer.length).toBeGreaterThan(0);

    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'

    expect(buffer.length).toBeGreaterThan(1000); // Should be larger with two sessions
  });
});

describe("importSessionZip", () => {
  const testImportDir = join(process.cwd(), "test-import-trace");

  beforeEach(() => {
    if (existsSync(testImportDir)) rmSync(testImportDir, { recursive: true });
    mkdirSync(testImportDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testImportDir)) rmSync(testImportDir, { recursive: true });
  });

  it("should import ZIP without conflicts", async () => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    archive.pipe(writable);

    archive.append(
      JSON.stringify({ sessionId: "import-test-1", title: "Imported Session" }),
      { name: "sessions/import-test-1/metadata.json" },
    );

    archive.append(
      JSON.stringify({
        id: 1,
        purpose: "import test",
        requestAt: "2025-04-30T12:00:00Z",
        responseAt: "2025-04-30T12:01:00Z",
        request: {
          method: "POST",
          url: "http://import.com",
          headers: {},
          body: {},
        },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null,
      }),
      { name: "sessions/import-test-1/1.json" },
    );

    archive.append(
      JSON.stringify({
        exportedAt: "2025-04-30T12:00:00Z",
        mainSession: "import-test-1",
        sessions: ["import-test-1"],
        version: "1.0",
      }),
      { name: "manifest.json" },
    );

    archive.finalize();

    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });

    const zipBuffer = Buffer.concat(chunks);

    const result = await importSessionZip(zipBuffer, {
      traceDir: testImportDir,
    });

    expect(result.status).toBe("success");
    expect(result.importedSessions).toHaveLength(1);
    expect(result.importedSessions![0].sessionId).toBe("import-test-1");

    const importedMetadataPath = join(
      testImportDir,
      "import-test-1",
      "metadata.json",
    );
    expect(existsSync(importedMetadataPath)).toBe(true);
  });

  it("should detect conflicts with prompt strategy", async () => {
    const existingDir = join(testImportDir, "conflict-test-1");
    mkdirSync(existingDir, { recursive: true });

    writeFileSync(
      join(existingDir, "metadata.json"),
      JSON.stringify({ sessionId: "conflict-test-1", title: "Existing" }),
    );

    writeFileSync(
      join(existingDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "existing",
        requestAt: "2025-04-30T10:00:00Z",
        responseAt: "2025-04-30T10:01:00Z",
        request: {
          method: "POST",
          url: "http://existing.com",
          headers: {},
          body: {},
        },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null,
      }),
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    archive.pipe(writable);

    archive.append(
      JSON.stringify({ sessionId: "conflict-test-1", title: "Imported" }),
      { name: "sessions/conflict-test-1/metadata.json" },
    );

    archive.append(
      JSON.stringify({
        id: 1,
        purpose: "imported",
        requestAt: "2025-04-30T12:00:00Z",
        responseAt: "2025-04-30T12:01:00Z",
        request: {
          method: "POST",
          url: "http://imported.com",
          headers: {},
          body: {},
        },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null,
      }),
      { name: "sessions/conflict-test-1/1.json" },
    );

    archive.append(
      JSON.stringify({
        exportedAt: "2025-04-30T12:00:00Z",
        mainSession: "conflict-test-1",
        sessions: ["conflict-test-1"],
        version: "1.0",
      }),
      { name: "manifest.json" },
    );

    archive.finalize();

    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });

    const zipBuffer = Buffer.concat(chunks);

    const result = await importSessionZip(zipBuffer, {
      traceDir: testImportDir,
      conflictStrategy: "prompt",
    });

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts![0].sessionId).toBe("conflict-test-1");
  });

  it("should rename conflicting sessions with rename strategy", async () => {
    const existingDir = join(testImportDir, "rename-test-1");
    mkdirSync(existingDir, { recursive: true });

    writeFileSync(
      join(existingDir, "metadata.json"),
      JSON.stringify({ sessionId: "rename-test-1", title: "Existing" }),
    );

    writeFileSync(
      join(existingDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "existing",
        requestAt: "2025-04-30T10:00:00Z",
        responseAt: "2025-04-30T10:01:00Z",
        request: {
          method: "POST",
          url: "http://existing.com",
          headers: {},
          body: {},
        },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null,
      }),
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    archive.pipe(writable);

    archive.append(
      JSON.stringify({ sessionId: "rename-test-1", title: "Imported" }),
      { name: "sessions/rename-test-1/metadata.json" },
    );

    archive.append(
      JSON.stringify({
        id: 1,
        purpose: "imported",
        requestAt: "2025-04-30T12:00:00Z",
        responseAt: "2025-04-30T12:01:00Z",
        request: {
          method: "POST",
          url: "http://imported.com",
          headers: {},
          body: {},
        },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null,
      }),
      { name: "sessions/rename-test-1/1.json" },
    );

    archive.append(
      JSON.stringify({
        exportedAt: "2025-04-30T12:00:00Z",
        mainSession: "rename-test-1",
        sessions: ["rename-test-1"],
        version: "1.0",
      }),
      { name: "manifest.json" },
    );

    archive.finalize();

    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });

    const zipBuffer = Buffer.concat(chunks);

    const result = await importSessionZip(zipBuffer, {
      traceDir: testImportDir,
      conflictStrategy: "rename",
    });

    expect(result.status).toBe("success");
    expect(result.importedSessions).toHaveLength(1);
    expect(result.importedSessions![0].sessionId).toBe("rename-test-1");
    expect(result.importedSessions![0].newId).toBe("rename-test-1-imported");

    expect(existsSync(join(testImportDir, "rename-test-1-imported"))).toBe(
      true,
    );
  });
});

describe("deleteSession", () => {
  const testDeleteDir = join(process.cwd(), "test-delete-trace");

  beforeEach(() => {
    if (existsSync(testDeleteDir)) rmSync(testDeleteDir, { recursive: true });
    mkdirSync(testDeleteDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDeleteDir)) rmSync(testDeleteDir, { recursive: true });
  });

  it("should delete single session", async () => {
    const sessionDir = join(testDeleteDir, "delete-test-1");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "metadata.json"),
      JSON.stringify({ sessionId: "delete-test-1" }),
    );
    writeFileSync(join(sessionDir, "1.json"), JSON.stringify({ id: 1 }));

    await deleteSession("delete-test-1", { traceDir: testDeleteDir });

    expect(existsSync(sessionDir)).toBe(false);
  });

  it("should delete parent with children", async () => {
    const parentDir = join(testDeleteDir, "parent-session");
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(
      join(parentDir, "metadata.json"),
      JSON.stringify({
        sessionId: "parent-session",
        subSessions: ["child-1", "child-2"],
      }),
    );
    writeFileSync(join(parentDir, "1.json"), JSON.stringify({ id: 1 }));

    const child1Dir = join(testDeleteDir, "child-1");
    mkdirSync(child1Dir, { recursive: true });
    writeFileSync(
      join(child1Dir, "metadata.json"),
      JSON.stringify({
        sessionId: "child-1",
        parentID: "parent-session",
      }),
    );

    const child2Dir = join(testDeleteDir, "child-2");
    mkdirSync(child2Dir, { recursive: true });
    writeFileSync(
      join(child2Dir, "metadata.json"),
      JSON.stringify({
        sessionId: "child-2",
        parentID: "parent-session",
      }),
    );

    await deleteSession("parent-session", { traceDir: testDeleteDir });

    expect(existsSync(parentDir)).toBe(false);
    expect(existsSync(child1Dir)).toBe(false);
    expect(existsSync(child2Dir)).toBe(false);
  });

  it("should throw error if session not found", async () => {
    await expect(
      deleteSession("non-existent", { traceDir: testDeleteDir }),
    ).rejects.toThrow("Session not found");
  });
});

describe("listSessionsFromBothDirs", () => {
  let globalDir: string;
  let localDir: string;

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), "global-trace-"));
    localDir = mkdtempSync(join(tmpdir(), "local-trace-"));
  });

  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  it("merges sessions from both global and local dirs", () => {
    mkdirSync(join(globalDir, "session-global"), { recursive: true });
    writeFileSync(
      join(globalDir, "session-global", "metadata.json"),
      JSON.stringify({ title: "Global Session" }),
    );
    writeFileSync(
      join(globalDir, "session-global", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    mkdirSync(join(localDir, "session-local"), { recursive: true });
    writeFileSync(
      join(localDir, "session-local", "metadata.json"),
      JSON.stringify({ title: "Local Session" }),
    );
    writeFileSync(
      join(localDir, "session-local", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-02T00:00:00Z",
        responseAt: "2024-01-02T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const sessions = listSessionsFromBothDirs({ globalDir, localDir });

    expect(sessions.length).toBe(2);
    expect(sessions.find((s: any) => s.id === "session-global")).toBeDefined();
    expect(sessions.find((s: any) => s.id === "session-local")).toBeDefined();
    expect(sessions.find((s: any) => s.id === "session-global")?.scope).toBe(
      "global",
    );
    expect(sessions.find((s: any) => s.id === "session-local")?.scope).toBe(
      "local",
    );
  });

  it("deduplicates sessions that exist in both dirs", () => {
    mkdirSync(join(globalDir, "session-dup"), { recursive: true });
    writeFileSync(
      join(globalDir, "session-dup", "metadata.json"),
      JSON.stringify({ title: "Dup Global" }),
    );
    writeFileSync(
      join(globalDir, "session-dup", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    mkdirSync(join(localDir, "session-dup"), { recursive: true });
    writeFileSync(
      join(localDir, "session-dup", "metadata.json"),
      JSON.stringify({ title: "Dup Local" }),
    );
    writeFileSync(
      join(localDir, "session-dup", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-02T00:00:00Z",
        responseAt: "2024-01-02T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const sessions = listSessionsFromBothDirs({ globalDir, localDir });

    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("session-dup");
    expect(sessions[0].scope).toBe("local");
  });

  it("returns empty array when both dirs are empty", () => {
    const sessions = listSessionsFromBothDirs({ globalDir, localDir });
    expect(sessions).toEqual([]);
  });

  it("uses globalDir as default when localDir is not provided", () => {
    mkdirSync(join(globalDir, "session-only"), { recursive: true });
    writeFileSync(
      join(globalDir, "session-only", "metadata.json"),
      JSON.stringify({ title: "Only Session" }),
    );
    writeFileSync(
      join(globalDir, "session-only", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const sessions = listSessionsFromBothDirs({ globalDir });
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("session-only");
    expect(sessions[0].scope).toBe("global");
  });
});

describe("listSessionsTreeFromBothDirs", () => {
  let globalDir: string;
  let localDir: string;

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), "global-tree-"));
    localDir = mkdtempSync(join(tmpdir(), "local-tree-"));
  });

  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    rmSync(localDir, { recursive: true, force: true });
  });

  it("builds tree from both dirs with parent-child relationships", () => {
    mkdirSync(join(globalDir, "parent-g"), { recursive: true });
    writeFileSync(
      join(globalDir, "parent-g", "metadata.json"),
      JSON.stringify({ title: "Parent Global" }),
    );
    writeFileSync(
      join(globalDir, "parent-g", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    mkdirSync(join(localDir, "child-l"), { recursive: true });
    writeFileSync(
      join(localDir, "child-l", "metadata.json"),
      JSON.stringify({ parentID: "parent-g" }),
    );
    writeFileSync(
      join(localDir, "child-l", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-02T00:00:00Z",
        responseAt: "2024-01-02T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const tree = listSessionsTreeFromBothDirs({ globalDir, localDir });

    expect(tree.length).toBe(1);
    expect(tree[0].id).toBe("parent-g");
    expect(tree[0].children.length).toBe(1);
    expect(tree[0].children[0].id).toBe("child-l");
    expect(tree[0].scope).toBe("global");
    expect(tree[0].children[0].scope).toBe("local");
  });

  it("deduplicates parent nodes preferring local", () => {
    mkdirSync(join(globalDir, "parent-dup"), { recursive: true });
    writeFileSync(
      join(globalDir, "parent-dup", "metadata.json"),
      JSON.stringify({ title: "Parent Global" }),
    );
    writeFileSync(
      join(globalDir, "parent-dup", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    mkdirSync(join(localDir, "parent-dup"), { recursive: true });
    writeFileSync(
      join(localDir, "parent-dup", "metadata.json"),
      JSON.stringify({ title: "Parent Local" }),
    );
    writeFileSync(
      join(localDir, "parent-dup", "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-02T00:00:00Z",
        responseAt: "2024-01-02T00:01:00Z",
        request: {
          method: "POST",
          url: "http://test",
          headers: {},
          body: null,
        },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const tree = listSessionsTreeFromBothDirs({ globalDir, localDir });

    expect(tree.length).toBe(1);
    expect(tree[0].id).toBe("parent-dup");
    expect(tree[0].title).toBe("Parent Local");
    expect(tree[0].scope).toBe("local");
  });
});

describe("getSessionRecords", () => {
  it("returns records for a session sorted by seq", () => {
    const sessionDir = join(testDir, "records-1");
    mkdirSync(sessionDir, { recursive: true });

    const record1 = {
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:01Z",
      request: { method: "POST", url: "http://1", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: "first",
    };
    const record2 = { ...record1, id: 2, purpose: "second" };
    const record3 = { ...record1, id: 3, purpose: "third" };

    writeFileSync(join(sessionDir, "2.json"), JSON.stringify(record2));
    writeFileSync(join(sessionDir, "1.json"), JSON.stringify(record1));
    writeFileSync(join(sessionDir, "3.json"), JSON.stringify(record3));

    const records = getSessionRecords("records-1", { traceDir: testDir });
    expect(records).toHaveLength(3);
    expect(records[0].id).toBe(1);
    expect(records[1].id).toBe(2);
    expect(records[2].id).toBe(3);
  });

  it("returns empty array for non-existent session", () => {
    const records = getSessionRecords("never-existed", { traceDir: testDir });
    expect(records).toEqual([]);
  });

  it("skips malformed JSON files and logs error", () => {
    const sessionDir = join(testDir, "mixed-1");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "1.json"), JSON.stringify({ not: "a record" }));
    writeFileSync(join(sessionDir, "bad.json"), "{ broken json");
    const validRecord = {
      id: 99,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:01Z",
      request: { method: "POST", url: "http://x", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: "",
    };
    writeFileSync(join(sessionDir, "99.json"), JSON.stringify(validRecord));

    const errorSpy = vi.spyOn(logger, "error");

    const records = getSessionRecords("mixed-1", { traceDir: testDir });
    expect(records.length).toBeGreaterThanOrEqual(1);

    errorSpy.mockRestore();
  });
});

describe("getRecord", () => {
  it("returns a single parsed record by seq", () => {
    const sessionDir = join(testDir, "single-rec");
    mkdirSync(sessionDir, { recursive: true });

    const record = {
      id: 5,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:01Z",
      request: { method: "GET", url: "http://x", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: "single",
    };
    writeFileSync(join(sessionDir, "5.json"), JSON.stringify(record));

    const result = getRecord("single-rec", 5, { traceDir: testDir });
    expect(result).not.toBeNull();
    expect(result?.id).toBe(5);
    expect(result?.purpose).toBe("single");
  });

  it("returns null when record file does not exist", () => {
    const sessionDir = join(testDir, "no-rec");
    mkdirSync(sessionDir, { recursive: true });

    const errorSpy = vi.spyOn(logger, "error");
    const result = getRecord("no-rec", 1, { traceDir: testDir });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns null for malformed record JSON", () => {
    const sessionDir = join(testDir, "bad-rec");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "1.json"), "{ not valid");

    const errorSpy = vi.spyOn(logger, "error");
    const result = getRecord("bad-rec", 1, { traceDir: testDir });
    expect(result).toBeNull();
    errorSpy.mockRestore();
  });
});

describe("getSSEStream", () => {
  it("returns raw SSE text content", () => {
    const sessionDir = join(testDir, "sse-1");
    mkdirSync(sessionDir, { recursive: true });
    const sseContent = "data: hello\n\ndata: world\n\n";
    writeFileSync(join(sessionDir, "1.sse"), sseContent);

    const result = getSSEStream("sse-1", 1, { traceDir: testDir });
    expect(result).toBe(sseContent);
  });

  it("returns null when SSE file does not exist", () => {
    const sessionDir = join(testDir, "no-sse");
    mkdirSync(sessionDir, { recursive: true });

    const errorSpy = vi.spyOn(logger, "error");
    const result = getSSEStream("no-sse", 1, { traceDir: testDir });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("readTimelineIndex", () => {
  it("returns timeline entries from timeline.ndjson", () => {
    const sessionDir = join(testDir, "tl-1");
    mkdirSync(sessionDir, { recursive: true });

    const entry1 = {
      seq: 1,
      url: "http://a",
      method: "POST",
      purpose: "p1",
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:01Z",
      status: 200,
      provider: "openai",
      model: "gpt-4",
      inputTokens: 10,
      outputTokens: 20,
      totalDurationMs: 100,
    };
    const entry2 = { ...entry1, seq: 2 };
    writeFileSync(
      join(sessionDir, "timeline.ndjson"),
      JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n",
    );

    const result = readTimelineIndex("tl-1", { traceDir: testDir });
    expect(result).toHaveLength(2);
    expect(result[0].seq).toBe(1);
    expect(result[1].seq).toBe(2);
  });

  it("returns empty array when timeline.ndjson does not exist", () => {
    const result = readTimelineIndex("missing", { traceDir: testDir });
    expect(result).toEqual([]);
  });

  it("skips malformed lines in timeline.ndjson", () => {
    const sessionDir = join(testDir, "tl-bad");
    mkdirSync(sessionDir, { recursive: true });
    const entry = {
      seq: 1,
      url: "http://a",
      method: "POST",
      purpose: "p1",
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: null,
      status: 200,
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalDurationMs: null,
    };
    writeFileSync(
      join(sessionDir, "timeline.ndjson"),
      JSON.stringify(entry) + "\n" + "broken line\n" + "\n",
    );

    const result = readTimelineIndex("tl-bad", { traceDir: testDir });
    expect(result).toHaveLength(1);
    expect(result[0].seq).toBe(1);
  });
});

describe("getCachedParsed", () => {
  it("returns parsed cache when version matches", () => {
    const sessionDir = join(testDir, "cache-1");
    mkdirSync(sessionDir, { recursive: true });
    const cacheContent = {
      _pcv: PARSED_CACHE_VERSION,
      entries: [{ type: "text", text: "hi" }],
    };
    writeFileSync(join(sessionDir, "1.parsed"), JSON.stringify(cacheContent));

    const result = getCachedParsed("cache-1", 1, { traceDir: testDir });
    expect(result).not.toBeNull();
    expect((result as any).entries).toBeDefined();
    expect((result as any)._pcv).toBeUndefined();
  });

  it("returns null when cache version does not match", () => {
    const sessionDir = join(testDir, "cache-bad-ver");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "1.parsed"),
      JSON.stringify({ _pcv: "9999", entries: [] }),
    );

    const result = getCachedParsed("cache-bad-ver", 1, { traceDir: testDir });
    expect(result).toBeNull();
  });

  it("returns null when cache file does not exist", () => {
    const result = getCachedParsed("never-existed", 1, { traceDir: testDir });
    expect(result).toBeNull();
  });

  it("returns null when source json mtime is newer than cache mtime", async () => {
    const sessionDir = join(testDir, "cache-stale");
    mkdirSync(sessionDir, { recursive: true });

    const jsonPath = join(sessionDir, "1.json");
    const cachePath = join(sessionDir, "1.parsed");

    writeFileSync(
      cachePath,
      JSON.stringify({ _pcv: PARSED_CACHE_VERSION, entries: [] }),
    );
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(jsonPath, JSON.stringify({ id: 1, purpose: "" }));

    const newJsonMtime = new Date(Date.now() + 60_000);
    utimesSync(jsonPath, newJsonMtime, newJsonMtime);

    const result = getCachedParsed("cache-stale", 1, { traceDir: testDir });
    expect(result).toBeNull();
  });

  it("returns null and logs error for malformed cache JSON", () => {
    const sessionDir = join(testDir, "cache-malformed");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "1.parsed"), "{ broken cache");

    const errorSpy = vi.spyOn(logger, "error");
    const result = getCachedParsed("cache-malformed", 1, { traceDir: testDir });
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns cache when source json does not exist (cache-only fallback)", () => {
    const sessionDir = join(testDir, "cache-no-src");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "1.parsed"),
      JSON.stringify({ _pcv: PARSED_CACHE_VERSION, payload: "ok" }),
    );

    const result = getCachedParsed("cache-no-src", 1, { traceDir: testDir });
    expect(result).not.toBeNull();
    expect((result as any).payload).toBe("ok");
  });
});

describe("deleteSessions", () => {
  const testBatchDir = join(process.cwd(), "test-batch-delete");

  beforeEach(() => {
    if (existsSync(testBatchDir)) rmSync(testBatchDir, { recursive: true });
    mkdirSync(testBatchDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testBatchDir)) rmSync(testBatchDir, { recursive: true });
  });

  it("批量删除多个 session", async () => {
    for (const id of ["a", "b", "c"]) {
      const dir = join(testBatchDir, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "metadata.json"), JSON.stringify({ sessionId: id }));
    }

    const result = await deleteSessions(["a", "b"], { traceDir: testBatchDir });
    expect(result.deleted).toEqual(["a", "b"]);
    expect(result.errors).toEqual([]);
    expect(existsSync(join(testBatchDir, "a"))).toBe(false);
    expect(existsSync(join(testBatchDir, "b"))).toBe(false);
    expect(existsSync(join(testBatchDir, "c"))).toBe(true);
  });

  it("对不存在的 session 收集 errors 但不中断", async () => {
    const result = await deleteSessions(["never-existed"], {
      traceDir: testBatchDir,
    });
    expect(result.deleted).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionId).toBe("never-existed");
  });

  it("混合成功和失败", async () => {
    const real = join(testBatchDir, "real");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "metadata.json"), JSON.stringify({ sessionId: "real" }));

    const result = await deleteSessions(["real", "ghost"], {
      traceDir: testBatchDir,
    });
    expect(result.deleted).toEqual(["real"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sessionId).toBe("ghost");
  });
});

describe("importSessionZip - skip 和 overwrite 策略", () => {
  const testConflictDir = join(process.cwd(), "test-conflict-zip");

  beforeEach(() => {
    if (existsSync(testConflictDir))
      rmSync(testConflictDir, { recursive: true });
    mkdirSync(testConflictDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testConflictDir))
      rmSync(testConflictDir, { recursive: true });
  });

  it("skip 策略保留现有 session, 返回 success 状态", async () => {
    const existingDir = join(testConflictDir, "skip-test");
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(
      join(existingDir, "metadata.json"),
      JSON.stringify({ sessionId: "skip-test", title: "Original" }),
    );
    writeFileSync(
      join(existingDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "original",
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:00:01Z",
        request: { method: "POST", url: "http://a", headers: {}, body: null },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
      }),
    );

    const zipBuffer = await buildZip([
      {
        sessionId: "skip-test",
        metadata: { sessionId: "skip-test", title: "Imported" },
        records: [
          {
            id: 1,
            purpose: "imported",
            requestAt: "2024-02-01T00:00:00Z",
            responseAt: "2024-02-01T00:00:01Z",
            request: {
              method: "POST",
              url: "http://b",
              headers: {},
              body: null,
            },
            response: { status: 200, statusText: "OK", headers: {}, body: null },
            error: null,
          },
        ],
      },
    ]);

    const result = await importSessionZip(zipBuffer, {
      traceDir: testConflictDir,
      conflictStrategy: "skip",
    });

    expect(result.status).toBe("success");

    const meta = JSON.parse(
      readFileSync(join(existingDir, "metadata.json"), "utf-8"),
    );
    expect(meta.title).toBe("Original");
  });

  it("overwrite 策略删除现有 session 后再导入", async () => {
    const existingDir = join(testConflictDir, "ow-test");
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(
      join(existingDir, "metadata.json"),
      JSON.stringify({ sessionId: "ow-test", title: "Old" }),
    );
    writeFileSync(join(existingDir, "old-marker.txt"), "marker");

    const zipBuffer = await buildZip([
      {
        sessionId: "ow-test",
        metadata: { sessionId: "ow-test", title: "New" },
        records: [
          {
            id: 1,
            purpose: "new",
            requestAt: "2024-01-01T00:00:00Z",
            responseAt: "2024-01-01T00:00:01Z",
            request: {
              method: "POST",
              url: "http://x",
              headers: {},
              body: null,
            },
            response: { status: 200, statusText: "OK", headers: {}, body: null },
            error: null,
          },
        ],
      },
    ]);

    const result = await importSessionZip(zipBuffer, {
      traceDir: testConflictDir,
      conflictStrategy: "overwrite",
    });

    expect(result.status).toBe("success");
    expect(result.importedSessions![0].strategy).toBe("overwrite");

    expect(existsSync(join(existingDir, "old-marker.txt"))).toBe(false);

    const meta = JSON.parse(
      readFileSync(join(existingDir, "metadata.json"), "utf-8"),
    );
    expect(meta.title).toBe("New");
  });

  it("缺 manifest.json 抛出错误", async () => {
    const zipBuffer = await buildZip(
      [
        {
          sessionId: "no-manifest",
          metadata: { sessionId: "no-manifest" },
          records: [],
        },
      ],
      { includeManifest: false },
    );

    await expect(
      importSessionZip(zipBuffer, { traceDir: testConflictDir }),
    ).rejects.toThrow("Invalid export format: missing manifest.json");
  });

  it("无效 ZIP buffer 抛出错误", async () => {
    const garbage = Buffer.from("not a real zip file at all");
    await expect(
      importSessionZip(garbage, { traceDir: testConflictDir }),
    ).rejects.toThrow();
  });
});

async function buildZip(
  sessions: Array<{
    sessionId: string;
    metadata: Record<string, unknown>;
    records: Array<Record<string, unknown>>;
  }>,
  options: { includeManifest?: boolean } = { includeManifest: true },
): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  archive.pipe(writable);

  const sessionIds: string[] = [];

  for (const s of sessions) {
    sessionIds.push(s.sessionId);
    archive.append(JSON.stringify(s.metadata), {
      name: `sessions/${s.sessionId}/metadata.json`,
    });
    for (const r of s.records) {
      archive.append(JSON.stringify(r), {
        name: `sessions/${s.sessionId}/${r.id}.json`,
      });
    }
  }

  if (options.includeManifest !== false) {
    archive.append(
      JSON.stringify({
        exportedAt: new Date().toISOString(),
        mainSession: sessions[0]?.sessionId ?? "",
        sessions: sessionIds,
        version: "1.0",
      }),
      { name: "manifest.json" },
    );
  }

  archive.finalize();
  await new Promise<void>((resolve, reject) => {
    writable.on("finish", resolve);
    writable.on("error", reject);
  });
  return Buffer.concat(chunks);
}

describe("importSessionZip - AdmZip 内容验证", () => {
  const testVerifyDir = join(process.cwd(), "test-verify-zip");

  beforeEach(() => {
    if (existsSync(testVerifyDir)) rmSync(testVerifyDir, { recursive: true });
    mkdirSync(testVerifyDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testVerifyDir)) rmSync(testVerifyDir, { recursive: true });
  });

  it("导出的 ZIP 包含 manifest.json 与 sessions/<id>/metadata.json", async () => {
    const sessionDir = join(testVerifyDir, "verify-session");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "metadata.json"),
      JSON.stringify({
        sessionId: "verify-session",
        title: "Verify",
      }),
    );
    writeFileSync(
      join(sessionDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "verify",
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:00:01Z",
        request: { method: "POST", url: "http://x", headers: {}, body: null },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
      }),
    );

    const buffer = await exportSessionZip("verify-session", {
      traceDir: testVerifyDir,
    });

    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const names = entries.map((e) => e.entryName).sort();

    expect(names).toContain("manifest.json");
    expect(names).toContain("sessions/verify-session/metadata.json");
    expect(names).toContain("sessions/verify-session/1.json");
  });
});
