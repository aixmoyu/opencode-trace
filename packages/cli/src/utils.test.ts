import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    homedir: () => process.env._TEST_DIR_ || original.homedir(),
  };
});

vi.hoisted(() => {
  process.env._TEST_DIR_ = "/tmp/opencode-trace-utils-test";
});

import {
  GLOBAL_TRACE_DIR,
  LOCAL_TRACE_DIR,
  parseRange,
  inRange,
  parseFlags,
  findSessionTraceDir,
} from "./utils.js";
import { store } from "@opencode-trace/core";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "cli-utils-test-"));
  process.env._TEST_DIR_ = testDir;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit_${code}`);
  }) as never);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env._TEST_DIR_;
  vi.restoreAllMocks();
});

describe("parseRange", () => {
  it("parses single number to {start, end: lastReqId}", () => {
    expect(parseRange("3", 10)).toEqual({ start: 3, end: 10 });
  });

  it("parses 'N:M' range with explicit end", () => {
    expect(parseRange("1:3", 10)).toEqual({ start: 1, end: 3 });
  });

  it("parses 'N:' range with null end (open-ended)", () => {
    expect(parseRange("2:", 10)).toEqual({ start: 2, end: null });
  });

  it("throws exit_1 when single-number start is 0", () => {
    expect(() => parseRange("0", 10)).toThrow("exit_1");
  });

  it("throws exit_1 when range start is 0", () => {
    expect(() => parseRange("0:5", 10)).toThrow("exit_1");
  });

  it("throws exit_1 when end equals start", () => {
    expect(() => parseRange("3:3", 10)).toThrow("exit_1");
  });

  it("throws exit_1 when end is less than start", () => {
    expect(() => parseRange("3:2", 10)).toThrow("exit_1");
  });

  it("throws exit_1 on invalid format 'abc'", () => {
    expect(() => parseRange("abc", 10)).toThrow("exit_1");
  });

  it("throws exit_1 on too many colons '1:2:3'", () => {
    expect(() => parseRange("1:2:3", 10)).toThrow("exit_1");
  });
});

describe("inRange", () => {
  it("returns true when range is null (no filter)", () => {
    expect(inRange(5, null)).toBe(true);
  });

  it("returns false when reqId < start", () => {
    expect(inRange(2, { start: 3, end: 5 })).toBe(false);
  });

  it("returns false when reqId equals end (half-open interval)", () => {
    expect(inRange(5, { start: 3, end: 5 })).toBe(false);
  });

  it("returns false when reqId is past end", () => {
    expect(inRange(10, { start: 3, end: 5 })).toBe(false);
  });

  it("returns true when reqId is at start boundary", () => {
    expect(inRange(3, { start: 3, end: 5 })).toBe(true);
  });

  it("returns true when reqId is strictly inside [start, end)", () => {
    expect(inRange(4, { start: 3, end: 5 })).toBe(true);
  });

  it("returns true when reqId >= start and end is null", () => {
    expect(inRange(4, { start: 3, end: null })).toBe(true);
    expect(inRange(100, { start: 3, end: null })).toBe(true);
  });
});

describe("parseFlags", () => {
  it("returns empty result for no args", () => {
    expect(parseFlags([])).toEqual({ positional: [], flags: {} });
  });

  it("recognises -g shorthand", () => {
    const { flags } = parseFlags(["-g"]);
    expect(flags.global).toBe(true);
  });

  it("recognises --global longhand", () => {
    const { flags } = parseFlags(["--global"]);
    expect(flags.global).toBe(true);
  });

  it("recognises -l flag", () => {
    const { flags } = parseFlags(["-l"]);
    expect(flags.local).toBe(true);
  });

  it("recognises -s flag", () => {
    const { flags } = parseFlags(["-s"]);
    expect(flags.session).toBe(true);
  });

  it("accepts -d global", () => {
    const { flags } = parseFlags(["-d", "global"]);
    expect(flags.dir).toBe("global");
  });

  it("accepts -d local", () => {
    const { flags } = parseFlags(["-d", "local"]);
    expect(flags.dir).toBe("local");
  });

  it("accepts --dir longhand", () => {
    const { flags } = parseFlags(["--dir", "global"]);
    expect(flags.dir).toBe("global");
  });

  it("throws exit_1 for -d invalid", () => {
    expect(() => parseFlags(["-d", "weird"])).toThrow("exit_1");
  });

  it("accepts -r N", () => {
    const { flags } = parseFlags(["-r", "3"]);
    expect(flags.req).toBe("3");
  });

  it("accepts -o /path", () => {
    const { flags } = parseFlags(["-o", "/tmp/x"]);
    expect(flags.output).toBe("/tmp/x");
  });

  it("accepts -t metadata", () => {
    const { flags } = parseFlags(["-t", "metadata"]);
    expect(flags.type).toBe("metadata");
  });

  it("accepts -t conversation", () => {
    const { flags } = parseFlags(["-t", "conversation"]);
    expect(flags.type).toBe("conversation");
  });

  it("accepts -t changes", () => {
    const { flags } = parseFlags(["-t", "changes"]);
    expect(flags.type).toBe("changes");
  });

  it("accepts -t raw", () => {
    const { flags } = parseFlags(["-t", "raw"]);
    expect(flags.type).toBe("raw");
  });

  it("throws exit_1 for -t invalid", () => {
    expect(() => parseFlags(["-t", "garbage"])).toThrow("exit_1");
  });

  it("accepts --format json", () => {
    const { flags } = parseFlags(["--format", "json"]);
    expect(flags.format).toBe("json");
  });

  it("accepts --format xml", () => {
    const { flags } = parseFlags(["--format", "xml"]);
    expect(flags.format).toBe("xml");
  });

  it("throws exit_1 for --format invalid", () => {
    expect(() => parseFlags(["--format", "yaml"])).toThrow("exit_1");
  });

  it("accepts --compact", () => {
    const { flags } = parseFlags(["--compact"]);
    expect(flags.compact).toBe(true);
  });

  it("accepts --collapse with comma list (raw value stored)", () => {
    const { flags } = parseFlags(["--collapse", "sys,tool"]);
    expect(flags.collapse).toBe("sys,tool");
  });

  it("accepts --collapse-blocks with comma list (raw value stored)", () => {
    const { flags } = parseFlags(["--collapse-blocks", "text,thinking"]);
    expect(flags.collapseBlocks).toBe("text,thinking");
  });

  it("accepts --repair", () => {
    const { flags } = parseFlags(["--repair"]);
    expect(flags.repair).toBe(true);
  });

  it("collects positional args and ignores unknown -flags", () => {
    const { positional, flags } = parseFlags([
      "session-1",
      "session-2",
      "--unknown",
    ]);
    expect(positional).toEqual(["session-1", "session-2"]);
    expect(flags).toEqual({});
  });

  it("parses combined flags and positional together", () => {
    const { positional, flags } = parseFlags([
      "cmd",
      "-g",
      "-d",
      "local",
      "session-1",
      "-r",
      "1:3",
    ]);
    expect(positional).toEqual(["cmd", "session-1"]);
    expect(flags).toMatchObject({
      global: true,
      dir: "local",
      req: "1:3",
    });
  });
});

describe("findSessionTraceDir", () => {
  it("returns LOCAL_TRACE_DIR when session metadata is in local dir", () => {
    vi.spyOn(store, "readSessionMetadata").mockImplementation(
      (_id: string, dir: string) => {
        if (dir === LOCAL_TRACE_DIR) {
          return { sessionId: "abc" } as any;
        }
        return null;
      },
    );
    expect(findSessionTraceDir("abc")).toBe(LOCAL_TRACE_DIR);
  });

  it("returns GLOBAL_TRACE_DIR when session metadata is in global dir", () => {
    vi.spyOn(store, "readSessionMetadata").mockImplementation(
      (_id: string, dir: string) => {
        if (dir === GLOBAL_TRACE_DIR) {
          return { sessionId: "abc" } as any;
        }
        return null;
      },
    );
    expect(findSessionTraceDir("abc")).toBe(GLOBAL_TRACE_DIR);
  });

  it("falls back to local records when metadata is absent", () => {
    vi.spyOn(store, "readSessionMetadata").mockReturnValue(null);
    vi.spyOn(store, "getSessionRecords").mockImplementation(
      (_id: string, opts?: { traceDir?: string }) => {
        if (opts?.traceDir === LOCAL_TRACE_DIR) {
          return [{} as any];
        }
        return [];
      },
    );
    expect(findSessionTraceDir("abc")).toBe(LOCAL_TRACE_DIR);
  });

  it("falls back to global records when metadata is absent", () => {
    vi.spyOn(store, "readSessionMetadata").mockReturnValue(null);
    vi.spyOn(store, "getSessionRecords").mockImplementation(
      (_id: string, opts?: { traceDir?: string }) => {
        if (opts?.traceDir === GLOBAL_TRACE_DIR) {
          return [{} as any];
        }
        return [];
      },
    );
    expect(findSessionTraceDir("abc")).toBe(GLOBAL_TRACE_DIR);
  });

  it("prefers local metadata over global metadata", () => {
    vi.spyOn(store, "readSessionMetadata").mockReturnValue({
      sessionId: "abc",
    } as any);
    expect(findSessionTraceDir("abc")).toBe(LOCAL_TRACE_DIR);
  });

  it("returns null when session exists in neither dir", () => {
    vi.spyOn(store, "readSessionMetadata").mockReturnValue(null);
    vi.spyOn(store, "getSessionRecords").mockReturnValue([]);
    expect(findSessionTraceDir("nonexistent")).toBeNull();
  });
});
