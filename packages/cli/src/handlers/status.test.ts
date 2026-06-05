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

import { cmdStatus } from "./status.js";
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

function getStatusOutput(): Record<string, unknown> {
  const calls = logSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const firstArg = calls[0]?.[0];
  expect(typeof firstArg).toBe("string");
  return JSON.parse(firstArg as string);
}

describe("cmdStatus", () => {
  it("no flags shows global status only", async () => {
    await cmdStatus([]);
    const status = getStatusOutput();
    expect(status).toEqual({
      global: { enabled: false, storage: "global" },
    });
    expect(record.getGlobalTraceEnabled).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(record.getStoragePreference).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
  });

  it("-g flag shows global status only", async () => {
    await cmdStatus(["-g"]);
    const status = getStatusOutput();
    expect(status).toHaveProperty("global");
    expect(status).not.toHaveProperty("local");
    expect(status).not.toHaveProperty("session");
    expect(status.global).toEqual({ enabled: false, storage: "global" });
  });

  it("-l flag shows local status only", async () => {
    await cmdStatus(["-l"]);
    const status = getStatusOutput();
    expect(status).toHaveProperty("local");
    expect(status).not.toHaveProperty("global");
    expect(status).not.toHaveProperty("session");
    expect(status.local).toEqual({ enabled: false });
    expect(record.getGlobalTraceEnabled).toHaveBeenCalledWith(LOCAL_TRACE_DIR);
  });

  it("-g -l flags show both global and local", async () => {
    await cmdStatus(["-g", "-l"]);
    const status = getStatusOutput();
    expect(status).toHaveProperty("global");
    expect(status).toHaveProperty("local");
    expect(status).not.toHaveProperty("session");
    expect(record.getGlobalTraceEnabled).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(record.getGlobalTraceEnabled).toHaveBeenCalledWith(LOCAL_TRACE_DIR);
  });

  it("-s without sessionId exits with code 1", async () => {
    await expect(cmdStatus(["-s"])).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith("Error: session-id is required when using -s");
  });

  it("-s with sessionId shows session status only", async () => {
    await cmdStatus(["-s", "my-session"]);
    const status = getStatusOutput();
    expect(status).toEqual({
      session: { id: "my-session", enabled: false, storage: null },
    });
    expect(status).not.toHaveProperty("global");
    expect(status).not.toHaveProperty("local");
    expect(record.getSessionEnabled).toHaveBeenCalledWith("my-session", GLOBAL_TRACE_DIR);
    expect(record.getSessionStoragePreference).toHaveBeenCalledWith("my-session", GLOBAL_TRACE_DIR);
  });

  it("all flags combined shows all three scopes", async () => {
    await cmdStatus(["-g", "-l", "-s", "my-session"]);
    const status = getStatusOutput();
    expect(status).toHaveProperty("global");
    expect(status).toHaveProperty("local");
    expect(status).toHaveProperty("session");
    expect((status.global as Record<string, unknown>).enabled).toBe(false);
    expect((status.local as Record<string, unknown>).enabled).toBe(false);
    expect((status.session as Record<string, unknown>).id).toBe("my-session");
    expect((status.session as Record<string, unknown>).enabled).toBe(false);
  });

  it("reflects mocked return values in output", async () => {
    vi.mocked(record.getGlobalTraceEnabled).mockReturnValue(true);
    vi.mocked(record.getStoragePreference).mockReturnValue("local");
    vi.mocked(record.getSessionEnabled).mockReturnValue(true);
    vi.mocked(record.getSessionStoragePreference).mockReturnValue("local");

    await cmdStatus(["-g", "-l", "-s", "my-session"]);
    const status = getStatusOutput();
    expect(status.global).toEqual({ enabled: true, storage: "local" });
    expect(status.local).toEqual({ enabled: true });
    expect(status.session).toEqual({
      id: "my-session",
      enabled: true,
      storage: "local",
    });
  });
});
