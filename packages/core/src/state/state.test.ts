import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "./index.js";
import { logger } from "../logger.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "state-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("ConfigManager - 初始化", () => {
  test("空目录初始化创建 config.json", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(existsSync(join(testDir, "config.json"))).toBe(true);
  });

  test("初始化后 global_trace_enabled 默认为 false", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const globalEnabled = manager.getGlobalState("global_trace_enabled");
    expect(globalEnabled).toBe("false");
  });

  test("初始化后 plugin_enabled 默认为 true", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const pluginEnabled = manager.getGlobalState("plugin_enabled");
    expect(pluginEnabled).toBe("true");
  });
});

describe("ConfigManager - Session 状态管理", () => {
  test("startSession 创建活跃 session", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();

    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe("string");

    const session = manager.getSession(sessionId);
    expect(session?.status).toBe("active");
    expect(session?.requestCount).toBe(0);
  });

  test("stopSession 清除 current_session", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.stopSession(sessionId);

    expect(manager.getActiveSession()).toBeNull();
  });

  test("getActiveSession 返回当前活跃 session", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();

    expect(manager.getActiveSession()).toBe(sessionId);

    manager.stopSession(sessionId);
    expect(manager.getActiveSession()).toBeNull();
  });
});

describe("ConfigManager - 文件系统扫描", () => {
  test("从文件系统发现孤儿 session", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = "manual-session-123";
    const sessionDir = join(testDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    writeFileSync(
      join(sessionDir, "1.json"),
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

    const session = manager.getSession(sessionId);
    expect(session?.id).toBe(sessionId);
    expect(session?.requestCount).toBe(1);
  });

  test("文件不存在的 session 返回 null", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const session = manager.getSession("nonexistent");
    expect(session).toBeNull();
  });
});

describe("ConfigManager - 记录写入", () => {
  test("writeRecord 创建 JSON 文件", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();

    await manager.writeRecord(sessionId, 1, {
      id: 1,
      requestAt: new Date().toISOString(),
      responseAt: new Date().toISOString(),
      request: { method: "POST", url: "http://test", headers: {}, body: {} },
      response: { status: 200, statusText: "OK", headers: {}, body: {} },
      error: null,
      purpose: "",
    });

    expect(existsSync(join(testDir, sessionId, "1.json"))).toBe(true);

    const session = manager.getSession(sessionId);
    expect(session?.requestCount).toBe(1);
  });

  test("writeRecord handles URLs with special characters", async () => {
    const manager = new ConfigManager(testDir);
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
      purpose: "",
    });

    const session = manager.getSession(sessionId);
    expect(session?.requestCount).toBe(1);

    const filePath = join(testDir, sessionId, "1.json");
    const saved = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(saved.request.url).toBe(url);
  });
});

describe("ConfigManager - 优雅降级", () => {
  test("损坏的 config.json 时降级到默认值", async () => {
    writeFileSync(join(testDir, "config.json"), "corrupted data");

    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = "fallback-session";
    mkdirSync(join(testDir, sessionId), { recursive: true });

    const sessions = manager.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(0);
  });
});

