import { resolve } from "node:path";
import { record, logger } from "@opencode-trace/core";
import { parseFlags, GLOBAL_TRACE_DIR } from "../utils.js";

export async function cmdSync(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const traceDir = GLOBAL_TRACE_DIR;

  if (flags.repair) {
    const { existsSync, rmSync } = await import("node:fs");
    const dbPath = resolve(traceDir, "state.db");
    if (existsSync(dbPath)) {
      rmSync(dbPath, { force: true });
      logger.info("Removed corrupted state.db");
    }
  }

  await record.initStateManager(traceDir);
  record.syncState(traceDir);
  logger.info("Sync completed");
}