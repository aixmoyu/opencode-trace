import { resolve } from "node:path";
import { homedir } from "node:os";
import { store } from "@opencode-trace/core";

export const GLOBAL_TRACE_DIR = resolve(homedir(), ".opencode-trace");
export const LOCAL_TRACE_DIR = resolve(process.cwd(), ".opencode-trace");

export interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface RequestRange {
  start: number;
  end: number | null;
}

export function parseRange(rangeStr: string, lastReqId: number): RequestRange {
  if (!/^\d+(:\d*)?$/.test(rangeStr)) {
    console.error(`Error: Invalid range format: ${rangeStr}. Expected format: "N" or "N:M"`);
    process.exit(1);
  }

  if (rangeStr.includes(":")) {
    const parts = rangeStr.split(":");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : null;

    if (start < 1) {
      console.error(`Error: Range start must be >= 1, got: ${start}`);
      process.exit(1);
    }
    if (end !== null && end <= start) {
      console.error(`Error: Range end must be > start, got: ${start}:${end}`);
      process.exit(1);
    }

    return { start, end };
  }
  const start = parseInt(rangeStr, 10);
  if (start < 1) {
    console.error(`Error: Request ID must be >= 1, got: ${start}`);
    process.exit(1);
  }
  return { start, end: lastReqId };
}

export function inRange(reqId: number, range: RequestRange | null): boolean {
  if (!range) return true;
  if (reqId < range.start) return false;
  if (range.end !== null && reqId >= range.end) return false;
  return true;
}

export function parseFlags(argv: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "-s" || arg === "--session") {
      flags.session = true;
    } else if (arg === "-r" && i + 1 < argv.length) {
      flags.req = argv[++i];
    } else if (arg === "-o" && i + 1 < argv.length) {
      flags.output = argv[++i];
    } else if (arg === "-t" && i + 1 < argv.length) {
      const t = argv[++i];
      if (!["metadata", "conversation", "changes", "raw"].includes(t)) {
        console.error(`Error: Invalid export type: ${t}. Valid: metadata, conversation, changes, raw`);
        process.exit(1);
      }
      flags.type = t;
    } else if (arg === "--format" && i + 1 < argv.length) {
      const fmt = argv[++i];
      if (fmt !== "json" && fmt !== "xml") {
        console.error(`Error: Invalid format: ${fmt}. Valid: json, xml`);
        process.exit(1);
      }
      flags.format = fmt;
    } else if (arg === "--compact") {
      flags.compact = true;
    } else if (arg === "--collapse" && i + 1 < argv.length) {
      flags.collapse = argv[++i];
    } else if (arg === "--collapse-blocks" && i + 1 < argv.length) {
      flags.collapseBlocks = argv[++i];
    } else if (arg === "--repair") {
      flags.repair = true;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
    i++;
  }

  return { positional, flags };
}

export function findSessionTraceDir(sessionId: string): string | null {
  const localMeta = store.readSessionMetadata(sessionId, LOCAL_TRACE_DIR);
  if (localMeta) return LOCAL_TRACE_DIR;

  const globalMeta = store.readSessionMetadata(sessionId, GLOBAL_TRACE_DIR);
  if (globalMeta) return GLOBAL_TRACE_DIR;

  const localRecords = store.getSessionRecords(sessionId, { traceDir: LOCAL_TRACE_DIR });
  if (localRecords.length > 0) return LOCAL_TRACE_DIR;

  const globalRecords = store.getSessionRecords(sessionId, { traceDir: GLOBAL_TRACE_DIR });
  if (globalRecords.length > 0) return GLOBAL_TRACE_DIR;

  return null;
}