import { renameSync, promises as fs } from "node:fs";
import { logger } from "./logger.js";

export { getTraceDir, sanitizePath } from "./paths.js";

/**
 * Synchronous safe rename with retry for Windows transient errors (EACCES, EPERM).
 * On POSIX, renameSync is atomic and retries never trigger.
 */
export function safeRenameSync(src: string, dest: string, retries: number = 3): void {
  for (let i = 0; i < retries; i++) {
    try {
      renameSync(src, dest);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if ((code === "EACCES" || code === "EPERM") && i < retries - 1) {
        continue;
      }
      throw err;
    }
  }
}

/**
 * Async safe rename with retry and exponential backoff for Windows transient errors.
 * Matches the same semantics used by AsyncWriteQueue.
 */
export async function safeRename(src: string, dest: string, retries: number = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if ((code === "EACCES" || code === "EPERM") && i < retries - 1) {
        logger.warn("safeRename retry", { attempt: i + 1, code, src, dest });
        const delayMs = 50 * (i + 1);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}
