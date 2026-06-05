import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    store: {
      ...original.store,
      getSessionRecords: vi.fn(),
      exportSessionZip: vi.fn(),
      readSessionMetadata: vi.fn(),
    },
    parse: {
      ...original.parse,
      detectAndParse: vi.fn(),
    },
    query: {
      ...original.query,
      buildSessionMetadata: vi.fn(),
      buildSessionTimeline: vi.fn(),
    },
    record: {
      ...original.record,
      initStateManager: vi.fn().mockResolvedValue(undefined),
    },
    format: {
      ...original.format,
      collapseConversations: vi.fn(),
      collapseDeltas: vi.fn(),
    },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { cmdExport } from "./export.js";
import { GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";
import {
  store as mockedStore,
  parse as mockedParse,
  query as mockedQuery,
  record as mockedRecord,
  format as mockedFormat,
} from "@opencode-trace/core";

const getSessionRecordsMock = vi.mocked(mockedStore.getSessionRecords);
const exportSessionZipMock = vi.mocked(mockedStore.exportSessionZip);
const readSessionMetadataMock = vi.mocked(mockedStore.readSessionMetadata);
const detectAndParseMock = vi.mocked(mockedParse.detectAndParse);
const buildSessionMetadataMock = vi.mocked(mockedQuery.buildSessionMetadata);
const buildSessionTimelineMock = vi.mocked(mockedQuery.buildSessionTimeline);
const initStateManagerMock = vi.mocked(mockedRecord.initStateManager);
const collapseConversationsMock = vi.mocked(mockedFormat.collapseConversations);
const collapseDeltasMock = vi.mocked(mockedFormat.collapseDeltas);

let testDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function makeRecord(id: number) {
  return {
    id,
    purpose: "chat",
    requestAt: `2024-01-01T00:00:0${id}Z`,
    responseAt: `2024-01-01T00:00:0${id}Z`,
    request: { method: "POST", url: "https://api.test/v1/chat", headers: {}, body: {} },
    response: { status: 200, statusText: "OK", headers: {}, body: {} },
    error: null,
  };
}

function makeConversation(provider = "openai") {
  return {
    provider,
    model: "gpt-4",
    msgs: [
      { id: "msg-1", role: "user" as const, blocks: [{ type: "text" as const, text: "hi" }] },
    ],
    usage: null,
    stream: false,
  };
}

function makeDelta() {
  return {
    msgs: [
      { id: "msg-1", added: [{ type: "text" as const, text: "hello" }], removed: [] },
    ],
  };
}

function makeTimeline(records: { id: number }[]) {
  return {
    sessionId: "my-session",
    totalRequests: records.length,
    changes: records.map((r) => ({
      requestId: r.id,
      delta: makeDelta(),
      interRequestDuration: null,
      isUserCall: r.id === 1,
    })),
  };
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "cli-export-test-"));
  process.env._TEST_DIR_ = testDir;
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit_${code}`);
  }) as never);

  // Default mocks: session is found via metadata; records are non-empty
  readSessionMetadataMock.mockReturnValue({ sessionId: "my-session" } as any);
  getSessionRecordsMock.mockReturnValue([makeRecord(1)]);
  detectAndParseMock.mockReturnValue(makeConversation());
  buildSessionMetadataMock.mockReturnValue({
    sessionId: "my-session",
    tokenUsage: {
      inputMissTokens: 0,
      inputHitTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheHitRate: 0,
    },
    requestCount: 1,
    subSessions: [],
    parentSession: null,
    createdAt: null,
    updatedAt: null,
    latencyStats: null,
    durationStats: null,
  });
  buildSessionTimelineMock.mockReturnValue(makeTimeline([{ id: 1 }]));
  initStateManagerMock.mockResolvedValue(undefined);
  collapseConversationsMock.mockReturnValue({
    main: "<root/>",
    blocks: new Map<string, string>(),
  });
  collapseDeltasMock.mockReturnValue({
    main: "<root/>",
    blocks: new Map<string, string>(),
  });
  exportSessionZipMock.mockResolvedValue(Buffer.from("PKZIPDATA"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env._TEST_DIR_;
  vi.restoreAllMocks();
});

describe("cmdExport - error paths", () => {
  it("exits with 1 when sessionId is missing", async () => {
    await expect(cmdExport([])).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith("Error: session-id is required");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when -t or -o is missing", async () => {
    await expect(cmdExport(["my-session"])).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith(
      "Error: -t <type> and -o <path> are required",
    );
  });

  it("exits with 1 when only -t is provided (no -o)", async () => {
    await expect(
      cmdExport(["my-session", "-t", "metadata"]),
    ).rejects.toThrow("exit_1");
  });

  it("exits with 1 when session not found", async () => {
    readSessionMetadataMock.mockReturnValue(null);
    getSessionRecordsMock.mockReturnValue([]);

    await expect(
      cmdExport(["nonexistent", "-t", "metadata", "-o", "/tmp/out.json"]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith("Session not found: nonexistent");
  });

  it("exits with 1 when no records found", async () => {
    getSessionRecordsMock.mockReturnValue([]);

    await expect(
      cmdExport(["my-session", "-t", "metadata", "-o", "/tmp/out.json"]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith("No records found");
  });

  it("exits with 1 for unknown export type (caught by parseFlags)", async () => {
    await expect(
      cmdExport(["my-session", "-t", "unknown", "-o", "/tmp/out"]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith(
      "Error: Invalid export type: unknown. Valid: metadata, conversation, changes, raw",
    );
  });

  it("exits with 1 for invalid --format value", async () => {
    await expect(
      cmdExport([
        "my-session",
        "-t",
        "metadata",
        "-o",
        "out.json",
        "--format",
        "invalid",
      ]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith(
      "Error: Invalid format: invalid. Valid: json, xml",
    );
  });
});

describe("cmdExport - metadata type", () => {
  const META_OUT = resolve(join(tmpdir(), "metadata-out.json"));
  const META_OUT_ALT = resolve(join(tmpdir(), "meta.json"));

  it("writes the metadata to the output file as pretty JSON and reports success", async () => {
    await cmdExport([
      "my-session",
      "-t",
      "metadata",
      "-o",
      META_OUT,
    ]);

    expect(initStateManagerMock).toHaveBeenCalled();
    expect(getSessionRecordsMock).toHaveBeenCalledWith("my-session", {
      traceDir: LOCAL_TRACE_DIR,
    });
    expect(detectAndParseMock).toHaveBeenCalledTimes(1);
    expect(buildSessionMetadataMock).toHaveBeenCalledTimes(1);
    const args = buildSessionMetadataMock.mock.calls[0];
    expect(args[0]).toBe("my-session");
    expect(args[1]).toHaveLength(1);
    expect(args[1][0].id).toBe(1);
    expect(args[1][0].parsed).toBeDefined();

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith(
      META_OUT,
      expect.stringContaining('"sessionId": "my-session"'),
      "utf-8",
    );
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, path: META_OUT }),
    );
  });

  it("merges createdAt, updatedAt, and enabled from sessionMeta when present", async () => {
    readSessionMetadataMock.mockReturnValue({
      sessionId: "my-session",
      title: "Sample",
      createdAt: "2024-05-01T00:00:00Z",
      updatedAt: "2024-05-01T01:00:00Z",
      enabled: true,
    } as any);

    await cmdExport([
      "my-session",
      "-t",
      "metadata",
      "-o",
      META_OUT_ALT,
    ]);

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = (writeFileSync as any).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.createdAt).toBe("2024-05-01T00:00:00Z");
    expect(parsed.updatedAt).toBe("2024-05-01T01:00:00Z");
    expect(parsed.enabled).toBe(true);
  });

  it("falls back gracefully when sessionMeta is null (no enabled field added)", async () => {
    // findSessionTraceDir uses readSessionMetadata first; let it return
    // valid for the first call (LOCAL dir) to pick that dir, then null
    // for the subsequent call from export.ts.
    let callCount = 0;
    readSessionMetadataMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { sessionId: "my-session" } as any;
      return null;
    });

    await cmdExport([
      "my-session",
      "-t",
      "metadata",
      "-o",
      META_OUT_ALT,
    ]);

    const written = (writeFileSync as any).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.sessionId).toBe("my-session");
    expect(parsed.enabled).toBeUndefined();
  });
});

describe("cmdExport - conversation type", () => {
  const CONV_FOLDER = resolve(join(tmpdir(), "out-folder"));
  const CONV_OUT = resolve(join(tmpdir(), "conv-out"));
  const CONV_OUT_MAIN_XML = join(CONV_OUT, "main.xml");
  const CONV_OUT_JSON_FORBIDDEN = resolve(join(tmpdir(), "out.json"));
  const CONV_OUT_XML_FORBIDDEN = resolve(join(tmpdir(), "out.xml"));

  it("calls collapseConversations and writeCollapsedExport, writes to folder", async () => {
    await cmdExport([
      "my-session",
      "-t",
      "conversation",
      "-o",
      CONV_FOLDER,
    ]);

    expect(collapseConversationsMock).toHaveBeenCalledTimes(1);
    const convArgs = collapseConversationsMock.mock.calls[0];
    // conversations map: last record id (1) only by default
    expect(Object.keys(convArgs[0] as object)).toEqual(["1"]);
    expect(convArgs[1]).toMatchObject({
      collapse: undefined,
      collapseBlocks: undefined,
      format: "json",
    });

    // writeCollapsedExport is the real function and calls writeFileSync + mkdirSync
    expect(mkdirSync).toHaveBeenCalledWith(CONV_FOLDER, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      join(CONV_FOLDER, "main.json"),
      "<root/>",
      "utf-8",
    );
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, path: CONV_FOLDER, files: 1 }),
    );
  });

  it("exits with 1 when -o ends with .json (must be folder)", async () => {
    await expect(
      cmdExport([
        "my-session",
        "-t",
        "conversation",
        "-o",
        CONV_OUT_JSON_FORBIDDEN,
      ]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith(
      "Error: Output path must be a folder for export",
    );
  });

  it("exits with 1 when -o ends with .xml (must be folder)", async () => {
    await expect(
      cmdExport([
        "my-session",
        "-t",
        "conversation",
        "-o",
        CONV_OUT_XML_FORBIDDEN,
      ]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith(
      "Error: Output path must be a folder for export",
    );
  });

  it("filters records by -r 1:3 (only records in range)", async () => {
    getSessionRecordsMock.mockReturnValue([
      makeRecord(1),
      makeRecord(2),
      makeRecord(3),
    ]);

    await cmdExport([
      "my-session",
      "-t",
      "conversation",
      "-o",
      CONV_OUT,
      "-r",
      "1:3",
    ]);

    const convArgs = collapseConversationsMock.mock.calls[0];
    const convMap = convArgs[0] as Record<number, unknown>;
    // inRange is half-open: 1:3 => ids 1, 2 only
    expect(Object.keys(convMap).sort()).toEqual(["1", "2"]);
  });

  it("uses --collapse sys,msgs and passes parsed list to collapseConversations", async () => {
    await cmdExport([
      "my-session",
      "-t",
      "conversation",
      "-o",
      CONV_OUT,
      "--collapse",
      "sys,msgs",
    ]);

    const convArgs = collapseConversationsMock.mock.calls[0];
    expect(convArgs[1]).toMatchObject({ collapse: ["sys", "msgs"] });
  });

  it("uses --collapse-blocks text,thinking and passes parsed list to collapseConversations", async () => {
    await cmdExport([
      "my-session",
      "-t",
      "conversation",
      "-o",
      CONV_OUT,
      "--collapse-blocks",
      "text,thinking",
    ]);

    const convArgs = collapseConversationsMock.mock.calls[0];
    expect(convArgs[1]).toMatchObject({
      collapseBlocks: ["text", "thinking"],
    });
  });

  it("uses --format xml and writes main.xml with format=xml passed through", async () => {
    await cmdExport([
      "my-session",
      "-t",
      "conversation",
      "-o",
      CONV_OUT,
      "--format",
      "xml",
    ]);

    const convArgs = collapseConversationsMock.mock.calls[0];
    expect(convArgs[1]).toMatchObject({ format: "xml" });
    expect(writeFileSync).toHaveBeenCalledWith(
      CONV_OUT_MAIN_XML,
      "<root/>",
      "utf-8",
    );
  });
});

describe("cmdExport - changes type", () => {
  const CHANGES_OUT = resolve(join(tmpdir(), "changes"));
  const CHANGES_OUT_FORBIDDEN = resolve(join(tmpdir(), "out.json"));

  it("calls buildSessionTimeline, collapseDeltas, and writeCollapsedExport", async () => {
    getSessionRecordsMock.mockReturnValue([
      makeRecord(1),
      makeRecord(2),
      makeRecord(3),
    ]);
    buildSessionTimelineMock.mockReturnValue(makeTimeline([{ id: 1 }, { id: 2 }, { id: 3 }]));

    await cmdExport([
      "my-session",
      "-t",
      "changes",
      "-o",
      CHANGES_OUT,
    ]);

    expect(buildSessionTimelineMock).toHaveBeenCalledTimes(1);
    expect(collapseDeltasMock).toHaveBeenCalledTimes(1);
    expect(mkdirSync).toHaveBeenCalledWith(CHANGES_OUT, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      join(CHANGES_OUT, "main.json"),
      "<root/>",
      "utf-8",
    );
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, path: CHANGES_OUT, files: 1 }),
    );
  });

  it("exits with 1 when -o ends with .json", async () => {
    await expect(
      cmdExport(["my-session", "-t", "changes", "-o", CHANGES_OUT_FORBIDDEN]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith(
      "Error: Output path must be a folder for export",
    );
  });

  it("with -r 2: (open end) includes changes from 2 to last (upper-exclusive)", async () => {
    getSessionRecordsMock.mockReturnValue([
      makeRecord(1),
      makeRecord(2),
      makeRecord(3),
    ]);
    buildSessionTimelineMock.mockReturnValue(makeTimeline([{ id: 1 }, { id: 2 }, { id: 3 }]));

    await cmdExport([
      "my-session",
      "-t",
      "changes",
      "-o",
      CHANGES_OUT,
      "-r",
      "2:",
    ]);

    const deltasArgs = collapseDeltasMock.mock.calls[0];
    const deltasMap = deltasArgs[0] as Record<number, unknown>;
    // parseRange("2:", lastReqId=3) => {start:2, end:null}; includes 2,3
    expect(Object.keys(deltasMap).sort()).toEqual(["2", "3"]);
  });

  it("without -r includes all changes (range is null)", async () => {
    getSessionRecordsMock.mockReturnValue([
      makeRecord(1),
      makeRecord(2),
    ]);
    buildSessionTimelineMock.mockReturnValue(makeTimeline([{ id: 1 }, { id: 2 }]));

    await cmdExport([
      "my-session",
      "-t",
      "changes",
      "-o",
      CHANGES_OUT,
    ]);

    const deltasArgs = collapseDeltasMock.mock.calls[0];
    const deltasMap = deltasArgs[0] as Record<number, unknown>;
    expect(Object.keys(deltasMap).sort()).toEqual(["1", "2"]);
  });
});

describe("cmdExport - raw type", () => {
  const RAW_OUT_ZIP = resolve(join(tmpdir(), "out.zip"));

  it("calls exportSessionZip and writes the buffer via writeFileSync", async () => {
    const buf = Buffer.from("PKZIPDATA");
    exportSessionZipMock.mockResolvedValue(buf);

    await cmdExport([
      "my-session",
      "-t",
      "raw",
      "-o",
      RAW_OUT_ZIP,
    ]);

    expect(exportSessionZipMock).toHaveBeenCalledWith("my-session", {
      traceDir: LOCAL_TRACE_DIR,
    });
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith(RAW_OUT_ZIP, buf);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, path: RAW_OUT_ZIP }),
    );
  });

  it("warns to console.error when -r is given with -t raw, but still exports", async () => {
    const buf = Buffer.from("PKZIPDATA");
    exportSessionZipMock.mockResolvedValue(buf);

    await cmdExport([
      "my-session",
      "-t",
      "raw",
      "-o",
      RAW_OUT_ZIP,
      "-r",
      "1:3",
    ]);

    expect(errSpy).toHaveBeenCalledWith(
      "Warning: -r parameter is not applicable for raw export type",
    );
    expect(exportSessionZipMock).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalledWith(RAW_OUT_ZIP, buf);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, path: RAW_OUT_ZIP }),
    );
  });

  it("exits with 1 and logs error when exportSessionZip throws", async () => {
    exportSessionZipMock.mockRejectedValue(new Error("zip failure"));

    await expect(
      cmdExport(["my-session", "-t", "raw", "-o", RAW_OUT_ZIP]),
    ).rejects.toThrow("exit_1");
    expect(errSpy).toHaveBeenCalledWith("Failed to export: zip failure");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
