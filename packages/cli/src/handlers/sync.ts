import { resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { record, logger } from "@opencode-trace/core";
import { parseFlags, GLOBAL_TRACE_DIR } from "../utils.js";

export async function cmdSync(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  const traceDir = GLOBAL_TRACE_DIR;

  if (flags.repair) {
    const configPath = resolve(traceDir, "config.json");
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true });
      logger.info("Removed corrupted config.json");
    }
  }

  await record.initStateManager(traceDir);
  record.syncState(traceDir);
  logger.info("Sync completed");
}