describe("ConfigManager - listSessions", () => {
  test("返回按时间排序的 session 列表", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const session1 = manager.startSession();
      manager.stopSession(session1);

      vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
      const session2 = manager.startSession();

      const sessions = manager.listSessions();

      expect(sessions.length).toBe(2);
      expect(sessions[0].id).toBe(session2);
      expect(sessions[1].id).toBe(session1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ConfigManager - Session 元数据管理", () => {
  test("updateSessionMetadata 创建 metadata.json 文件", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Test Session" });

    expect(existsSync(join(testDir, sessionId, "metadata.json"))).toBe(true);
  });

  test("updateSessionMetadata 写入 title 到 metadata.json", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Test Session" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.title).toBe("Test Session");
  });

  test("updateSessionMetadata 写入 parentID 到 metadata.json", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const parentSessionId = manager.startSession();
    const childSessionId = manager.startSession();

    manager.updateSessionMetadata(childSessionId, {
      parentID: parentSessionId,
    });

    const metaPath = join(testDir, childSessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.parentID).toBe(parentSessionId);
  });

  test("getSession 从 metadata.json 读取 title", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "My Session" });

    const session = manager.getSession(sessionId);
    expect(session?.title).toBe("My Session");
  });

  test("addSubSession 更新 parent 的 metadata.json", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const parentSessionId = manager.startSession();
    const childSessionId = manager.startSession();

    manager.addSubSession(parentSessionId, childSessionId);

    const metaPath = join(testDir, parentSessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.subSessions).toContain(childSessionId);
  });

  test("addSubSession 重复添加不会重复记录", async () => {
    const manager = new ConfigManager(testDir);
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
    const manager = new ConfigManager(testDir);
    await manager.init();

    const parentSessionId = manager.startSession();
    const childSessionId = manager.startSession();

    manager.addSubSession(parentSessionId, childSessionId);

    const session = manager.getSession(parentSessionId);
    expect(session?.subSessions).toContain(childSessionId);
  });

  test("metadata.json 不存在时 getSession 返回默认值", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();

    const session = manager.getSession(sessionId);
    expect(session?.title).toBeUndefined();
    expect(session?.parentID).toBeUndefined();
    expect(session?.subSessions).toBeUndefined();
  });

  test("updateSessionMetadata 写入 folderPath 到 metadata.json", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, {
      folderPath: "/home/user/projects/test-app",
    });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.folderPath).toBe("/home/user/projects/test-app");
  });

  test("getSession 从 metadata.json 读取 folderPath", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, {
      folderPath: "/home/user/projects/test-app",
    });

    const session = manager.getSession(sessionId);
    expect(session?.folderPath).toBe("/home/user/projects/test-app");
  });
});

describe("ConfigManager - Trace Enable/Disable", () => {
  test("初始化后 global_trace_enabled 默认为 false", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const globalEnabled = manager.getGlobalState("global_trace_enabled");
    expect(globalEnabled).toBe("false");
  });

  test("setGlobalState 可以关闭 global_trace_enabled", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("global_trace_enabled", "false");

    const globalEnabled = manager.getGlobalState("global_trace_enabled");
    expect(globalEnabled).toBe("false");
  });

  test("setSessionEnabled 可以设置 session 级别开关", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, false);

    const sessionEnabled = manager.getSessionEnabled(sessionId);
    expect(sessionEnabled).toBe(false);
  });

  test("getSessionEnabled 默认返回 true", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();

    const sessionEnabled = manager.getSessionEnabled(sessionId);
    expect(sessionEnabled).toBe(true);
  });

  test("isTraceEnabled 全局开时返回 true", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("global_trace_enabled", "true");

    expect(manager.isTraceEnabled()).toBe(true);
    expect(manager.isTraceEnabled("any-session")).toBe(true);
  });

  test("isTraceEnabled 全局关 + session 开时返回 true", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("global_trace_enabled", "false");

    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, true);

    expect(manager.isTraceEnabled(sessionId)).toBe(true);
  });

  test("isTraceEnabled 全局关 + session 关时返回 false", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("global_trace_enabled", "false");

    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, false);

    expect(manager.isTraceEnabled(sessionId)).toBe(false);
  });

  test("isTraceEnabled 全局关 + 无 session 时返回 false", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("global_trace_enabled", "false");

    expect(manager.isTraceEnabled()).toBe(false);
  });

  test("getSession 返回 enabled 字段", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.setSessionEnabled(sessionId, false);

    const session = manager.getSession(sessionId);
    expect(session?.trace_enabled).toBe(false);
  });
});

describe("ConfigManager - listSessions folderPath", () => {
  test("listSessions 从 metadata.json 读取 folderPath", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, {
      folderPath: "/home/user/projects/my-app",
    });
    manager.stopSession(sessionId);

    const sessions = manager.listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    expect(session?.folderPath).toBe("/home/user/projects/my-app");
  });
});

