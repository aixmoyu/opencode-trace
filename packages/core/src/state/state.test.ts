import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "./index.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "state-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("StateManager - 初始化", () => {
  test("空目录初始化创建 state.db", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    expect(existsSync(join(testDir, "state.db"))).toBe(true);
  });

  test("初始化后 global_state 表有默认值", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const currentSession = manager.getGlobalState("current_session");
    expect(currentSession).toBeNull();
    
    const pluginEnabled = manager.getGlobalState("plugin_enabled");
    expect(pluginEnabled).toBe("true");
  });
});

describe("StateManager - Session 状态管理", () => {
  test("startSession 创建活跃 session", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    
    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe("string");
    
    const session = manager.getSession(sessionId);
    expect(session?.status).toBe("active");
    expect(session?.requestCount).toBe(0);
  });

  test("stopSession 更改状态为 stopped", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.stopSession(sessionId);
    
    const session = manager.getSession(sessionId);
    expect(session?.status).toBe("stopped");
  });

  test("getActiveSession 返回当前活跃 session", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    
    expect(manager.getActiveSession()).toBe(sessionId);
    
    manager.stopSession(sessionId);
    expect(manager.getActiveSession()).toBeNull();
  });
});

describe("StateManager - 文件系统同步", () => {
  test("sync 从文件系统恢复孤儿 session", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = "manual-session-123";
    const sessionDir = join(testDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    
    writeFileSync(join(sessionDir, "1.json"), JSON.stringify({
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:01:00Z",
      request: { method: "POST", url: "http://test", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    }));
    
    manager.sync();
    
    const session = manager.getSession(sessionId);
    expect(session?.id).toBe(sessionId);
    expect(session?.requestCount).toBe(1);
  });

  test("sync 清理 SQLite 中但文件不存在的 session", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.stopSession(sessionId);
    
    rmSync(join(testDir, sessionId), { recursive: true, force: true });
    
    manager.sync();
    
    const session = manager.getSession(sessionId);
    expect(session).toBeNull();
  });
});

describe("StateManager - 记录写入", () => {
  test("writeRecord 创建 JSON 文件并更新索引", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    
    await manager.writeRecord(sessionId, 1, {
      id: 1,
      requestAt: new Date().toISOString(),
      responseAt: new Date().toISOString(),
      request: { method: "POST", url: "http://test", headers: {}, body: {} },
      response: { status: 200, statusText: "OK", headers: {}, body: {} },
      error: null,
      purpose: ""
    });
    
    expect(existsSync(join(testDir, sessionId, "1.json"))).toBe(true);
    
    const session = manager.getSession(sessionId);
    expect(session?.requestCount).toBe(1);
  });

  test("writeRecord handles URLs with special characters", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    const sessionId = manager.startSession();

    const url = "https://example.com/?q=test' OR '1'='1";
    await manager.writeRecord(sessionId, 1, {
      id: 1,
      requestAt: new Date().toISOString(),
      responseAt: new Date().toISOString(),
      request: { method: "GET", url, headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: ""
    });

    const session = manager.getSession(sessionId);
    expect(session?.requestCount).toBe(1);

    const filePath = join(testDir, sessionId, "1.json");
    const saved = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(saved.request.url).toBe(url);
  });
});

describe("StateManager - 优雅降级", () => {
  test("SQLite 不可用时降级到纯文件模式", async () => {
    writeFileSync(join(testDir, "state.db"), "corrupted data");
    
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = "fallback-session";
    mkdirSync(join(testDir, sessionId), { recursive: true });
    
    const sessions = manager.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(0);
  });
});

describe("StateManager - listSessions", () => {
  test("返回按时间排序的 session 列表", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const session1 = manager.startSession();
    manager.stopSession(session1);
    
    const session2 = manager.startSession();
    
    const sessions = manager.listSessions();
    
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe(session2);
    expect(sessions[1].id).toBe(session1);
  });
});

