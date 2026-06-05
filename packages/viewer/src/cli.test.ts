import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockCreateViewer } = vi.hoisted(() => ({
  mockCreateViewer: vi.fn(),
}));

vi.mock("./server.js", () => ({
  createViewer: mockCreateViewer,
}));

describe("cli", () => {
  let originalArgv: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;
  let mockInstance: { url: string; close: ReturnType<typeof vi.fn> };

  async function loadCliWithArgs(args: string[]): Promise<void> {
    vi.resetModules();
    process.argv = ["node", "cli.js", ...args];
    await import("./cli.js");
    await new Promise((resolve) => setImmediate(resolve));
  }

  beforeEach(() => {
    originalArgv = process.argv;
    mockInstance = {
      url: "http://localhost:3210",
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateViewer.mockReset();
    mockCreateViewer.mockResolvedValue(mockInstance);

    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit_${code}`);
    }) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    onSpy = vi.spyOn(process, "on");
  });

  afterEach(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    onSpy.mockRestore();
    vi.resetModules();
  });

  it("uses defaults (port 3210, open=true, no traceDir) when no args", async () => {
    await loadCliWithArgs([]);
    expect(mockCreateViewer).toHaveBeenCalledTimes(1);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3210,
      open: true,
      traceDir: undefined,
    });
    expect(logSpy).toHaveBeenCalledWith(
      "opencode-trace viewer running at http://localhost:3210",
    );
    expect(logSpy).toHaveBeenCalledWith("Press Ctrl+C to stop");
  });

  it("accepts positional port arg", async () => {
    mockInstance.url = "http://localhost:3211";
    await loadCliWithArgs(["3211"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3211,
      open: true,
      traceDir: undefined,
    });
    expect(logSpy).toHaveBeenCalledWith(
      "opencode-trace viewer running at http://localhost:3211",
    );
  });

  it("--no-open disables browser open", async () => {
    await loadCliWithArgs(["--no-open"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3210,
      open: false,
      traceDir: undefined,
    });
  });

  it("--trace-dir sets traceDir", async () => {
    await loadCliWithArgs(["--trace-dir", "/tmp/x"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3210,
      open: true,
      traceDir: "/tmp/x",
    });
  });

  it("combines port, --no-open and --trace-dir", async () => {
    mockInstance.url = "http://localhost:3211";
    await loadCliWithArgs(["3211", "--no-open", "--trace-dir", "/tmp/x"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3211,
      open: false,
      traceDir: "/tmp/x",
    });
  });

  it("invalid port prints usage and exits with code 1", async () => {
    vi.resetModules();
    process.argv = ["node", "cli.js", "abc"];
    await expect(import("./cli.js")).rejects.toThrow("exit_1");
    expect(errorSpy).toHaveBeenCalledWith(
      "Usage: opencode-trace-viewer [port] [--no-open] [--trace-dir <path>]",
    );
    expect(errorSpy).toHaveBeenCalledWith("Default port: 3210");
    expect(errorSpy).toHaveBeenCalledWith(
      "  --no-open      Don't open browser automatically",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "  --trace-dir    Read trace data from custom path instead of ~/.opencode-trace",
    );
    expect(mockCreateViewer).not.toHaveBeenCalled();
  });

  it("registers SIGINT handler that closes instance and exits 0", async () => {
    await loadCliWithArgs([]);

    const sigintCall = onSpy.mock.calls.find((c: unknown[]) => c[0] === "SIGINT");
    expect(sigintCall).toBeDefined();
    const handler = sigintCall![1] as () => void;

    expect(() => handler()).toThrow("exit_0");
    expect(mockInstance.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