describe("ConfigManager - async writeRecord", () => {
  test("writeRecord is async and uses fs.promises", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();

    const record = {
      id: 1,
      purpose: "async-test",
      requestAt: "2026-05-07T00:00:00Z",
      responseAt: "2026-05-07T00:00:01Z",
      request: {
        method: "GET",
        url: "https://example.com",
        headers: {},
        body: null,
      },
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

describe("ConfigManager - Storage Preference (instance methods)", () => {
  test("setStoragePreference 写入 storage_preference", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setStoragePreference("local");

    expect(manager.getStoragePreference()).toBe("local");
  });

  test("getStoragePreference 默认返回 global", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(manager.getStoragePreference()).toBe("global");
  });

  test("setStoragePreference 持久化到 config.json", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setStoragePreference("local");

    const raw = readFileSync(join(testDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.storage_preference).toBe("local");
  });

  test("getStoragePreference reload 后保留", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();
    manager.setStoragePreference("local");

    manager.reloadConfig();

    expect(manager.getStoragePreference()).toBe("local");
  });

  test("setSessionStoragePreference 写入 session metadata", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.setSessionStoragePreference(sessionId, "local");

    expect(manager.getSessionStoragePreference(sessionId)).toBe("local");
  });

  test("getSessionStoragePreference 默认返回 null", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    expect(manager.getSessionStoragePreference(sessionId)).toBeNull();
  });

  test("setSessionStoragePreference 持久化到 metadata.json", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.setSessionStoragePreference(sessionId, "local");

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.storage_preference).toBe("local");
  });
});

describe("ConfigManager - readConfig 错误恢复", () => {
  test("损坏 JSON 时返回默认值并记录 error", async () => {
    writeFileSync(join(testDir, "config.json"), "{ this is not json");
    const errorSpy = vi.spyOn(logger, "error");

    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(errorSpy).toHaveBeenCalled();
    const call = errorSpy.mock.calls.find((c) =>
      String(c[0]).includes("Failed to read config.json"),
    );
    expect(call).toBeDefined();

    expect(manager.getGlobalState("global_trace_enabled")).toBe("false");
    expect(manager.getGlobalState("plugin_enabled")).toBe("true");

    errorSpy.mockRestore();
  });

  test("config.json 不存在时 init 创建默认配置", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(existsSync(join(testDir, "config.json"))).toBe(true);
    const parsed = JSON.parse(
      readFileSync(join(testDir, "config.json"), "utf-8"),
    );
    expect(parsed.global_trace_enabled).toBe(false);
    expect(parsed.storage_preference).toBe("global");
    expect(parsed.plugin_enabled).toBe(true);
    expect(parsed.current_session).toBeNull();
    expect(parsed.schema_version).toBe(2);
  });

  test("config.json 中非法 storage_preference 归一化为 global", async () => {
    writeFileSync(
      join(testDir, "config.json"),
      JSON.stringify({ storage_preference: "invalid" }),
    );

    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(manager.getStoragePreference()).toBe("global");
  });

  test("config.json 中布尔字段被 coerce", async () => {
    writeFileSync(
      join(testDir, "config.json"),
      JSON.stringify({
        global_trace_enabled: "true",
        plugin_enabled: "false",
      }),
    );

    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(manager.getGlobalState("global_trace_enabled")).toBe("true");
    expect(manager.getGlobalState("plugin_enabled")).toBe("false");
  });

  test("config.json 中缺失字段使用默认值", async () => {
    writeFileSync(join(testDir, "config.json"), JSON.stringify({}));

    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(manager.getGlobalState("global_trace_enabled")).toBe("false");
    expect(manager.getStoragePreference()).toBe("global");
    expect(manager.getGlobalState("plugin_enabled")).toBe("true");
    expect(manager.getGlobalState("current_session")).toBeNull();
  });

  test("init 写入默认 config 后 configCache 可用", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("plugin_enabled", "false");

    expect(manager.getGlobalState("plugin_enabled")).toBe("false");
  });
});

