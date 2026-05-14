import type { Parser } from "./types.js";

const parsers: Parser[] = [];

export function registerParser(parser: Parser): void {
  if (parsers.some((p) => p.provider === parser.provider)) {
    throw new Error(`Parser already registered for provider: ${parser.provider}`);
  }
  parsers.push(parser);
}

export function getParsers(): Parser[] {
  return [...parsers];
}

export function clearParsersForTesting(): void {
  parsers.length = 0;
}