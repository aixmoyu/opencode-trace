/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { listSessionsTree, listSessions, exportSessionZip, importSessionZip, deleteSession } from "./index.js";
import archiver from "archiver";
import { logger } from "../logger.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "store-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("listSessionsTree", () => {
  it("returns empty array when trace directory does not exist", () => {
    const nonExistentDir = join(tmpdir(), "non-existent-trace-dir-" + Date.now());
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

    writeFileSync(join(testDir, "parent-1", "metadata.json"), JSON.stringify({ title: "Parent 1" }));
    writeFileSync(join(testDir, "parent-1", "1.json"), JSON.stringify({
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-02T00:00:00Z",
      request: { method: "POST", url: "http://test", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    }));

    writeFileSync(join(testDir, "child-1", "metadata.json"), JSON.stringify({ parentID: "parent-1" }));
    writeFileSync(join(testDir, "child-1", "1.json"), JSON.stringify({
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:00Z",
      request: { method: "POST", url: "http://test", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    }));

    writeFileSync(join(testDir, "child-2", "metadata.json"), JSON.stringify({ parentID: "parent-1" }));
    writeFileSync(join(testDir, "child-2", "1.json"), JSON.stringify({
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:00Z",
      request: { method: "POST", url: "http://test", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    }));

    writeFileSync(join(testDir, "parent-2", "metadata.json"), JSON.stringify({ title: "Parent 2" }));
    writeFileSync(join(testDir, "parent-2", "1.json"), JSON.stringify({
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-03T00:00:00Z",
      request: { method: "POST", url: "http://test", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    }));

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

    writeFileSync(join(testDir, "session-1", "metadata.json"), JSON.stringify({ title: "Session 1" }));
    writeFileSync(join(testDir, "session-1", "1.json"), JSON.stringify({
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-02T00:00:00Z",
      request: { method: "POST", url: "http://test", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    }));

    writeFileSync(join(testDir, "session-2", "metadata.json"), JSON.stringify({ title: "Session 2" }));
    writeFileSync(join(testDir, "session-2", "1.json"), JSON.stringify({
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-03T00:00:00Z",
      request: { method: "POST", url: "http://test", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    }));

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
      JSON.stringify({ sessionId: "test-session-1", title: "Test Session", subSessions: [] })
    );
    
    // Create trace records
    writeFileSync(
      join(testSessionDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "test",
        requestAt: "2025-04-30T10:00:00Z",
        responseAt: "2025-04-30T10:01:00Z",
        request: { method: "POST", url: "http://test.com", headers: {}, body: {} },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null
      })
    );
    
    writeFileSync(
      join(testSessionDir, "1.sse"),
      "data: test stream\n\n"
    );
  });

  afterEach(() => {
    if (existsSync(testTraceDir)) rmSync(testTraceDir, { recursive: true });
  });

  it("should export single session without children", async () => {
    const stream = await exportSessionZip("test-session-1", { traceDir: testTraceDir });
    
    // Collect stream data into buffer
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    
    stream.pipe(writable);
    
    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });
    
    const buffer = Buffer.concat(chunks);
    expect(buffer.length).toBeGreaterThan(0);
    
    // Verify it's a valid ZIP by checking magic bytes
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4B); // 'K'
  });

  it("should throw error if session not found", async () => {
    await expect(
      exportSessionZip("non-existent-session", { traceDir: testTraceDir })
    ).rejects.toThrow("Session not found");
  });

  it("should export session with children", async () => {
    // Create child session
    const childSessionDir = join(testTraceDir, "test-child-1");
    mkdirSync(childSessionDir, { recursive: true });
    
    writeFileSync(
      join(childSessionDir, "metadata.json"),
      JSON.stringify({ sessionId: "test-child-1", title: "Child Session", parentID: "test-session-1" })
    );
    
    writeFileSync(
      join(childSessionDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "child test",
        requestAt: "2025-04-30T11:00:00Z",
        responseAt: "2025-04-30T11:01:00Z",
        request: { method: "POST", url: "http://child.com", headers: {}, body: {} },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null
      })
    );
    
    // Update parent metadata to include subSessions
    writeFileSync(
      join(testSessionDir, "metadata.json"),
      JSON.stringify({ sessionId: "test-session-1", title: "Test Session", subSessions: ["test-child-1"] })
    );
    
    const stream = await exportSessionZip("test-session-1", { traceDir: testTraceDir });
    
    // Collect stream data
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    
    stream.pipe(writable);
    
    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });
    
    const buffer = Buffer.concat(chunks);
    expect(buffer.length).toBeGreaterThan(0);
    
    // Verify ZIP magic bytes
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4B); // 'K'
    
    // Verify ZIP contains both sessions by checking size is larger
    // (More comprehensive test would extract and verify contents)
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
      }
    });
    
    archive.pipe(writable);
    
    archive.append(
      JSON.stringify({ sessionId: "import-test-1", title: "Imported Session" }),
      { name: "sessions/import-test-1/metadata.json" }
    );
    
    archive.append(
      JSON.stringify({
        id: 1,
        purpose: "import test",
        requestAt: "2025-04-30T12:00:00Z",
        responseAt: "2025-04-30T12:01:00Z",
        request: { method: "POST", url: "http://import.com", headers: {}, body: {} },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null
      }),
      { name: "sessions/import-test-1/1.json" }
    );
    
    archive.append(
      JSON.stringify({
        exportedAt: "2025-04-30T12:00:00Z",
        mainSession: "import-test-1",
        sessions: ["import-test-1"],
        version: "1.0"
      }),
      { name: "manifest.json" }
    );
    
    archive.finalize();
    
    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });
    
    const zipBuffer = Buffer.concat(chunks);
    
    const result = await importSessionZip(zipBuffer, { traceDir: testImportDir });
    
    expect(result.status).toBe("success");
    expect(result.importedSessions).toHaveLength(1);
    expect(result.importedSessions![0].sessionId).toBe("import-test-1");
    
    const importedMetadataPath = join(testImportDir, "import-test-1", "metadata.json");
    expect(existsSync(importedMetadataPath)).toBe(true);
  });

  it("should detect conflicts with prompt strategy", async () => {
    const existingDir = join(testImportDir, "conflict-test-1");
    mkdirSync(existingDir, { recursive: true });
    
    writeFileSync(
      join(existingDir, "metadata.json"),
      JSON.stringify({ sessionId: "conflict-test-1", title: "Existing" })
    );
    
    writeFileSync(
      join(existingDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "existing",
        requestAt: "2025-04-30T10:00:00Z",
        responseAt: "2025-04-30T10:01:00Z",
        request: { method: "POST", url: "http://existing.com", headers: {}, body: {} },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null
      })
    );
    
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    
    archive.pipe(writable);
    
    archive.append(
      JSON.stringify({ sessionId: "conflict-test-1", title: "Imported" }),
      { name: "sessions/conflict-test-1/metadata.json" }
    );
    
    archive.append(
      JSON.stringify({
        id: 1,
        purpose: "imported",
        requestAt: "2025-04-30T12:00:00Z",
        responseAt: "2025-04-30T12:01:00Z",
        request: { method: "POST", url: "http://imported.com", headers: {}, body: {} },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null
      }),
      { name: "sessions/conflict-test-1/1.json" }
    );
    
    archive.append(
      JSON.stringify({
        exportedAt: "2025-04-30T12:00:00Z",
        mainSession: "conflict-test-1",
        sessions: ["conflict-test-1"],
        version: "1.0"
      }),
      { name: "manifest.json" }
    );
    
    archive.finalize();
    
    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });
    
    const zipBuffer = Buffer.concat(chunks);
    
    const result = await importSessionZip(zipBuffer, { 
      traceDir: testImportDir, 
      conflictStrategy: "prompt" 
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
      JSON.stringify({ sessionId: "rename-test-1", title: "Existing" })
    );
    
    writeFileSync(
      join(existingDir, "1.json"),
      JSON.stringify({
        id: 1,
        purpose: "existing",
        requestAt: "2025-04-30T10:00:00Z",
        responseAt: "2025-04-30T10:01:00Z",
        request: { method: "POST", url: "http://existing.com", headers: {}, body: {} },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null
      })
    );
    
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    
    archive.pipe(writable);
    
    archive.append(
      JSON.stringify({ sessionId: "rename-test-1", title: "Imported" }),
      { name: "sessions/rename-test-1/metadata.json" }
    );
    
    archive.append(
      JSON.stringify({
        id: 1,
        purpose: "imported",
        requestAt: "2025-04-30T12:00:00Z",
        responseAt: "2025-04-30T12:01:00Z",
        request: { method: "POST", url: "http://imported.com", headers: {}, body: {} },
        response: { status: 200, statusText: "OK", headers: {}, body: {} },
        error: null
      }),
      { name: "sessions/rename-test-1/1.json" }
    );
    
    archive.append(
      JSON.stringify({
        exportedAt: "2025-04-30T12:00:00Z",
        mainSession: "rename-test-1",
        sessions: ["rename-test-1"],
        version: "1.0"
      }),
      { name: "manifest.json" }
    );
    
    archive.finalize();
    
    await new Promise<void>((resolve, reject) => {
      writable.on("finish", resolve);
      writable.on("error", reject);
    });
    
    const zipBuffer = Buffer.concat(chunks);
    
    const result = await importSessionZip(zipBuffer, { 
      traceDir: testImportDir, 
      conflictStrategy: "rename" 
    });
    
    expect(result.status).toBe("success");
    expect(result.importedSessions).toHaveLength(1);
    expect(result.importedSessions![0].sessionId).toBe("rename-test-1");
    expect(result.importedSessions![0].newId).toBe("rename-test-1-imported");
    
    expect(existsSync(join(testImportDir, "rename-test-1-imported"))).toBe(true);
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
    writeFileSync(join(sessionDir, "metadata.json"), JSON.stringify({ sessionId: "delete-test-1" }));
    writeFileSync(join(sessionDir, "1.json"), JSON.stringify({ id: 1 }));
    
    await deleteSession("delete-test-1", { traceDir: testDeleteDir });
    
    expect(existsSync(sessionDir)).toBe(false);
  });

  it("should delete parent with children", async () => {
    const parentDir = join(testDeleteDir, "parent-session");
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(join(parentDir, "metadata.json"), JSON.stringify({
      sessionId: "parent-session",
      subSessions: ["child-1", "child-2"]
    }));
    writeFileSync(join(parentDir, "1.json"), JSON.stringify({ id: 1 }));
    
    const child1Dir = join(testDeleteDir, "child-1");
    mkdirSync(child1Dir, { recursive: true });
    writeFileSync(join(child1Dir, "metadata.json"), JSON.stringify({
      sessionId: "child-1",
      parentID: "parent-session"
    }));
    
    const child2Dir = join(testDeleteDir, "child-2");
    mkdirSync(child2Dir, { recursive: true });
    writeFileSync(join(child2Dir, "metadata.json"), JSON.stringify({
      sessionId: "child-2",
      parentID: "parent-session"
    }));
    
    await deleteSession("parent-session", { traceDir: testDeleteDir });
    
    expect(existsSync(parentDir)).toBe(false);
    expect(existsSync(child1Dir)).toBe(false);
    expect(existsSync(child2Dir)).toBe(false);
  });

  it("should throw error if session not found", async () => {
    await expect(
      deleteSession("non-existent", { traceDir: testDeleteDir })
    ).rejects.toThrow("Session not found");
  });
});