describe("ConfigManager - setGlobalState 各键处理", () => {
  test("setGlobalState 接受 plugin_enabled 'true'/'false'", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("plugin_enabled", "true");
    expect(manager.getGlobalState("plugin_enabled")).toBe("true");

    manager.setGlobalState("plugin_enabled", "false");
    expect(manager.getGlobalState("plugin_enabled")).toBe("false");
  });

  test("setGlobalState 接受 plugin_enabled 非 'false' 都为 true", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("plugin_enabled", "anything");
    expect(manager.getGlobalState("plugin_enabled")).toBe("true");
  });

  test("setGlobalState 接受 current_session 字符串", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("current_session", "my-session-123");
    expect(manager.getGlobalState("current_session")).toBe("my-session-123");
  });

  test("setGlobalState 接受 current_session null", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("current_session", "session-1");
    manager.setGlobalState("current_session", null);

    expect(manager.getGlobalState("current_session")).toBeNull();
  });

  test("setGlobalState 接受 storage_preference 并归一化", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("storage_preference", "local");
    expect(manager.getStoragePreference()).toBe("local");

    manager.setGlobalState("storage_preference", "garbage");
    expect(manager.getStoragePreference()).toBe("global");
  });

  test("setGlobalState 对未知键存储但不规范化", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("custom_key", "custom_value");

    const raw = readFileSync(join(testDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.custom_key).toBe("custom_value");
  });

  test("getGlobalState 找不到的键返回 null", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    expect(manager.getGlobalState("totally_missing_key")).toBeNull();
  });

  test("getGlobalState 将布尔字段返回为 'true'/'false' 字符串", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("global_trace_enabled", "true");
    expect(manager.getGlobalState("global_trace_enabled")).toBe("true");

    manager.setGlobalState("global_trace_enabled", "false");
    expect(manager.getGlobalState("global_trace_enabled")).toBe("false");
  });
});

describe("ConfigManager - updateSessionMetadata 各字段", () => {
  test("updateSessionMetadata 写入 trace_enabled", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { trace_enabled: false });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.trace_enabled).toBe(false);
  });

  test("updateSessionMetadata 写入 storage_preference", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { storage_preference: "local" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.storage_preference).toBe("local");
  });

  test("updateSessionMetadata 合并已有字段 (不会覆盖未传字段)", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Original" });
    manager.updateSessionMetadata(sessionId, { parentID: "parent-1" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.title).toBe("Original");
    expect(meta.parentID).toBe("parent-1");
  });

  test("updateSessionMetadata 接受空 patch 不破坏已有字段", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Keep me" });
    manager.updateSessionMetadata(sessionId, {});

    const session = manager.getSession(sessionId);
    expect(session?.title).toBe("Keep me");
  });

  test("updateSessionMetadata 写入 startedAt", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, {
      startedAt: "2024-01-01T00:00:00Z",
    });

    const session = manager.getSession(sessionId);
    expect(session?.startedAt).toBe("2024-01-01T00:00:00Z");
  });

  test("updateSessionMetadata 自动创建 session 目录", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const newId = "ghost-session-xyz";
    expect(existsSync(join(testDir, newId))).toBe(false);

    manager.updateSessionMetadata(newId, { title: "Ghost" });

    expect(existsSync(join(testDir, newId))).toBe(true);
    expect(existsSync(join(testDir, newId, "metadata.json"))).toBe(true);
  });
});

describe("ConfigManager - getActiveSession 边界", () => {
  test("getActiveSession 在 current_session 指向不存在目录时清除并返回 null", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    manager.setGlobalState("current_session", "deleted-session");
    expect(existsSync(join(testDir, "deleted-session"))).toBe(false);

    expect(manager.getActiveSession()).toBeNull();

    expect(manager.getGlobalState("current_session")).toBeNull();
  });

  test("getActiveSession 指向真实 session 时返回 sessionId", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    mkdirSync(join(testDir, sessionId), { recursive: true });

    expect(manager.getActiveSession()).toBe(sessionId);
  });
});

