import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTraceDir, sanitizePath } from "./platform.js";

describe("getTraceDir", () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns APPDATA path on Windows when APPDATA is set", async () => {
    vi.stubGlobal("process", {
      platform: "win32",
      env: { ...originalEnv, APPDATA: "C:\\Users\\testuser\\AppData\\Roaming" },
    });
    const { getTraceDir } = await import("./platform.js");
    expect(getTraceDir()).toBe("C:\\Users\\testuser\\AppData\\Roaming\\opencode-trace");
  });

  it("returns homedir fallback on Windows when APPDATA is not set", async () => {
    vi.stubGlobal("process", {
      platform: "win32",
      env: { ...originalEnv, APPDATA: undefined },
    });
    vi.doMock("node:os", () => ({
      homedir: () => "C:\\Users\\testuser",
    }));
    const { getTraceDir } = await import("./platform.js");
    expect(getTraceDir()).toBe("C:\\Users\\testuser\\.opencode-trace");
  });

  it("returns homedir path on non-Windows platforms", async () => {
    vi.stubGlobal("process", {
      platform: "linux",
      env: originalEnv,
    });
    vi.doMock("node:os", () => ({
      homedir: () => "/home/testuser",
    }));
    const { getTraceDir } = await import("./platform.js");
    expect(getTraceDir()).toBe("/home/testuser/.opencode-trace");
  });
});

describe("sanitizePath", () => {
  it("replaces user home path with [HOME]", () => {
    const result = sanitizePath("/home/testuser/project/file.ts", "/home/testuser");
    expect(result).toBe("[HOME]/project/file.ts");
  });

  it("replaces Windows user home path with [HOME]", () => {
    const result = sanitizePath("C:\\Users\\testuser\\project\\file.ts", "C:\\Users\\testuser");
    expect(result).toBe("[HOME]\\project\\file.ts");
  });

  it("handles escaped backslashes in Windows paths", () => {
    const result = sanitizePath("C:\\Users\\testuser\\folder", "C:\\Users\\testuser");
    expect(result).toBe("[HOME]\\folder");
  });

  it("replaces multiple occurrences", () => {
    const result = sanitizePath(
      "/home/testuser/a and /home/testuser/b",
      "/home/testuser"
    );
    expect(result).toBe("[HOME]/a and [HOME]/b");
  });

  it("returns unchanged string when home path not found", () => {
    const result = sanitizePath("/other/path/file.ts", "/home/testuser");
    expect(result).toBe("/other/path/file.ts");
  });
});