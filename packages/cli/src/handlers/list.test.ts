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
      listSessionsFromBothDirs: vi.fn(),
    },
  };
});

import { store as mockedCore } from "@opencode-trace/core";
import { cmdList } from "./list.js";
import { GLOBAL_TRACE_DIR, LOCAL_TRACE_DIR } from "../utils.js";

const listSessionsFromBothDirsMock = vi.mocked(mockedCore.listSessionsFromBothDirs);

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe("cmdList", () => {
  it("calls listSessionsFromBothDirs with GLOBAL_TRACE_DIR and LOCAL_TRACE_DIR", () => {
    listSessionsFromBothDirsMock.mockReturnValue([]);

    cmdList([]);

    expect(listSessionsFromBothDirsMock).toHaveBeenCalledTimes(1);
    expect(listSessionsFromBothDirsMock).toHaveBeenCalledWith({
      globalDir: GLOBAL_TRACE_DIR,
      localDir: LOCAL_TRACE_DIR,
    });
  });

  it("prints 'No sessions found.' when no sessions exist", () => {
    listSessionsFromBothDirsMock.mockReturnValue([]);

    cmdList([]);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith("No sessions found.");
  });

  it("prints each global session with [global] tag, id, title, created, updated", () => {
    listSessionsFromBothDirsMock.mockReturnValue([
      {
        id: "session-1",
        requestCount: 3,
        title: "First Session",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T01:00:00Z",
        scope: "global",
      },
    ]);

    cmdList([]);

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls[0][0] as string;
    expect(output).toContain("session-1");
    expect(output).toContain("[global]");
    expect(output).toContain("title:First Session");
    expect(output).toContain("created:2024-01-01T00:00:00Z");
    expect(output).toContain("updated:2024-01-01T01:00:00Z");
  });

  it("prints local-scoped session with [local] tag", () => {
    listSessionsFromBothDirsMock.mockReturnValue([
      {
        id: "session-local",
        requestCount: 1,
        title: "Local Title",
        createdAt: "2024-02-01T00:00:00Z",
        updatedAt: "2024-02-01T00:30:00Z",
        scope: "local",
      },
    ]);

    cmdList([]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    expect(output).toContain("session-local");
    expect(output).toContain("[local]");
    expect(output).not.toContain("[global]");
  });

  it("prints '?' for missing title, createdAt, updatedAt", () => {
    listSessionsFromBothDirsMock.mockReturnValue([
      {
        id: "session-incomplete",
        requestCount: 0,
        title: undefined,
        createdAt: null,
        updatedAt: null,
        scope: "global",
      },
    ]);

    cmdList([]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    expect(output).toContain("session-incomplete");
    expect(output).toContain("title:?");
    expect(output).toContain("created:?");
    expect(output).toContain("updated:?");
  });

  it("prints multiple sessions, one per line", () => {
    listSessionsFromBothDirsMock.mockReturnValue([
      {
        id: "sess-a",
        requestCount: 1,
        title: "A",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T01:00:00Z",
        scope: "global",
      },
      {
        id: "sess-b",
        requestCount: 2,
        title: "B",
        createdAt: "2024-01-02T00:00:00Z",
        updatedAt: "2024-01-02T01:00:00Z",
        scope: "local",
      },
    ]);

    cmdList([]);

    expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    const first = consoleLogSpy.mock.calls[0][0] as string;
    const second = consoleLogSpy.mock.calls[1][0] as string;
    expect(first).toContain("sess-a");
    expect(first).toContain("[global]");
    expect(second).toContain("sess-b");
    expect(second).toContain("[local]");
  });

  it("output format matches '<id> [<scope>]  title:<title>  created:<date>  updated:<date>'", () => {
    listSessionsFromBothDirsMock.mockReturnValue([
      {
        id: "fmt-check",
        requestCount: 1,
        title: "T",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T01:00:00Z",
        scope: "global",
      },
    ]);

    cmdList([]);

    const output = consoleLogSpy.mock.calls[0][0] as string;
    expect(output).toBe(
      "fmt-check [global]  title:T  created:2024-01-01T00:00:00Z  updated:2024-01-01T01:00:00Z",
    );
  });

  it("ignores extra positional args (args currently unused)", () => {
    listSessionsFromBothDirsMock.mockReturnValue([]);

    cmdList(["ignored-arg", "another-arg"]);

    expect(listSessionsFromBothDirsMock).toHaveBeenCalledWith({
      globalDir: GLOBAL_TRACE_DIR,
      localDir: LOCAL_TRACE_DIR,
    });
    expect(consoleLogSpy).toHaveBeenCalledWith("No sessions found.");
  });
});
