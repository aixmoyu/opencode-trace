import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
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
  test("getGlobalTraceEnabled 默认返回 true", async () => {
    await startRecording(undefined, testDir);

    expect(getGlobalTraceEnabled(testDir)).toBe(true);
  });

  test("setGlobalTraceEnabled 可以设置全局开关", async () => {
    await startRecording(undefined, testDir);

    setGlobalTraceEnabled(false, testDir);
    expect(getGlobalTraceEnabled(testDir)).toBe(false);

    setGlobalTraceEnabled(true, testDir);
    expect(getGlobalTraceEnabled(testDir)).toBe(true);
  });

  test("getSessionEnabled 默认返回 null", async () => {
    const sessionId = await startRecording(undefined, testDir);

    expect(getSessionEnabled(sessionId, testDir)).toBe(null);
  });

  test("setSessionEnabled 可以设置 session 级别开关", async () => {
    const sessionId = await startRecording(undefined, testDir);

    setSessionEnabled(sessionId, false, testDir);
    expect(getSessionEnabled(sessionId, testDir)).toBe(false);

    setSessionEnabled(sessionId, true, testDir);
    expect(getSessionEnabled(sessionId, testDir)).toBe(true);
  });

  test("setSessionEnabled(sessionId, null) 清除 session 级别覆盖", async () => {
    const sessionId = await startRecording(undefined, testDir);

    setSessionEnabled(sessionId, true, testDir);
    expect(getSessionEnabled(sessionId, testDir)).toBe(true);

    setSessionEnabled(sessionId, null, testDir);
    expect(getSessionEnabled(sessionId, testDir)).toBe(null);
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

describe("record/control - StateManager init", () => {
  test("initStateManager 初始化后 isRecording 可用", async () => {
    await initStateManager(testDir);

    const sessionId = await startRecording(undefined, testDir);
    expect(isRecording(sessionId, testDir)).toBe(true);
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

describe("record/control - filesystem fallback (no StateManager)", () => {
  const MARKER = ".recording";

  function createSessionWithMarker(sessionId: string, markerContent: object | string) {
    mkdirSync(join(testDir, sessionId), { recursive: true });
    const content = typeof markerContent === "string" ? markerContent : JSON.stringify(markerContent);
    writeFileSync(join(testDir, sessionId, MARKER), content, "utf-8");
  }

  function createSessionDir(sessionId: string) {
    mkdirSync(join(testDir, sessionId), { recursive: true });
  }

  test("listRecordings without StateManager scans traceDir for session dirs with markers", () => {
    createSessionWithMarker("sess-fs-1", { startedAt: "2024-01-01T00:00:00Z" });
    createSessionWithMarker("sess-fs-2", { startedAt: "2024-01-02T00:00:00Z" });

    const recordings = listRecordings(testDir);
    expect(recordings).toHaveLength(2);
    expect(recordings.map(r => r.sessionId)).toContain("sess-fs-1");
    expect(recordings.map(r => r.sessionId)).toContain("sess-fs-2");
    expect(recordings.every(r => r.active)).toBe(true);
  });

  test("listRecordings without StateManager skips dirs without markers", () => {
    createSessionWithMarker("sess-fs-with", { startedAt: "2024-01-01T00:00:00Z" });
    createSessionDir("sess-fs-no-marker");

    const recordings = listRecordings(testDir);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].sessionId).toBe("sess-fs-with");
  });

  test("listRecordings with unreadable traceDir returns empty array", () => {
    const badDir = join(tmpdir(), "nonexistent-dir-for-test-" + Date.now());
    expect(listRecordings(badDir)).toEqual([]);
  });

  test("stopRecording without StateManager removes .recording marker and returns true", () => {
    createSessionWithMarker("sess-fs-stop", { startedAt: "2024-01-01T00:00:00Z" });

    expect(existsSync(join(testDir, "sess-fs-stop", MARKER))).toBe(true);
    const result = stopRecording("sess-fs-stop", testDir);
    expect(result).toBe(true);
    expect(existsSync(join(testDir, "sess-fs-stop", MARKER))).toBe(false);
  });

  test("stopRecording without StateManager returns false when marker missing", () => {
    createSessionDir("sess-fs-stop-missing");

    expect(stopRecording("sess-fs-stop-missing", testDir)).toBe(false);
  });

  test("stopRecording without StateManager returns false for nonexistent session", () => {
    expect(stopRecording("never-existed-fs", testDir)).toBe(false);
  });

  test("isRecording without StateManager returns true when marker exists", () => {
    createSessionWithMarker("sess-fs-isrec", { startedAt: "2024-01-01T00:00:00Z" });

    expect(isRecording("sess-fs-isrec", testDir)).toBe(true);
  });

  test("isRecording without StateManager returns false when marker missing", () => {
    createSessionDir("sess-fs-isrec-no");

    expect(isRecording("sess-fs-isrec-no", testDir)).toBe(false);
  });

  test("isRecording without StateManager returns false for nonexistent session", () => {
    expect(isRecording("never-existed-fs", testDir)).toBe(false);
  });

  test("getRecordingStatus without StateManager reads marker content", () => {
    const startedAt = "2024-01-01T00:00:00Z";
    createSessionWithMarker("sess-fs-status", { startedAt });

    const status = getRecordingStatus("sess-fs-status", testDir);
    expect(status.active).toBe(true);
    expect(status.sessionId).toBe("sess-fs-status");
    expect(status.startedAt).toBe(startedAt);
  });

  test("getRecordingStatus without StateManager returns active:false when marker missing", () => {
    createSessionDir("sess-fs-status-no");

    const status = getRecordingStatus("sess-fs-status-no", testDir);
    expect(status).toEqual({ active: false });
  });

  test("getRecordingStatus without StateManager returns active:true on malformed marker", () => {
    createSessionWithMarker("sess-fs-status-bad", "not-valid-json");

    const status = getRecordingStatus("sess-fs-status-bad", testDir);
    expect(status.active).toBe(true);
    expect(status.sessionId).toBe("sess-fs-status-bad");
    expect(status.startedAt).toBeUndefined();
  });

  test("getRecordingStatus without StateManager for nonexistent session returns active:false", () => {
    expect(getRecordingStatus("never-existed-fs", testDir)).toEqual({ active: false });
  });
});
