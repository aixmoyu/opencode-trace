import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { format } from "@opencode-trace/core";
import type { BlockType } from "@opencode-trace/core";

export function outputData(data: unknown, formatType: string, compact: boolean): void {
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

  console.log(output);
}

function isMapWithProperty(data: unknown, property: string): boolean {
  if (typeof data !== "object" || data === null) return false;
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  const firstVal = data[keys[0] as keyof typeof data];
  return typeof firstVal === "object" && firstVal !== null && property in firstVal;
}

export function isConversationsMap(data: unknown): boolean {
  return isMapWithProperty(data, "provider") && isMapWithProperty(data, "msgs");
}

export function isDeltasMap(data: unknown): boolean {
  return isMapWithProperty(data, "msgs") && !isMapWithProperty(data, "provider");
}

export function isConversation(data: unknown): boolean {
  return typeof data === "object" && data !== null && "provider" in data && "msgs" in data;
}

export function isTimeline(data: unknown): boolean {
  return typeof data === "object" && data !== null && "sessionId" in data && "changes" in data;
}

function parseList<T extends string>(value: string | undefined, valid: T[], errorPrefix: string): T[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").map(s => s.trim()) as T[];
  for (const item of items) {
    if (!valid.includes(item)) {
      console.error(`Error: ${errorPrefix}: ${item}. Valid: ${valid.join(", ")}`);
      process.exit(1);
    }
  }
  return items;
}

export function parseCollapse(value: string | undefined): ("sys" | "tool" | "msgs")[] | undefined {
  return parseList(value, ["sys", "tool", "msgs"], "Invalid collapse item");
}

export function parseCollapseBlocks(value: string | undefined): BlockType[] | undefined {
  return parseList(value, ["text", "thinking", "td", "tc", "tr", "image", "other"], "Invalid block type");
}

export function writeCollapsedExport(outputPath: string, result: { main: string; blocks: Map<string, string> }, formatType: string): void {
  mkdirSync(outputPath, { recursive: true });

  const mainFile = join(outputPath, `main.${formatType}`);
  writeFileSync(mainFile, result.main, "utf-8");

  if (result.blocks.size > 0) {
    const blocksDir = join(outputPath, "blocks");
    mkdirSync(blocksDir, { recursive: true });

    for (const [path, content] of result.blocks) {
      writeFileSync(join(outputPath, path), content, "utf-8");
    }
  }

  console.log(JSON.stringify({ success: true, path: outputPath, files: result.blocks.size + 1 }));
}