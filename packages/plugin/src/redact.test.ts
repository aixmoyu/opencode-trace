import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

describe("redactHeaders", () => {
  const originalEnv = process.env.OPENCODE_TRACE_REDACT;

  beforeEach(() => {
    vi.stubEnv("OPENCODE_TRACE_REDACT", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalEnv !== undefined) {
      process.env.OPENCODE_TRACE_REDACT = originalEnv;
    } else {
      delete process.env.OPENCODE_TRACE_REDACT;
    }
  });

  test("redacts authorization header with Bearer token", async () => {
    const { redactHeaders } = await import("./redact.js");
    const headers = {
      authorization: "Bearer sk-proj-abc123def456ghi789",
      "content-type": "application/json",
    };
    const result = redactHeaders(headers);
    expect(result.authorization).toBe("Bearer [REDACTED]");
    expect(result["content-type"]).toBe("application/json");
  });

  test("redacts authorization header without Bearer prefix", async () => {
    const { redactHeaders } = await import("./redact.js");
    const headers = {
      authorization: "sk-proj-abc123def456ghi789",
    };
    const result = redactHeaders(headers);
    expect(result.authorization).toBe("[REDACTED]");
  });

  test("redacts api-key header", async () => {
    const { redactHeaders } = await import("./redact.js");
    const headers = {
      "api-key": "my-secret-key-123",
      "x-api-key": "another-secret-key",
    };
    const result = redactHeaders(headers);
    expect(result["api-key"]).toBe("[REDACTED]");
    expect(result["x-api-key"]).toBe("[REDACTED]");
  });

  test("does not redact when OPENCODE_TRACE_REDACT is false", async () => {
    vi.stubEnv("OPENCODE_TRACE_REDACT", "false");
    const { redactHeaders } = await import("./redact.js");
    const headers = {
      authorization: "Bearer sk-proj-abc123",
    };
    const result = redactHeaders(headers);
    expect(result.authorization).toBe("Bearer sk-proj-abc123");
  });

  test("redacts by default when OPENCODE_TRACE_REDACT is not set", async () => {
    vi.stubEnv("OPENCODE_TRACE_REDACT", undefined);
    delete process.env.OPENCODE_TRACE_REDACT;
    const { redactHeaders } = await import("./redact.js");
    const headers = {
      authorization: "Bearer sk-proj-abc123",
    };
    const result = redactHeaders(headers);
    expect(result.authorization).toBe("Bearer [REDACTED]");
  });

  test("preserves non-sensitive headers", async () => {
    vi.stubEnv("OPENCODE_TRACE_REDACT", "true");
    const { redactHeaders } = await import("./redact.js");
    const headers = {
      "content-type": "application/json",
      accept: "text/html",
      "user-agent": "Mozilla/5.0",
    };
    const result = redactHeaders(headers);
    expect(result["content-type"]).toBe("application/json");
    expect(result.accept).toBe("text/html");
    expect(result["user-agent"]).toBe("Mozilla/5.0");
  });
});