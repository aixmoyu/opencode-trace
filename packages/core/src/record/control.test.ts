import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
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
  shouldRecord
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