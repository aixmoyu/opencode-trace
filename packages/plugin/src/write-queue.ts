import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "@opencode-trace/core";
import type { TraceRecord } from "./trace.js";

export interface TimelineEntry {
  seq: number;
  url: string;
  method: string;
  purpose: string;
  requestAt: string;
  responseAt: string | null;
  status: number;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalDurationMs: number | null;
}

export class AsyncWriteQueue {
  private queue: Array<{
    session: string;
    seq: number;
    record: TraceRecord;
    timelineEntry?: TimelineEntry;
  }> = [];
  private writing: boolean = false;
  private traceDir: string;
  private batchSize: number;

  constructor(traceDir: string, batchSize: number = 10) {
    this.traceDir = traceDir;
    this.batchSize = batchSize;
  }

  enqueue(
    session: string,
    seq: number,
    record: TraceRecord,
    timelineEntry?: TimelineEntry,
  ): void {
    this.queue.push({ session, seq, record, timelineEntry });
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
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 10);
      await promise;
    }
  }

  private async writeBatch(
    items: Array<{
      session: string;
      seq: number;
      record: TraceRecord;
      timelineEntry?: TimelineEntry;
    }>,
  ): Promise<void> {
    for (const { session, seq, record, timelineEntry } of items) {
      try {
        const sessionDir = join(this.traceDir, session);
        await fs.mkdir(sessionDir, { recursive: true });

        // Atomic write: .tmp + rename — crash-safe, POSIX rename guarantees atomicity
        const tmpPath = join(sessionDir, `${seq}.json.tmp`);
        const finalPath = join(sessionDir, `${seq}.json`);
        await fs.writeFile(tmpPath, JSON.stringify(record, null, 2));
        await fs.rename(tmpPath, finalPath);

        if (timelineEntry) {
          await this.appendTimeline(sessionDir, timelineEntry);
        }
      } catch (err) {
        await this.writeFallback(session, seq, record, err as Error);
      }
    }
  }

  /** Fire-and-forget parsed cache write. Never blocks the write queue. */
  writeParsedCache(session: string, seq: number, parsed: Record<string, unknown>): void {
    setImmediate(async () => {
      try {
        const sessionDir = join(this.traceDir, session);
        await fs.mkdir(sessionDir, { recursive: true });
        const cachePath = join(sessionDir, `${seq}.parsed`);
        await fs.writeFile(cachePath, JSON.stringify(parsed));
      } catch {
        // fail silently — parsed cache is optional per design spec
      }
    });
  }

  private async appendTimeline(
    sessionDir: string,
    entry: TimelineEntry,
  ): Promise<void> {
    const timelinePath = join(sessionDir, "timeline.ndjson");
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(timelinePath, line);
  }

  private async writeFallback(
    session: string,
    seq: number,
    record: TraceRecord,
    err: Error,
  ): Promise<void> {
    const fallbackDir = join(this.traceDir, "fallback");
    await fs.mkdir(fallbackDir, { recursive: true });
    const filename = `${session}-${seq}-${Date.now()}.json`;
    await fs.writeFile(
      join(fallbackDir, filename),
      JSON.stringify(
        {
          record,
          error: {
            name: err.name,
            message: err.message,
            stack: err.stack,
          },
        },
        null,
        2,
      ),
    );
    logger.error("Write failed, saved to fallback", {
      filename,
      error: err.message,
    });
  }
}
