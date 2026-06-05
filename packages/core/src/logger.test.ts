import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import winston from "winston";
import type Transport from "winston-transport";

describe("logger", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPENTRACE_LOG;
    delete process.env.OPENTRACE_LOG_FILE;
    delete process.env.OPENTRACE_LOG_LEVEL;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!Object.prototype.hasOwnProperty.call(originalEnv, k)) {
        delete process.env[k];
      }
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      process.env[k] = v;
    }
    vi.resetModules();
  });

  it("defaults to file transport (does not write to stderr)", async () => {
    vi.resetModules();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { logger, __testing } = await import("./logger.js");

    logger.info("hello-default");

    expect(__testing.resolveMode()).toBe("file");
    const kinds = logger.transports.map((t) => t.constructor.name);
    expect(kinds).toContain("File");
    expect(kinds).not.toContain("Console");

    stderrSpy.mockRestore();
  });

  it("OPENTRACE_LOG=console switches to Console transport", async () => {
    process.env.OPENTRACE_LOG = "console";
    vi.resetModules();
    const { __testing, logger } = await import("./logger.js");

    expect(__testing.resolveMode()).toBe("console");
    const kinds = logger.transports.map((t) => t.constructor.name);
    expect(kinds).toContain("Console");
    expect(kinds).not.toContain("File");
  });

  it("OPENTRACE_LOG=off removes all transports (silent)", async () => {
    process.env.OPENTRACE_LOG = "off";
    vi.resetModules();
    const { __testing, logger } = await import("./logger.js");

    expect(__testing.resolveMode()).toBe("off");
    expect(logger.transports).toHaveLength(0);
  });

  it("OPENTRACE_LOG_FILE overrides the file path", async () => {
    process.env.OPENTRACE_LOG_FILE = "/tmp/custom-opentrace.log";
    vi.resetModules();
    const { logger } = await import("./logger.js");

    const fileTransport = logger.transports.find(
      (t) => t instanceof winston.transports.File,
    ) as (Transport & { dirname?: string; filename?: string }) | undefined;
    expect(fileTransport).toBeDefined();
    expect(fileTransport!.dirname).toBe("/tmp");
    expect(fileTransport!.filename).toBe("custom-opentrace.log");
  });

  it("OPENTRACE_LOG_LEVEL overrides level", async () => {
    process.env.OPENTRACE_LOG_LEVEL = "debug";
    vi.resetModules();
    const { logger } = await import("./logger.js");

    expect(logger.level).toBe("debug");
  });
});