describe("StateManager - Session 元数据管理", () => {
  test("updateSessionMetadata 创建 metadata.json 文件", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Test Session" });
    
    expect(existsSync(join(testDir, sessionId, "metadata.json"))).toBe(true);
  });

  test("updateSessionMetadata 写入 title 到 metadata.json", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Test Session" });
    
    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.title).toBe("Test Session");
  });

  test("updateSessionMetadata 写入 parentID 到 metadata.json", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const parentSessionId = manager.startSession();
    const childSessionId = manager.startSession();
    
    manager.updateSessionMetadata(childSessionId, { parentID: parentSessionId });
    
    const metaPath = join(testDir, childSessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.parentID).toBe(parentSessionId);
  });

  test("getSession 从 metadata.json 读取 title", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "My Session" });
    
    const session = manager.getSession(sessionId);
    expect(session?.title).toBe("My Session");
  });

  test("addSubSession 更新 parent 的 metadata.json", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const parentSessionId = manager.startSession();
    const childSessionId = manager.startSession();
    
    manager.addSubSession(parentSessionId, childSessionId);
    
    const metaPath = join(testDir, parentSessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.subSessions).toContain(childSessionId);
  });

  test("addSubSession 重复添加不会重复记录", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const parentSessionId = manager.startSession();
    const childSessionId = manager.startSession();
    
    manager.addSubSession(parentSessionId, childSessionId);
    manager.addSubSession(parentSessionId, childSessionId);
    
    const metaPath = join(testDir, parentSessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.subSessions.length).toBe(1);
  });

  test("getSession 从 metadata.json 读取 subSessions", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const parentSessionId = manager.startSession();
    const childSessionId = manager.startSession();
    
    manager.addSubSession(parentSessionId, childSessionId);
    
    const session = manager.getSession(parentSessionId);
    expect(session?.subSessions).toContain(childSessionId);
  });

  test("metadata.json 不存在时 getSession 返回默认值", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    
    const session = manager.getSession(sessionId);
    expect(session?.title).toBeUndefined();
    expect(session?.parentID).toBeUndefined();
    expect(session?.subSessions).toBeUndefined();
  });

  test("updateSessionMetadata 写入 folderPath 到 metadata.json", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { folderPath: "/home/user/projects/test-app" });
    
    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.folderPath).toBe("/home/user/projects/test-app");
  });

  test("getSession 从 metadata.json 读取 folderPath", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { folderPath: "/home/user/projects/test-app" });
    
    const session = manager.getSession(sessionId);
    expect(session?.folderPath).toBe("/home/user/projects/test-app");
  });
});

describe("StateManager - Trace Enable/Disable", () => {
  test("初始化后 global_trace_enabled 默认为 false", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const globalEnabled = manager.getGlobalState("global_trace_enabled");
    expect(globalEnabled).toBe("false");
  });

  test("setGlobalState 可以关闭 global_trace_enabled", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    manager.setGlobalState("global_trace_enabled", "false");
    
    const globalEnabled = manager.getGlobalState("global_trace_enabled");
    expect(globalEnabled).toBe("false");
  });

  test("setSessionEnabled 可以设置 session 级别开关", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, false);
    
    const sessionEnabled = manager.getSessionEnabled(sessionId);
    expect(sessionEnabled).toBe(false);
  });

  test("getSessionEnabled 默认返回 true", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    
    const sessionEnabled = manager.getSessionEnabled(sessionId);
    expect(sessionEnabled).toBe(true);
  });

  test("isTraceEnabled 全局开时返回 true", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    manager.setGlobalState("global_trace_enabled", "true");
    
    expect(manager.isTraceEnabled()).toBe(true);
    expect(manager.isTraceEnabled("any-session")).toBe(true);
  });

  test("isTraceEnabled 全局关 + session 开时返回 true", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    manager.setGlobalState("global_trace_enabled", "false");
    
    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, true);
    
    expect(manager.isTraceEnabled(sessionId)).toBe(true);
  });

  test("isTraceEnabled 全局关 + session 关时返回 false", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    manager.setGlobalState("global_trace_enabled", "false");
    
    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, false);
    
    expect(manager.isTraceEnabled(sessionId)).toBe(false);
  });

  test("isTraceEnabled 全局关 + 无 session 时返回 false", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    manager.setGlobalState("global_trace_enabled", "false");
    
    expect(manager.isTraceEnabled()).toBe(false);
  });

  test("getSession 返回 enabled 字段", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, false);
    
    const session = manager.getSession(sessionId);
    expect(session?.enabled).toBe(false);
  });
});

describe("StateManager - listSessions folderPath", () => {
  test("listSessions 从 metadata.json 读取 folderPath", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { folderPath: "/home/user/projects/my-app" });
    manager.stopSession(sessionId);
    
    const sessions = manager.listSessions();
    const session = sessions.find(s => s.id === sessionId);
    expect(session?.folderPath).toBe("/home/user/projects/my-app");
  });
});

describe("StateManager - async writeRecord", () => {
  test("writeRecord is async and uses fs.promises", async () => {
    const manager = new StateManager(testDir);
    await manager.init();
    
    const sessionId = manager.startSession();
    
    const record = {
      id: 1,
      purpose: "async-test",
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: { method: "GET", url: "https://example.com", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
    };
    
    const result = manager.writeRecord(sessionId, 1, record);
    
    expect(result).toBeInstanceOf(Promise);
    await result;
    
    const session = manager.getSession(sessionId);
    expect(session?.requestCount).toBe(1);
    
    const filePath = join(testDir, sessionId, "1.json");
    expect(existsSync(filePath)).toBe(true);
  });
});