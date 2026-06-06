import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "@opencode-trace/core";

const FILENAME_RE = /^(.+)-(\d+)-(\d+)\.json$/;

export interface FallbackReconcilerOptions {
  intervalMs?: number;
}

export interface ReconcileResult {
  scanned: number;
  recovered: number;
  failed: number;
}

export interface ReconcilerStats {
  runs: number;
  recovered: number;
  failed: number;
}

export class FallbackReconciler {
  private traceDir: string;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<ReconcileResult> | null = null;
  private closed: boolean = false;
  private counts: ReconcilerStats = { runs: 0, recovered: 0, failed: 0 };

  constructor(traceDir: string, options: FallbackReconcilerOptions = {}) {
    this.traceDir = traceDir;
    this.intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  }

  stats(): ReconcilerStats {
    return { ...this.counts };
  }

  async start(): Promise<void> {
    if (this.timer || this.closed) return;
    await this.reconcile();
    this.timer = setInterval(() => {
      void this.reconcile();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      await this.inFlight;
    }
    this.closed = true;
  }

  async reconcile(): Promise<ReconcileResult> {
    if (this.inFlight) {
      await this.inFlight;
    }

    const work = this.runOnce();
    this.inFlight = work;
    try {
      return await work;
    } finally {
      if (this.inFlight === work) {
        this.inFlight = null;
      }
    }
  }

  private async runOnce(): Promise<ReconcileResult> {
    this.counts.runs++;
    const fallbackDir = join(this.traceDir, "fallback");
    const result: ReconcileResult = { scanned: 0, recovered: 0, failed: 0 };

    let entries: string[];
    try {
      entries = await fs.readdir(fallbackDir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return result;
      }
      logger.warn("FallbackReconciler: readdir failed", {
        fallbackDir,
        error: String(err),
      });
      return result;
    }

    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const match = FILENAME_RE.exec(name);
      if (!match) continue;

      result.scanned++;
      const [, session, seqStr, tsStr] = match;
      const seq = Number.parseInt(seqStr, 10);
      const firstSeenAt = Number.parseInt(tsStr, 10);

      const sourcePath = join(fallbackDir, name);
      const targetPath = join(this.traceDir, session, `${seq}.json`);

      try {
        const sessionDir = join(this.traceDir, session);
        await fs.mkdir(sessionDir, { recursive: true });

        let payload: unknown;
        try {
          const raw = await fs.readFile(sourcePath, "utf-8");
          payload = JSON.parse(raw);
        } catch (readErr) {
          throw readErr;
        }

        const record = (payload as { record?: unknown })?.record ?? payload;
        await fs.writeFile(targetPath, JSON.stringify(record, null, 2));
        await fs.unlink(sourcePath);

        result.recovered++;
        this.counts.recovered++;
        logger.info("FallbackReconciler: recovered record", {
          session,
          seq,
          firstSeenAt,
          targetPath,
        });
      } catch (err) {
        result.failed++;
        this.counts.failed++;
        logger.warn("FallbackReconciler: recovery failed", {
          session,
          seq,
          firstSeenAt,
          error: String(err),
        });
      }
    }

    return result;
  }
}
