import { store, parse, query, record } from "@opencode-trace/core";
import { parseFlags, parseRange, inRange, findSessionTraceDir } from "../utils.js";
import { outputData } from "../formatter.js";

export async function cmdShow(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const sessionId = positional[0];
  const subCommand = positional[1];

  if (!sessionId || !subCommand) {
    console.error("Error: session-id and subcommand are required");
    process.exit(1);
  }

  const traceDir = findSessionTraceDir(sessionId);
  if (!traceDir) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  await record.initStateManager(traceDir);

  const formatType = (flags.format as string) || "json";
  const compact = flags.compact === true;
  const records = store.getSessionRecords(sessionId, { traceDir });

  if (records.length === 0) {
    console.error("No records found");
    process.exit(1);
  }

  const lastReqId = records[records.length - 1].id;
  const range = flags.req ? parseRange(flags.req as string, lastReqId) : null;

  switch (subCommand) {
    case "metadata": {
      const parsedRecords = records.map((rec) => ({
        id: rec.id,
        parsed: parse.detectAndParse(rec),
      }));

      const metadata = query.buildSessionMetadata(sessionId, parsedRecords);
      const sessionMeta = store.readSessionMetadata(sessionId, traceDir);
      if (sessionMeta) {
        metadata.createdAt = sessionMeta.createdAt ?? metadata.createdAt;
        metadata.updatedAt = sessionMeta.updatedAt ?? metadata.updatedAt;
        (metadata as any).enabled = sessionMeta.enabled ?? false;
      }

      outputData(metadata, formatType, compact);
      break;
    }

    case "conversation": {
      const effectiveRange = range ?? { start: lastReqId, end: null };
      const result: Record<number, any> = {};

      for (const rec of records) {
        if (inRange(rec.id, effectiveRange)) {
          result[rec.id] = parse.detectAndParse(rec);
        }
      }

      outputData(result, formatType, compact);
      break;
    }

    case "changes": {
      const parsedRecords = records.map((rec) => ({
        id: rec.id,
        parsed: parse.detectAndParse(rec),
      }));

      const timeline = query.buildSessionTimeline(sessionId, parsedRecords);
      const result: Record<number, any> = {};

      for (const change of timeline.changes) {
        if (inRange(change.requestId, range)) {
          result[change.requestId] = change.delta;
        }
      }

      outputData(result, formatType, compact);
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subCommand}`);
      process.exit(1);
  }
}