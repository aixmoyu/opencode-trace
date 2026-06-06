import { describe, expect, it, beforeEach } from "vitest";
import type { Parser, Conversation } from "./types.js";
import {
  clearParsersForTesting,
  getParsers,
  registerParser,
  findParser,
} from "./registry.js";

function makeParser(provider: string): Parser {
  return {
    provider,
    parseRequest: (): Conversation => ({
      provider,
      model: null,
      msgs: [],
      usage: null,
      stream: false,
    }),
    parseResponse: () => ({}),
  };
}

describe("parser registry", () => {
  beforeEach(() => {
    clearParsersForTesting();
  });

  it("preserves registration order", () => {
    registerParser(makeParser("a"), "/chat/completions");
    registerParser(makeParser("b"), "/v1/messages");

    const providers = getParsers().map((p) => p.provider);
    expect(providers).toEqual(["a", "b"]);
  });

  it("throws on duplicate provider", () => {
    registerParser(makeParser("dup"), "/chat/completions");
    expect(() => registerParser(makeParser("dup"), "/other")).toThrow("dup");
  });

  it("finds parser by path suffix", () => {
    registerParser(makeParser("openai-chat"), "/chat/completions");
    registerParser(makeParser("anthropic"), "/v1/messages");

    expect(findParser("https://api.openai.com/v1/chat/completions")?.provider).toBe("openai-chat");
    expect(findParser("https://api.anthropic.com/v1/messages")?.provider).toBe("anthropic");
    expect(findParser("https://example.com/unknown")).toBeNull();
  });

  it("matches hostPattern when provided", () => {
    registerParser(makeParser("default-chat"), "/chat/completions");
    registerParser(makeParser("custom-chat"), "/chat/completions", "custom.api.com");

    expect(findParser("https://custom.api.com/v1/chat/completions")?.provider).toBe("custom-chat");
    expect(findParser("https://other.api.com/v1/chat/completions")?.provider).toBe("default-chat");
  });

  it("falls back to first candidate when no hostPattern matches", () => {
    registerParser(makeParser("a"), "/chat/completions", "a.com");
    registerParser(makeParser("b"), "/chat/completions", "b.com");

    expect(findParser("https://c.com/v1/chat/completions")?.provider).toBe("a");
  });

  it("returns null for invalid URL", () => {
    registerParser(makeParser("test"), "/chat/completions");
    expect(findParser("not-a-url")).toBeNull();
  });
});
