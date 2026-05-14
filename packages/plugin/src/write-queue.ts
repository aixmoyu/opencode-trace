import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "@opencode-trace/core";
import type { TraceRecord } from "./trace.js";

export class AsyncWriteQueue {
  private queue: Array<{ session: string, seq: number, record: TraceRecord }> = [];
  private writing: boolean = false;
  private traceDir: string;
  private batchSize: number;

  constructor(traceDir: string, batchSize: number = 10) {
    this.traceDir = traceDir;
    this.batchSize = batchSize;
  }

  enqueue(session: string, seq: number, record: TraceRecord): void {
    this.queue.push({ session, seq, record });
    if (!this.writing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.writing = true;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      await this.writeBatch(batch);
    }
    this.writing = false;

    if (this.queue.length > 0 && !this.writing) {
      this.processQueue();
    }
  }

  async flush(): Promise<void> {
    while (this.writing || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  private async writeBatch(items: Array<{ session: string, seq: number, record: TraceRecord }>): Promise<void> {
    for (const { session, seq, record } of items) {
      try {
        const sessionDir = join(this.traceDir, session);
        await fs.mkdir(sessionDir, { recursive: true });
        await fs.writeFile(join(sessionDir, `${seq}.json`), JSON.stringify(record, null, 2));
      } catch (err) {
        await this.writeFallback(session, seq, record, err as Error);
      }
    }
  }

  private async writeFallback(session: string, seq: number, record: TraceRecord, err: Error): Promise<void> {
    const fallbackDir = join(this.traceDir, "fallback");
    await fs.mkdir(fallbackDir, { recursive: true });
    const filename = `${session}-${seq}-${Date.now()}.json`;
    await fs.writeFile(
      join(fallbackDir, filename),
      JSON.stringify({
        record,
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack
        }
      }, null, 2)
    );
    logger.error("Write failed, saved to fallback", { filename, error: err.message });
  }
}