/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@opencode-trace/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@opencode-trace/core")>();
  return {
    ...original,
    store: {
      ...original.store,
      readSessionMetadata: vi.fn(),
      getSessionRecords: vi.fn(),
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
  };
});

import {
  store as mockedStore,
  parse as mockedParse,
  query as mockedQuery,
  record as mockedRecord,
} from "@opencode-trace/core";
import { cmdShow } from "./show.js";
import type { TraceRecord } from "@opencode-trace/core";

const readSessionMetadataMock = vi.mocked(mockedStore.readSessionMetadata);
const getSessionRecordsMock = vi.mocked(mockedStore.getSessionRecords);
const detectAndParseMock = vi.mocked(mockedParse.detectAndParse);
const buildSessionMetadataMock = vi.mocked(mockedQuery.buildSessionMetadata);
const buildSessionTimelineMock = vi.mocked(mockedQuery.buildSessionTimeline);
const initStateManagerMock = vi.mocked(mockedRecord.initStateManager);

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function makeRecord(id: number): TraceRecord {
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
      {
        id: "msg-1",
        role: "user" as const,
        blocks: [{ type: "text" as const, text: "hi" }],
      },
    ],
    usage: null,
    stream: false,
  };
}

function makeDelta() {
  return {
    msgs: [
      {
        id: "msg-1",
        added: [{ type: "text" as const, text: "hello" }],
        removed: [],
      },
    ],
  };
}

function defaultSessionMeta(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "my-session",
    title: "Sample",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:05Z",
    enabled: true,
    ...overrides,
  };
}

function defaultMetadata(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null) => {
      throw new Error(`exit_${code ?? 0}`);
    });

  readSessionMetadataMock.mockReturnValue(defaultSessionMeta());
  getSessionRecordsMock.mockReturnValue([]);
  detectAndParseMock.mockReturnValue(makeConversation());
  buildSessionMetadataMock.mockReturnValue(defaultMetadata());
  buildSessionTimelineMock.mockReturnValue({
    sessionId: "my-session",
    totalRequests: 0,
    changes: [],
  });
  initStateManagerMock.mockResolvedValue(undefined);
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  exitSpy.mockRestore();
});

describe("cmdShow - input validation", () => {
  it("exits with 1 when sessionId is missing", async () => {
    await expect(cmdShow([])).rejects.toThrow("exit_1");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error: session-id and subcommand are required",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when subcommand is missing", async () => {
    await expect(cmdShow(["my-session"])).rejects.toThrow("exit_1");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error: session-id and subcommand are required",
    );
  });

  it("exits with 1 when session not found", async () => {
    readSessionMetadataMock.mockReturnValue(null);
    getSessionRecordsMock.mockReturnValue([]);

    await expect(cmdShow(["nonexistent", "metadata"])).rejects.toThrow("exit_1");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Session not found: nonexistent");
  });

  it("exits with 1 when no records found", async () => {
    getSessionRecordsMock.mockReturnValue([]);

    await expect(cmdShow(["my-session", "metadata"])).rejects.toThrow("exit_1");
    expect(consoleErrorSpy).toHaveBeenCalledWith("No records found");
  });

  it("exits with 1 for unknown subcommand", async () => {
    getSessionRecordsMock.mockReturnValue([makeRecord(1)]);

    await expect(
      cmdShow(["my-session", "unknown-subcommand"]),
    ).rejects.toThrow("exit_1");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Unknown subcommand: unknown-subcommand",
    );
  });
});

describe("cmdShow - metadata", () => {
  it("calls buildSessionMetadata with parsed records and prints JSON", async () => {
    const rec = makeRecord(1);
    getSessionRecordsMock.mockReturnValue([rec]);
    buildSessionMetadataMock.mockReturnValue(
      defaultMetadata({ requestCount: 1 }),
    );

    await cmdShow(["my-session", "metadata"]);

    expect(initStateManagerMock).toHaveBeenCalled();
    expect(buildSessionMetadataMock).toHaveBeenCalledTimes(1);
    const args = buildSessionMetadataMock.mock.calls[0];
    expect(args[0]).toBe("my-session");
    expect(args[1]).toHaveLength(1);
    expect(args[1][0].id).toBe(1);
    expect(args[1][0].parsed).toBeDefined();

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.sessionId).toBe("my-session");
    expect(parsed.requestCount).toBe(1);
  });

  it("merges createdAt, updatedAt, enabled from sessionMeta when present", async () => {
    getSessionRecordsMock.mockReturnValue([makeRecord(1)]);
    readSessionMetadataMock.mockReturnValue(
      defaultSessionMeta({
        createdAt: "2024-05-01T00:00:00Z",
        updatedAt: "2024-05-01T01:00:00Z",
        enabled: true,
      }),
    );

    await cmdShow(["my-session", "metadata"]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.createdAt).toBe("2024-05-01T00:00:00Z");
    expect(parsed.updatedAt).toBe("2024-05-01T01:00:00Z");
    expect(parsed.enabled).toBe(true);
  });

  it("falls back gracefully when sessionMeta is null", async () => {
    getSessionRecordsMock.mockReturnValue([makeRecord(1)]);

    // findSessionTraceDir uses readSessionMetadata too, so we let
    // it succeed first (to resolve traceDir) and then return null
    // for the show.ts-internal call. The util uses 2 trace dirs;
    // for simplicity we mock getSessionRecords path to resolve dir.
    let callCount = 0;
    readSessionMetadataMock.mockImplementation(() => {
      callCount++;
      // First call(s): findSessionTraceDir asks local then global metadata
      // Return a valid meta so it picks LOCAL_TRACE_DIR. Then show.ts
      // calls again with the resolved traceDir; return null this time.
      if (callCount <= 1) return defaultSessionMeta();
      return null;
    });

    await cmdShow(["my-session", "metadata"]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.sessionId).toBe("my-session");
    // No enabled field added because sessionMeta was null
    expect(parsed.enabled).toBeUndefined();
  });
});

