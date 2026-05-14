import { describe, expect, it, beforeEach } from "vitest";
import type { Parser, Conversation } from "./types.js";
import { clearParsersForTesting, getParsers, registerParser } from "./registry.js";

function makeParser(provider: string, matchResult: boolean): Parser {
  return {
    provider,
    match: () => matchResult,
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
    registerParser(makeParser("a", false));
    registerParser(makeParser("b", false));

    const providers = getParsers().map((p) => p.provider);
    expect(providers).toEqual(["a", "b"]);
  });

  it("throws on duplicate provider", () => {
    registerParser(makeParser("dup", false));
    expect(() => registerParser(makeParser("dup", false))).toThrow("dup");
  });

  it("returns first registered parser in matching order", () => {
    const first = makeParser("first", true);
    const second = makeParser("second", true);
    registerParser(first);
    registerParser(second);

    const matched = getParsers().find((p) => p.match("/anything", {}));
    expect(matched?.provider).toBe("first");
  });
});