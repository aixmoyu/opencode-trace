import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = resolve(__dirname, "..", "dist", "index.js");

function runCLI(
  args: string,
  cwd?: string,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      cwd: cwd ?? resolve(__dirname, ".."),
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.status ?? 1,
    };
  }
}

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "cli-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("parseCollapse", () => {
  it("should accept valid collapse options in flags", () => {
    const result = runCLI("help --collapse sys,tool,msgs");
    expect(result.exitCode).toBe(0);
  });
});

describe("parseCollapseBlocks", () => {
  it("should accept valid block types in flags", () => {
    const result = runCLI("help --collapse-blocks text,thinking");
    expect(result.exitCode).toBe(0);
  });
});

describe("export validation", () => {
  it("help shows output folder requirement for conversation export", () => {
    const result = runCLI("help");
    expect(result.stdout).toContain("-o: output folder path");
  });
});

describe("help text", () => {
  it("should show --collapse option in help", () => {
    const result = runCLI("help");
    expect(result.stdout).toContain("--collapse");
    expect(result.stdout).toContain("sys,tool,msgs");
  });

  it("should show --collapse-blocks option in help", () => {
    const result = runCLI("help");
    expect(result.stdout).toContain("--collapse-blocks");
    expect(result.stdout).toContain("text,thinking,td,tc,tr,image,other");
  });
});

describe("--local flag", () => {
  it("enable --local saves to local directory", () => {
    const result = runCLI(`enable --local`, testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("local");

    const localDb = join(testDir, ".opencode-trace", "state.db");
    expect(existsSync(localDb)).toBe(true);
  });

  it("enable without --local saves to global directory", () => {
    const result = runCLI(`enable`, testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("global");
  });

  it("disable --local affects local directory", () => {
    const result = runCLI(`disable --local`, testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("local");

    const localDb = join(testDir, ".opencode-trace", "state.db");
    expect(existsSync(localDb)).toBe(true);
  });

  it("status --local shows local status", () => {
    const result = runCLI(`status --local`, testDir);
    expect(result.exitCode).toBe(0);
  });
});
