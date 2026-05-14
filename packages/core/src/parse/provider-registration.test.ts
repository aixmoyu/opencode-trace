import { describe, expect, it, beforeEach } from "vitest";
import { clearParsersForTesting, getParsers } from "./registry.js";

describe("provider registration", () => {
  beforeEach(() => {
    clearParsersForTesting();
  });

  it("registers known providers on parse index import", async () => {
    await import("./index.js");
    const providers = getParsers().map((p) => p.provider);
    expect(providers).toEqual(["openai-chat", "openai-responses", "anthropic"]);
  });
});