describe("cmdShow - conversation", () => {
  it("returns only the last request by default (no -r flag)", async () => {
    const records = [makeRecord(1), makeRecord(2), makeRecord(3)];
    getSessionRecordsMock.mockReturnValue(records);

    await cmdShow(["my-session", "conversation"]);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    // Only last record id should be present
    expect(Object.keys(parsed)).toEqual(["3"]);
    expect(parsed["3"].provider).toBe("openai");
  });

  it("filters records by range with -r 1:3 (half-open)", async () => {
    const records = [makeRecord(1), makeRecord(2), makeRecord(3)];
    getSessionRecordsMock.mockReturnValue(records);

    await cmdShow(["my-session", "conversation", "-r", "1:3"]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    // inRange uses upper bound exclusive: 1:3 => ids 1, 2 only
    expect(Object.keys(parsed).sort()).toEqual(["1", "2"]);
  });

  it("outputs XML when --format xml is set", async () => {
    getSessionRecordsMock.mockReturnValue([makeRecord(1)]);

    await cmdShow(["my-session", "conversation", "--format", "xml"]);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0] as string;
    // XML output (not JSON parseable as object) — should look like xml
    expect(output).toMatch(/<\/?\w+/);
    // And shouldn't be plain JSON of the map
    expect(output.trim().startsWith("{")).toBe(false);
  });

  it("compact flag is ignored when format is xml", async () => {
    getSessionRecordsMock.mockReturnValue([makeRecord(1)]);

    await cmdShow([
      "my-session",
      "conversation",
      "--format",
      "xml",
      "--compact",
    ]);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0] as string;
    // Still XML — compact does not apply to XML branch
    expect(output).toMatch(/<\/?\w+/);
  });

  it("calls detectAndParse for each in-range record", async () => {
    const records = [makeRecord(1), makeRecord(2), makeRecord(3)];
    getSessionRecordsMock.mockReturnValue(records);

    await cmdShow(["my-session", "conversation", "-r", "1:3"]);

    // detectAndParse is called once per in-range record (ids 1, 2)
    expect(detectAndParseMock).toHaveBeenCalledTimes(2);
  });
});

describe("cmdShow - changes", () => {
  it("returns all changes by default (no -r flag => range is null)", async () => {
    const records = [makeRecord(1), makeRecord(2), makeRecord(3)];
    getSessionRecordsMock.mockReturnValue(records);
    buildSessionTimelineMock.mockReturnValue({
      sessionId: "my-session",
      totalRequests: 3,
      changes: [
        { requestId: 1, delta: makeDelta(), interRequestDuration: null, isUserCall: true },
        { requestId: 2, delta: makeDelta(), interRequestDuration: null, isUserCall: false },
        { requestId: 3, delta: makeDelta(), interRequestDuration: null, isUserCall: false },
      ],
    });

    await cmdShow(["my-session", "changes"]);

    expect(buildSessionTimelineMock).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(Object.keys(parsed).sort()).toEqual(["1", "2", "3"]);
  });

  it("filters changes with -r 2 (range from 2 to last, upper-exclusive)", async () => {
    const records = [makeRecord(1), makeRecord(2), makeRecord(3)];
    getSessionRecordsMock.mockReturnValue(records);
    buildSessionTimelineMock.mockReturnValue({
      sessionId: "my-session",
      totalRequests: 3,
      changes: [
        { requestId: 1, delta: makeDelta(), interRequestDuration: null, isUserCall: true },
        { requestId: 2, delta: makeDelta(), interRequestDuration: null, isUserCall: false },
        { requestId: 3, delta: makeDelta(), interRequestDuration: null, isUserCall: false },
      ],
    });

    await cmdShow(["my-session", "changes", "-r", "2"]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    // parseRange("2", lastReqId=3) => {start:2, end:3}; inRange:
    //   reqId 2 -> true (2 >= 2 && 2 < 3)
    //   reqId 3 -> false (3 >= 3)
    expect(Object.keys(parsed)).toEqual(["2"]);
  });

  it("outputs deltas map as XML when --format xml is set", async () => {
    getSessionRecordsMock.mockReturnValue([makeRecord(1)]);
    buildSessionTimelineMock.mockReturnValue({
      sessionId: "my-session",
      totalRequests: 1,
      changes: [
        { requestId: 1, delta: makeDelta(), interRequestDuration: null, isUserCall: true },
      ],
    });

    await cmdShow(["my-session", "changes", "--format", "xml"]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/<\/?\w+/);
  });
});
