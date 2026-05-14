import type { StateManager } from "@opencode-trace/core/state";
import { logger } from "@opencode-trace/core";
import type { TraceRecord } from "./trace.js";

export class AsyncStateQueue {
  private queue: Array<{ session: string, seq: number, record: TraceRecord }> = [];
  private stateManager: StateManager | null = null;
  private writing: boolean = false;
  private batchSize: number;

  constructor(batchSize: number = 10) {
    this.batchSize = batchSize;
  }

  setStateManager(manager: StateManager): void {
    this.stateManager = manager;
  }

  enqueue(session: string, seq: number, record: TraceRecord): void {
    this.queue.push({ session, seq, record });
    if (!this.writing && this.stateManager) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.writing = true;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      for (const { session, seq, record } of batch) {
        try {
          // NOTE: StateManager.writeRecord is currently sync (Task 3 will convert to async)
          await this.stateManager!.writeRecord(session, seq, record);
        } catch (err) {
          logger.error("SQLite update failed", { error: String(err) });
        }
      }
    }
    this.writing = false;

    if (this.queue.length > 0 && !this.writing && this.stateManager) {
      this.processQueue();
    }
  }

  async flush(): Promise<void> {
    while (this.writing || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}