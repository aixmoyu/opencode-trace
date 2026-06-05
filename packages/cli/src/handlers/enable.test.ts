import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => {
      const testDir = process.env._TEST_DIR_;
      if (testDir) return testDir;
      return original.homedir();
    },
  };
});

vi.mock("@opencode-trace/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@opencode-trace/core")>();
  return {
    ...original,
    record: {
      initStateManager: vi.fn().mockResolvedValue(undefined),
      setGlobalTraceEnabled: vi.fn(),
      setStoragePreference: vi.fn(),
      setSessionEnabled: vi.fn(),
      setSessionStoragePreference: vi.fn(),
      getGlobalTraceEnabled: vi.fn().mockReturnValue(false),
      getStoragePreference: vi.fn().mockReturnValue("global"),
      getSessionEnabled: vi.fn().mockReturnValue(false),
      getSessionStoragePreference: vi.fn().mockReturnValue(null),
    },
  };
});

import { cmdEnable } from "./enable.js";
import { GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";
import { record } from "@opencode-trace/core";

let testDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "cli-handler-test-"));
  process.env._TEST_DIR_ = testDir;
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit_${code}`);
  }) as never);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env._TEST_DIR_;
  vi.restoreAllMocks();
});

describe("cmdEnable", () => {
  it("no flags defaults to global scope and sets storage preference", async () => {
    await cmdEnable([]);
    expect(record.initStateManager).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, GLOBAL_TRACE_DIR);
    expect(record.setStoragePreference).toHaveBeenCalledWith("global", GLOBAL_TRACE_DIR);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("Trace enabled (scope: global)");
  });

  it("-g flag enables global scope", async () => {
    await cmdEnable(["-g"]);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, GLOBAL_TRACE_DIR);
    expect(record.setGlobalTraceEnabled).not.toHaveBeenCalledWith(true, LOCAL_TRACE_DIR);
    expect(logSpy).toHaveBeenCalledWith("Trace enabled (scope: global)");
  });

  it("-l flag enables local scope", async () => {
    await cmdEnable(["-l"]);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, LOCAL_TRACE_DIR);
    expect(record.setGlobalTraceEnabled).not.toHaveBeenCalledWith(true, GLOBAL_TRACE_DIR);
    expect(logSpy).toHaveBeenCalledWith("Trace enabled (scope: local)");
  });

  it("-g -l flags enable both global and local", async () => {
    await cmdEnable(["-g", "-l"]);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, GLOBAL_TRACE_DIR);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, LOCAL_TRACE_DIR);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith("Trace enabled (scope: global, local)");
  });

  it("-s without sessionId exits with code 1", async () => {
    await expect(cmdEnable(["-s"])).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith("Error: session-id is required when using -s");
  });

  it("-s with sessionId enables session scope", async () => {
    await cmdEnable(["-s", "my-session"]);
    expect(record.setSessionEnabled).toHaveBeenCalledWith("my-session", true, GLOBAL_TRACE_DIR);
    expect(logSpy).toHaveBeenCalledWith("Trace enabled (scope: session)");
  });

  it("-d local sets storage preference to local", async () => {
    await cmdEnable(["-d", "local"]);
    expect(record.setStoragePreference).toHaveBeenCalledWith("local", GLOBAL_TRACE_DIR);
    expect(logSpy).toHaveBeenCalledWith("Trace enabled (scope: global, storage: local)");
  });

  it("-d global sets storage preference to global", async () => {
    await cmdEnable(["-d", "global"]);
    expect(record.setStoragePreference).toHaveBeenCalledWith("global", GLOBAL_TRACE_DIR);
    expect(logSpy).toHaveBeenCalledWith("Trace enabled (scope: global, storage: global)");
  });

  it("-d invalid exits with code 1", async () => {
    await expect(cmdEnable(["-d", "invalid"])).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith("Error: Invalid dir value: invalid. Valid: global, local");
  });

  it("all flags combined - enables all three scopes and sets storage", async () => {
    await cmdEnable(["-g", "-l", "-s", "my-session", "-d", "local"]);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, GLOBAL_TRACE_DIR);
    expect(record.setGlobalTraceEnabled).toHaveBeenCalledWith(true, LOCAL_TRACE_DIR);
    expect(record.setSessionEnabled).toHaveBeenCalledWith("my-session", true, GLOBAL_TRACE_DIR);
    expect(record.setSessionStoragePreference).toHaveBeenCalledWith(
      "my-session",
      "local",
      GLOBAL_TRACE_DIR,
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Trace enabled (scope: global, local, session, storage: local)",
    );
  });

  it("-s with -d sets session storage preference", async () => {
    await cmdEnable(["-s", "my-session", "-d", "local"]);
    expect(record.setSessionStoragePreference).toHaveBeenCalledWith(
      "my-session",
      "local",
      GLOBAL_TRACE_DIR,
    );
    expect(record.setSessionStoragePreference).toHaveBeenCalledTimes(1);
  });

  it("-s without -d does not call setSessionStoragePreference", async () => {
    await cmdEnable(["-s", "my-session"]);
    expect(record.setSessionStoragePreference).not.toHaveBeenCalled();
  });
});
