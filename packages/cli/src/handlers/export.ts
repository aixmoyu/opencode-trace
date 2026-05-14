import { writeFileSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { store, parse, query, record, format } from "@opencode-trace/core";
import { parseFlags, parseRange, inRange, findSessionTraceDir } from "../utils.js";
import { parseCollapse, parseCollapseBlocks, writeCollapsedExport, isConversationsMap, isDeltasMap } from "../formatter.js";

export async function cmdExport(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const sessionId = positional[0];

  if (!sessionId) {
    console.error("Error: session-id is required");
    process.exit(1);
  }

  if (!flags.type || !flags.output) {
    console.error("Error: -t <type> and -o <path> are required");
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
  const exportType = flags.type as string;
  const records = store.getSessionRecords(sessionId, { traceDir });

  if (records.length === 0) {
    console.error("No records found");
    process.exit(1);
  }

  const lastReqId = records[records.length - 1].id;
  const range = flags.req ? parseRange(flags.req as string, lastReqId) : null;

  if (exportType === "raw" && flags.req) {
    console.error("Warning: -r parameter is not applicable for raw export type");
  }

  let data: unknown;

  switch (exportType) {
    case "metadata": {
      const parsedRecords = records.map((rec) => ({
        id: rec.id,
        parsed: parse.detectAndParse(rec),
      }));

      data = query.buildSessionMetadata(sessionId, parsedRecords);
      const sessionMeta = store.readSessionMetadata(sessionId, traceDir);
      if (sessionMeta) {
        (data as any).createdAt = sessionMeta.createdAt ?? (data as any).createdAt;
        (data as any).updatedAt = sessionMeta.updatedAt ?? (data as any).updatedAt;
        (data as any).enabled = sessionMeta.enabled ?? false;
      }
      break;
    }

    case "conversation": {
      const outputPath = resolve(flags.output as string);
      if (outputPath.endsWith(".json") || outputPath.endsWith(".xml")) {
        console.error("Error: Output path must be a folder for export");
        process.exit(1);
      }

      const effectiveRange = range ?? { start: lastReqId, end: null };
      const conversations: Record<number, any> = {};

      for (const rec of records) {
        if (inRange(rec.id, effectiveRange)) {
          conversations[rec.id] = parse.detectAndParse(rec);
        }
      }

      const collapseItems = parseCollapse(flags.collapse as string);
      const collapseBlockTypes = parseCollapseBlocks(flags.collapseBlocks as string);

      const result = format.collapseConversations(conversations, {
        collapse: collapseItems,
        collapseBlocks: collapseBlockTypes,
        format: formatType as "json" | "xml"
      });

      writeCollapsedExport(outputPath, result, formatType);
      return;
    }

    case "changes": {
      const outputPath = resolve(flags.output as string);
      if (outputPath.endsWith(".json") || outputPath.endsWith(".xml")) {
        console.error("Error: Output path must be a folder for export");
        process.exit(1);
      }

      const parsedRecords = records.map((rec) => ({
        id: rec.id,
        parsed: parse.detectAndParse(rec),
      }));

      const timeline = query.buildSessionTimeline(sessionId, parsedRecords);
      const deltas: Record<number, any> = {};

      for (const change of timeline.changes) {
        if (inRange(change.requestId, range)) {
          deltas[change.requestId] = change.delta;
        }
      }

      const collapseItems = parseCollapse(flags.collapse as string);
      const collapseBlockTypes = parseCollapseBlocks(flags.collapseBlocks as string);

      const result = format.collapseDeltas(deltas, {
        collapse: collapseItems,
        collapseBlocks: collapseBlockTypes,
        format: formatType as "json" | "xml"
      });

      writeCollapsedExport(outputPath, result, formatType);
      return;
    }

    case "raw": {
      try {
        const stream = await store.exportSessionZip(sessionId, { traceDir });
        const outputPath = resolve(flags.output as string);
        const writeStream = createWriteStream(outputPath);

        stream.pipe(writeStream);

        await new Promise<void>((resolve, reject) => {
          writeStream.on("finish", () => resolve());
          writeStream.on("error", (err) => reject(err));
          stream.on("error", (err) => reject(err));
        });

        console.log(JSON.stringify({ success: true, path: outputPath }));
        return;
      } catch (e) {
        console.error(`Failed to export: ${(e as Error).message}`);
        process.exit(1);
      }
    }

    default:
      console.error(`Unknown export type: ${exportType}`);
      process.exit(1);
  }

  let output: string;
  if (formatType === "xml") {
    if (isConversationsMap(data)) {
      output = format.conversationsMapToXML(data as Record<number, any>);
    } else if (isDeltasMap(data)) {
      output = format.deltasMapToXML(data as Record<number, any>);
    } else {
      output = JSON.stringify(data, null, compact ? 0 : 2);
    }
  } else {
    output = JSON.stringify(data, null, compact ? 0 : 2);
  }

  const outputPath = resolve(flags.output as string);
  try {
    writeFileSync(outputPath, output, "utf-8");
    console.log(JSON.stringify({ success: true, path: outputPath }));
  } catch (e) {
    console.error(`Failed to export: ${(e as Error).message}`);
    process.exit(1);
  }
}