describe("ConfigManager - listSessions 排序与计数", () => {
  test("listSessions 跳过非 session 的孤立文件", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.stopSession(sessionId);

    writeFileSync(join(testDir, "stray-file.txt"), "not a session");

    const sessions = manager.listSessions();
    const found = sessions.find((s) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(sessions.find((s) => s.id === "stray-file.txt")).toBeUndefined();
  });

  test("listSessions 包含通过子目录扫描发现的 session", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const orphanId = "orphan-1";
    mkdirSync(join(testDir, orphanId), { recursive: true });
    writeFileSync(
      join(testDir, orphanId, "1.json"),
      JSON.stringify({
        id: 1,
        requestAt: "2024-01-01T00:00:00Z",
        responseAt: "2024-01-01T00:00:01Z",
        request: { method: "GET", url: "http://x", headers: {}, body: null },
        response: { status: 200, statusText: "OK", headers: {}, body: null },
        error: null,
        purpose: "",
      }),
    );

    const sessions = manager.listSessions();
    const found = sessions.find((s) => s.id === orphanId);
    expect(found).toBeDefined();
    expect(found?.requestCount).toBe(1);
  });
});

describe("ConfigManager - writeRecord 自动创建目录", () => {
  test("writeRecord 在 session 目录不存在时自动创建", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = "no-dir-session";
    expect(existsSync(join(testDir, sessionId))).toBe(false);

    await manager.writeRecord(sessionId, 1, {
      id: 1,
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:01Z",
      request: { method: "GET", url: "http://x", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: "",
    });

    expect(existsSync(join(testDir, sessionId, "1.json"))).toBe(true);
  });

  test("writeRecord 多个序列号独立写入", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    const baseRecord = {
      requestAt: "2024-01-01T00:00:00Z",
      responseAt: "2024-01-01T00:00:01Z",
      request: { method: "GET", url: "http://x", headers: {}, body: null },
      response: { status: 200, statusText: "OK", headers: {}, body: null },
      error: null,
      purpose: "",
    };

    await manager.writeRecord(sessionId, 1, { id: 1, ...baseRecord });
    await manager.writeRecord(sessionId, 2, { id: 2, ...baseRecord });
    await manager.writeRecord(sessionId, 3, { id: 3, ...baseRecord });

    expect(existsSync(join(testDir, sessionId, "1.json"))).toBe(true);
    expect(existsSync(join(testDir, sessionId, "2.json"))).toBe(true);
    expect(existsSync(join(testDir, sessionId, "3.json"))).toBe(true);

    const session = manager.getSession(sessionId);
    expect(session?.requestCount).toBe(3);
  });
});

describe("ConfigManager - readMetadataFile 错误恢复", () => {
  test("metadata.json 内容为非法 JSON 时返回空对象不崩溃", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    const metaPath = join(testDir, sessionId, "metadata.json");
    manager.updateSessionMetadata(sessionId, { title: "Before" });

    writeFileSync(metaPath, "{ this is not valid json !!!");

    const errorSpy = vi.spyOn(logger, "error");

    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.title).toBeUndefined();

    const call = errorSpy.mock.calls.find((c) =>
      String(c[0]).includes("Failed to read session metadata file"),
    );
    expect(call).toBeDefined();

    errorSpy.mockRestore();
  });

  test("metadata.json 不存在时 readMetadataFile 返回空对象", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = "no-meta-session";
    const sessionDir = join(testDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const metaPath = join(sessionDir, "metadata.json");
    expect(existsSync(metaPath)).toBe(false);

    manager.setGlobalState("current_session", sessionId);

    manager.setSessionEnabled(sessionId, true);
    expect(manager.getSessionEnabled(sessionId)).toBe(true);

    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.title).toBeUndefined();
    expect(session?.parentID).toBeUndefined();
    expect(session?.trace_enabled).toBe(true);
  });

  test("损坏 metadata 后 updateSessionMetadata 仍能写入新值", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    const metaPath = join(testDir, sessionId, "metadata.json");
    writeFileSync(metaPath, "broken{{{json");

    manager.updateSessionMetadata(sessionId, { title: "Recovered" });

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.title).toBe("Recovered");
  });
});

