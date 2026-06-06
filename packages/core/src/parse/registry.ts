import type { Parser } from "../model/types.js";

interface ParserRegistration {
  parser: Parser;
  pathPattern: string;
  hostPattern?: string;
}

const registrations: ParserRegistration[] = [];

export function registerParser(
  parser: Parser,
  pathPattern: string,
  hostPattern?: string,
): void {
  if (registrations.some((r) => r.parser.provider === parser.provider)) {
    throw new Error(`Parser already registered for provider: ${parser.provider}`);
  }
  registrations.push({ parser, pathPattern, hostPattern });
}

export function findParser(url: string): Parser | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const pathname = parsed.pathname;
  const hostname = parsed.hostname;

  const candidates = registrations.filter((r) =>
    pathname.endsWith(r.pathPattern),
  );

  if (candidates.length === 0) return null;

  const exact = candidates.find(
    (r) => r.hostPattern && hostname === r.hostPattern,
  );
  if (exact) return exact.parser;

  const fallback = candidates.find((r) => !r.hostPattern);
  if (fallback) return fallback.parser;

  return candidates[0].parser;
}

export function getRegistrations(): ParserRegistration[] {
  return [...registrations];
}

export function clearRegistrations(): void {
  registrations.length = 0;
}

export function clearParsersForTesting(): void {
  clearRegistrations();
}

export function getParsers(): Parser[] {
  return registrations.map((r) => r.parser);
}
