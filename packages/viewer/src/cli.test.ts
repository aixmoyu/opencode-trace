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

  it("--port sets the port", async () => {
    mockInstance.url = "http://localhost:4000";
    await loadCliWithArgs(["--port", "4000"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 4000,
      open: true,
      traceDir: undefined,
    });
    expect(logSpy).toHaveBeenCalledWith(
      "opencode-trace viewer running at http://localhost:4000",
    );
  });

  it("-p (short) sets the port", async () => {
    mockInstance.url = "http://localhost:4001";
    await loadCliWithArgs(["-p", "4001"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 4001,
      open: true,
      traceDir: undefined,
    });
  });

  it("--no-open disables browser open", async () => {
    await loadCliWithArgs(["--no-open"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3210,
      open: false,
      traceDir: undefined,
    });
  });

  it("-n (short) disables browser open", async () => {
    await loadCliWithArgs(["-n"]);
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

  it("-d (short) sets traceDir", async () => {
    await loadCliWithArgs(["-d", "/tmp/x"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3210,
      open: true,
      traceDir: "/tmp/x",
    });
  });

  it("combines -p, -n, -d short forms", async () => {
    mockInstance.url = "http://localhost:3211";
    await loadCliWithArgs(["-p", "3211", "-n", "-d", "/tmp/x"]);
    expect(mockCreateViewer).toHaveBeenCalledWith({
      port: 3211,
      open: false,
      traceDir: "/tmp/x",
    });
  });

  it("invalid port prints usage and exits with code 1", async () => {
    vi.resetModules();
    process.argv = ["node", "cli.js", "--port", "abc"];
    await expect(import("./cli.js")).rejects.toThrow("exit_1");
    expect(errorSpy).toHaveBeenCalledWith("Error: invalid port: abc");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage: opencode-trace-viewer [options]"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("-p, --port <num>"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("-d, --trace-dir <path>"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("-n, --no-open"),
    );
    expect(mockCreateViewer).not.toHaveBeenCalled();
  });

  it("--port without value prints usage and exits with code 1", async () => {
    vi.resetModules();
    process.argv = ["node", "cli.js", "--port"];
    await expect(import("./cli.js")).rejects.toThrow("exit_1");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("requires a port number"),
    );
    expect(mockCreateViewer).not.toHaveBeenCalled();
  });

  it("--trace-dir without value prints usage and exits with code 1", async () => {
    vi.resetModules();
    process.argv = ["node", "cli.js", "--trace-dir"];
    await expect(import("./cli.js")).rejects.toThrow("exit_1");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("requires a path"),
    );
    expect(mockCreateViewer).not.toHaveBeenCalled();
  });

  it("unknown argument prints usage and exits with code 1", async () => {
    vi.resetModules();
    process.argv = ["node", "cli.js", "--whatever"];
    await expect(import("./cli.js")).rejects.toThrow("exit_1");
    expect(errorSpy).toHaveBeenCalledWith(
      "Error: unknown argument: --whatever",
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
