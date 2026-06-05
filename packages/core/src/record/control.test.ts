import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startRecording,
  stopRecording,
  isRecording,
  getRecordingStatus,
  listRecordings,
  setGlobalTraceEnabled,
  getGlobalTraceEnabled,
  setSessionEnabled,
  getSessionEnabled,
  shouldRecord,
  setSessionStoragePreference,
  getSessionStoragePreference,
  setStoragePreference,
  getStoragePreference,
  syncState,
  initStateManager,
} from "./control.js";

let testDir: string;

beforeEach(async () => {
  testDir = mkdtempSync(join(tmpdir(), "record-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("record/control - StateManager集成", () => {
  test("startRecording 创建 session 并标记为 active", async () => {
    const sessionId = await startRecording(undefined, testDir);

    expect(sessionId).toBeDefined();
    expect(typeof sessionId).toBe("string");
    expect(isRecording(sessionId, testDir)).toBe(true);
  });

  test("stopSession 清除 active 状态", async () => {
    const sessionId = await startRecording(undefined, testDir);

    expect(isRecording(sessionId, testDir)).toBe(true);

    stopRecording(sessionId, testDir);

    expect(isRecording(sessionId, testDir)).toBe(false);
  });

  test("listRecordings 返回所有 active sessions", async () => {
    const session1 = await startRecording(undefined, testDir);
    const session2 = await startRecording(undefined, testDir);

    stopRecording(session1, testDir);

    const recordings = listRecordings(testDir);

    expect(recordings.length).toBe(1);
    expect(recordings[0].sessionId).toBe(session2);
    expect(recordings[0].active).toBe(true);
  });

  test("getRecordingStatus 返回完整状态信息", async () => {
    const sessionId = await startRecording(undefined, testDir);

    const status = getRecordingStatus(sessionId, testDir);

    expect(status.active).toBe(true);
    expect(status.sessionId).toBe(sessionId);
    expect(status.startedAt).toBeDefined();
  });
});

describe("record/control - Trace Enable/Disable", () => {
  test("getGlobalTraceEnabled 默认返回 false", async () => {
    await startRecording(undefined, testDir);

    expect(getGlobalTraceEnabled(testDir)).toBe(false);
  });

  test("setGlobalTraceEnabled 可以设置全局开关", async () => {
    await startRecording(undefined, testDir);

    setGlobalTraceEnabled(false, testDir);
    expect(getGlobalTraceEnabled(testDir)).toBe(false);

    setGlobalTraceEnabled(true, testDir);
    expect(getGlobalTraceEnabled(testDir)).toBe(true);
  });

  test("getSessionEnabled 默认返回 true", async () => {
    const sessionId = await startRecording(undefined, testDir);

    expect(getSessionEnabled(sessionId, testDir)).toBe(true);
  });

  test("setSessionEnabled 可以设置 session 级别开关", async () => {
    const sessionId = await startRecording(undefined, testDir);

    setSessionEnabled(sessionId, false, testDir);
    expect(getSessionEnabled(sessionId, testDir)).toBe(false);

    setSessionEnabled(sessionId, true, testDir);
    expect(getSessionEnabled(sessionId, testDir)).toBe(true);
  });

  test("shouldRecord 全局开时返回 true", async () => {
    await startRecording(undefined, testDir);
    setGlobalTraceEnabled(true, testDir);

    expect(shouldRecord(undefined, testDir)).toBe(true);
    expect(shouldRecord("any-session", testDir)).toBe(true);
  });

  test("shouldRecord 全局关 + session 开时返回 true", async () => {
    const sessionId = await startRecording(undefined, testDir);
    setGlobalTraceEnabled(false, testDir);
    setSessionEnabled(sessionId, true, testDir);

    expect(shouldRecord(sessionId, testDir)).toBe(true);
  });

  test("shouldRecord 全局关 + session 关时返回 false", async () => {
    const sessionId = await startRecording(undefined, testDir);
    setGlobalTraceEnabled(false, testDir);
    setSessionEnabled(sessionId, false, testDir);

    expect(shouldRecord(sessionId, testDir)).toBe(false);
  });

  test("shouldRecord 全局关 + 无 session 时返回 false", async () => {
    await startRecording(undefined, testDir);
    setGlobalTraceEnabled(false, testDir);

    expect(shouldRecord(undefined, testDir)).toBe(false);
  });
});

describe("record/control - Storage Preference", () => {
  test("getStoragePreference 在未初始化 manager 时默认返回 global", () => {
    expect(getStoragePreference(testDir)).toBe("global");
  });

  test("setStoragePreference 之后 getStoragePreference 返回新值", async () => {
    await startRecording(undefined, testDir);

    setStoragePreference("local", testDir);
    expect(getStoragePreference(testDir)).toBe("local");

    setStoragePreference("global", testDir);
    expect(getStoragePreference(testDir)).toBe("global");
  });

  test("getSessionStoragePreference 在未初始化 manager 时返回 null", () => {
    expect(getSessionStoragePreference("any-session", testDir)).toBeNull();
  });

  test("setSessionStoragePreference 之后 getSessionStoragePreference 返回新值", async () => {
    const sessionId = await startRecording(undefined, testDir);

    setSessionStoragePreference(sessionId, "local", testDir);
    expect(getSessionStoragePreference(sessionId, testDir)).toBe("local");

    setSessionStoragePreference(sessionId, "global", testDir);
    expect(getSessionStoragePreference(sessionId, testDir)).toBe("global");
  });

  test("setSessionStoragePreference 写入 session metadata.json", async () => {
    const sessionId = await startRecording(undefined, testDir);

    setSessionStoragePreference(sessionId, "local", testDir);

    const metaPath = join(testDir, sessionId, "metadata.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.storage_preference).toBe("local");
  });

  test("getSessionStoragePreference 对未知 session 返回 null", async () => {
    await startRecording(undefined, testDir);

    expect(getSessionStoragePreference("never-existed", testDir)).toBeNull();
  });
});

describe("record/control - StateManager init/sync", () => {
  test("initStateManager 初始化后 isRecording 可用", async () => {
    await initStateManager(testDir);

    const sessionId = await startRecording(undefined, testDir);
    expect(isRecording(sessionId, testDir)).toBe(true);
  });

  test("syncState 重新加载磁盘上的 config", async () => {
    const sessionId = await startRecording(undefined, testDir);

    setGlobalTraceEnabled(true, testDir);
    expect(getGlobalTraceEnabled(testDir)).toBe(true);

    setGlobalTraceEnabled(false, testDir);
    expect(getGlobalTraceEnabled(testDir)).toBe(false);

    syncState(testDir);

    expect(getGlobalTraceEnabled(testDir)).toBe(false);
  });

  test("syncState 在没有 manager 时为 noop", () => {
    expect(() => syncState(testDir)).not.toThrow();
  });
});

describe("record/control - listRecordings 边界", () => {
  test("listRecordings 在无 active session 时返回空数组", async () => {
    const sessionId = await startRecording(undefined, testDir);
    stopRecording(sessionId, testDir);

    expect(listRecordings(testDir)).toEqual([]);
  });

  test("listRecordings 在未初始化 manager 时返回空数组", () => {
    expect(listRecordings(testDir)).toEqual([]);
  });

  test("listRecordings 返回 startedAt 信息", async () => {
    const sessionId = await startRecording(undefined, testDir);

    const recordings = listRecordings(testDir);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].startedAt).toBeDefined();
  });
});

describe("record/control - getRecordingStatus 边界", () => {
  test("getRecordingStatus 对未知 session 返回 active: false", () => {
    expect(getRecordingStatus("never-existed", testDir)).toEqual({
      active: false,
    });
  });
});

describe("record/control - stopRecording 边界", () => {
  test("stopRecording 对不存在的 session 返回 false", () => {
    expect(stopRecording("never-existed", testDir)).toBe(false);
  });

  test("stopRecording 对已 active session 返回 true", async () => {
    const sessionId = await startRecording(undefined, testDir);
    expect(stopRecording(sessionId, testDir)).toBe(true);
  });
});

describe("record/control - isRecording 边界", () => {
  test("isRecording 对未知 session 返回 false", () => {
    expect(isRecording("never-existed", testDir)).toBe(false);
  });
});
