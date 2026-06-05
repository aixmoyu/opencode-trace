import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizePath } from "./paths.js";

const originalEnv = { ...process.env };

describe("getTraceDir", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns homedir path on Windows", async () => {
    process.env.OPENTRACE_LOG = "off";
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    vi.doMock("node:os", () => ({
      homedir: () => "C:\\Users\\testuser",
    }));
    const { getTraceDir } = await import("./paths.js");
    expect(getTraceDir()).toBe("C:\\Users\\testuser\\.opencode-trace");
    platformSpy.mockRestore();
  });

  it("returns homedir path on non-Windows platforms", async () => {
    process.env.OPENTRACE_LOG = "off";
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.doMock("node:os", () => ({
      homedir: () => "/home/testuser",
    }));
    const { getTraceDir } = await import("./paths.js");
    expect(getTraceDir()).toBe("/home/testuser/.opencode-trace");
    platformSpy.mockRestore();
  });
});

describe("sanitizePath", () => {
  it("replaces user home path with [HOME]", () => {
    const result = sanitizePath(
      "/home/testuser/project/file.ts",
      "/home/testuser",
    );
    expect(result).toBe("[HOME]/project/file.ts");
  });

  it("replaces Windows user home path with [HOME]", () => {
    const result = sanitizePath(
      "C:\\Users\\testuser\\project\\file.ts",
      "C:\\Users\\testuser",
    );
    expect(result).toBe("[HOME]\\project\\file.ts");
  });

  it("handles escaped backslashes in Windows paths", () => {
    const result = sanitizePath(
      "C:\\Users\\testuser\\folder",
      "C:\\Users\\testuser",
    );
    expect(result).toBe("[HOME]\\folder");
  });

  it("replaces multiple occurrences", () => {
    const result = sanitizePath(
      "/home/testuser/a and /home/testuser/b",
      "/home/testuser",
    );
    expect(result).toBe("[HOME]/a and [HOME]/b");
  });

  it("returns unchanged string when home path not found", () => {
    const result = sanitizePath("/other/path/file.ts", "/home/testuser");
    expect(result).toBe("/other/path/file.ts");
  });
});