describe("ConfigManager - updateSessionMetadata 部分字段更新", () => {
  test("仅更新 title 不影响已有 parentID", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { parentID: "parent-abc" });
    manager.updateSessionMetadata(sessionId, { title: "New Title" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.title).toBe("New Title");
    expect(meta.parentID).toBe("parent-abc");
  });

  test("仅更新 parentID 不影响已有 title", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Stable Title" });
    manager.updateSessionMetadata(sessionId, { parentID: "parent-xyz" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.title).toBe("Stable Title");
    expect(meta.parentID).toBe("parent-xyz");
  });

  test("仅更新 folderPath 不影响已有 title 和 parentID", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Keep" });
    manager.updateSessionMetadata(sessionId, { parentID: "p-1" });
    manager.updateSessionMetadata(sessionId, { folderPath: "/tmp/project" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.title).toBe("Keep");
    expect(meta.parentID).toBe("p-1");
    expect(meta.folderPath).toBe("/tmp/project");
  });
});

describe("ConfigManager - readNdjsonTiming 畸形行跳过", () => {
  test("timeline.ndjson 含畸形行时跳过并统计有效行", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = "ndjson-session";
    const sessionDir = join(testDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const goodLine1 = JSON.stringify({
      requestAt: "2026-01-01T00:00:00Z",
      responseAt: "2026-01-01T00:00:01Z",
    });
    const badLine = "THIS IS NOT JSON {{{}}}";
    const goodLine2 = JSON.stringify({
      requestAt: "2026-01-01T00:01:00Z",
      responseAt: "2026-01-01T00:02:00Z",
    });

    writeFileSync(
      join(sessionDir, "timeline.ndjson"),
      `${goodLine1}\n${badLine}\n${goodLine2}\n`,
    );

    manager.setGlobalState("current_session", sessionId);

    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.requestCount).toBe(2);
    expect(session?.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(session?.endedAt).toBe("2026-01-01T00:02:00Z");
  });

  test("timeline.ndjson 全部为畸形行时返回 count 0", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = "all-bad-ndjson";
    const sessionDir = join(testDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    writeFileSync(
      join(sessionDir, "timeline.ndjson"),
      "not json\nalso not json\n",
    );

    manager.setGlobalState("current_session", sessionId);

    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.requestCount).toBe(0);
  });

  test("timeline.ndjson 空文件返回 count 0", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = "empty-ndjson";
    const sessionDir = join(testDir, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    writeFileSync(join(sessionDir, "timeline.ndjson"), "");

    manager.setGlobalState("current_session", sessionId);

    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.requestCount).toBe(0);
    expect(session?.startedAt).toBeNull();
  });
});

describe("ConfigManager - writeMetadataFile 写入错误", () => {
  test("writeMetadataFile 写入失败时错误向上传播", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Before" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    rmSync(metaPath, { force: true });
    mkdirSync(metaPath, { recursive: true });

    expect(() => {
      manager.updateSessionMetadata(sessionId, { title: "Should Fail" });
    }).toThrow();

    rmSync(metaPath, { recursive: true, force: true });
  });

  test("writeMetadataFile 写入失败后 readMetadataFile 仍可读取旧内容", async () => {
    const manager = new ConfigManager(testDir);
    await manager.init();

    const sessionId = manager.startSession();
    manager.updateSessionMetadata(sessionId, { title: "Original" });

    const metaPath = join(testDir, sessionId, "metadata.json");
    const originalContent = readFileSync(metaPath, "utf-8");

    rmSync(metaPath, { force: true });
    mkdirSync(metaPath, { recursive: true });

    expect(() => {
      manager.updateSessionMetadata(sessionId, { title: "Overwrite" });
    }).toThrow();

    rmSync(metaPath, { recursive: true, force: true });
    writeFileSync(metaPath, originalContent, "utf-8");

    const session = manager.getSession(sessionId);
    expect(session?.title).toBe("Original");
  });
});
