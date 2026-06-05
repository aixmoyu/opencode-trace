import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
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
      ...original.record,
      initStateManager: vi.fn().mockResolvedValue(undefined),
      syncState: vi.fn(),
    },
    logger: {
      ...original.logger,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    existsSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { cmdSync } from "./sync.js";
import { GLOBAL_TRACE_DIR } from "../utils.js";
import { record as mockedRecord, logger as mockedLogger } from "@opencode-trace/core";

const initStateManagerMock = vi.mocked(mockedRecord.initStateManager);
const syncStateMock = vi.mocked(mockedRecord.syncState);
const loggerInfoMock = vi.mocked(mockedLogger.info);

let testDir: string;
let configPath: string;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "cli-sync-test-"));
  process.env._TEST_DIR_ = testDir;
  configPath = join(GLOBAL_TRACE_DIR, "config.json");
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit_${code}`);
  }) as never);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env._TEST_DIR_;
  vi.restoreAllMocks();
});

describe("cmdSync", () => {
  it("calls initStateManager and syncState on GLOBAL_TRACE_DIR, and logs completion", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await cmdSync([]);

    expect(initStateManagerMock).toHaveBeenCalledTimes(1);
    expect(initStateManagerMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(syncStateMock).toHaveBeenCalledTimes(1);
    expect(syncStateMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(loggerInfoMock).toHaveBeenCalledWith("Sync completed");
  });

  it("does NOT touch config.json when --repair is not set", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await cmdSync([]);

    expect(existsSync).not.toHaveBeenCalled();
    expect(rmSync).not.toHaveBeenCalled();
  });
});

describe("cmdSync --repair", () => {
  it("removes config.json and logs removal when it exists", async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await cmdSync(["--repair"]);

    expect(existsSync).toHaveBeenCalledTimes(1);
    expect(existsSync).toHaveBeenCalledWith(configPath);
    expect(rmSync).toHaveBeenCalledTimes(1);
    expect(rmSync).toHaveBeenCalledWith(configPath, { force: true });
    expect(loggerInfoMock).toHaveBeenCalledWith("Removed corrupted config.json");

    // After repair, normal sync flow still runs
    expect(initStateManagerMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(syncStateMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(loggerInfoMock).toHaveBeenCalledWith("Sync completed");
  });

  it("does NOT call rmSync when config.json does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await cmdSync(["--repair"]);

    expect(existsSync).toHaveBeenCalledWith(configPath);
    expect(rmSync).not.toHaveBeenCalled();
    // logger.info "Removed corrupted config.json" should NOT be called
    expect(loggerInfoMock).not.toHaveBeenCalledWith(
      "Removed corrupted config.json",
    );
    // Normal sync flow still runs
    expect(initStateManagerMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(syncStateMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(loggerInfoMock).toHaveBeenCalledWith("Sync completed");
  });

  it("ignores extra positional args but still applies --repair", async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    await cmdSync(["--repair", "extra-arg"]);

    expect(existsSync).toHaveBeenCalledWith(configPath);
    expect(rmSync).toHaveBeenCalledWith(configPath, { force: true });
    expect(loggerInfoMock).toHaveBeenCalledWith("Removed corrupted config.json");
    expect(initStateManagerMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(syncStateMock).toHaveBeenCalledWith(GLOBAL_TRACE_DIR);
    expect(loggerInfoMock).toHaveBeenCalledWith("Sync completed");
  });
});
