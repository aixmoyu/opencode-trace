import { AsyncWriteQueue } from "./write-queue.js";
import { AsyncStateQueue } from "./state-queue.js";
import { StateManager } from "@opencode-trace/core/state";
import { redactHeaders } from "./redact.js";

import { logger } from "@opencode-trace/core";
import type { TraceRecord, TraceRequest, TraceResponse } from "./trace.js";

export class TracePlugin {
  private origFetch: typeof fetch;
  private ids: Map<string, number> = new Map();
  private writeQueue: AsyncWriteQueue;
  private stateQueue: AsyncStateQueue;
  private stateManager: StateManager | null = null;
  private interceptorInstalled: boolean = false;
  private traceDir: string;

  constructor(traceDir: string) {
    this.traceDir = traceDir;
    this.origFetch = globalThis.fetch; // Will be updated in installInterceptor
    this.writeQueue = new AsyncWriteQueue(traceDir);
    this.stateQueue = new AsyncStateQueue();
  }

  async tracedFetch(input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]): Promise<Response> {
    const req = this.parseRequest(input, init);
    if (!req) return this.origFetch(input, init);

    const meta = await this.captureRequestMeta(req);
    if (!meta) return this.origFetch(req);

    let res: Response;
    try {
      res = await this.origFetch(req);
    } catch (err) {
      const error = err instanceof Error
        ? { message: err.message, stack: this.sanitizeStackTrace(err.stack) }
        : { message: String(err) };
      const record = this.createTraceRecord(meta.seq, meta.purpose, meta.requestAt, meta.traceReq, null, error, { requestSentAt: meta.requestSentAt });
      this.writeQueue.enqueue(meta.session, meta.seq, record);
      this.stateQueue.enqueue(meta.session, meta.seq, record);
      throw err;
    }

    let latencyMeta: { requestSentAt: number, firstTokenAt: number | null, lastTokenAt: number | null } | undefined;
    if (meta.isStream && res.body) {
      res = this.wrapStreamResponse(res, meta.requestSentAt);
      latencyMeta = (res as any).__latencyMeta;
    }

    void this.recordResponse(meta.session, meta.seq, meta.purpose, meta.requestAt, meta.traceReq, res, latencyMeta);

    return res;
  }

  private getSessionId(req: Request): string | undefined {
    return req.headers.get("x-opencode-session") ?? req.headers.get("x-session-affinity") ?? req.headers.get("session_id") ?? undefined;
  }

  private shouldRecord(sessionId?: string): boolean {
    if (!this.stateManager) return true;
    this.stateManager.reload();
    return this.stateManager.isTraceEnabled(sessionId);
  }

  private parseBody(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text || null;
    }
  }

  private headersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => { obj[key] = value; });
    return obj;
  }

  private classifyPurpose(raw: unknown): string {
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && Array.isArray((raw as any).tools) && (raw as any).tools.length > 0) return "";
    return "[meta]";
  }

  private parseRequest(input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]): Request | null {
    try {
      return new Request(input, init);
    } catch {
      return null;
    }
  }

  private async captureRequestMeta(req: Request): Promise<{ session: string, seq: number, requestSentAt: number, requestAt: string, reqBody: unknown, isStream: boolean, purpose: string, traceReq: TraceRequest } | null> {
    const session = this.getSessionId(req);
    if (session === undefined) return null;

    if (!this.shouldRecord(session)) return null;

    const seq = (this.ids.get(session) ?? 0) + 1;
    this.ids.set(session, seq);

    const requestSentAt = performance.now();
    const requestAt = new Date().toISOString();

    const reqBodyText = await req.clone().text().catch((err) => {
      logger.error("Failed to clone request body", { url: req.url, error: String(err) });
      return "";
    });
    const reqBody = this.parseBody(reqBodyText);

    let isStream = false;
    try {
      isStream = JSON.parse(reqBodyText ?? "{}")?.stream === true;
    } catch {
      isStream = false;
    }

    const purpose = this.classifyPurpose(reqBody);

    const traceReq = {
      method: req.method,
      url: req.url,
      headers: redactHeaders(this.headersToObject(req.headers)),
      body: reqBody,
    };

    return { session, seq, requestSentAt, requestAt, reqBody, isStream, purpose, traceReq };
  }

  private wrapStreamResponse(res: Response, requestSentAt: number): Response {
    const latencyMeta: { requestSentAt: number, firstTokenAt: number | null, lastTokenAt: number | null } = { requestSentAt, firstTokenAt: null, lastTokenAt: null };

    const transform = new TransformStream({
      transform(chunk, controller) {
        if (latencyMeta.firstTokenAt === null) {
          latencyMeta.firstTokenAt = performance.now();
        }
        controller.enqueue(chunk);
      },
      flush() {
        latencyMeta.lastTokenAt = performance.now();
      },
    });

    const wrappedBody = res.body!.pipeThrough(transform);
    const wrappedRes = new Response(wrappedBody, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    (wrappedRes as any).__latencyMeta = latencyMeta;
    return wrappedRes;
  }

  private async recordResponse(session: string, seq: number, purpose: string, requestAt: string, traceReq: TraceRequest, res: Response, latencyMeta?: { requestSentAt: number, firstTokenAt?: number | null, lastTokenAt?: number | null }): Promise<void> {
    try {
      const resBodyText = await res.clone().text();
      const resBody = this.parseBody(resBodyText);
      const traceRes = {
        status: res.status,
        statusText: res.statusText,
        headers: redactHeaders(this.headersToObject(res.headers)),
        body: resBody,
      };
      const normalizedLatency = latencyMeta ? {
        requestSentAt: latencyMeta.requestSentAt,
        firstTokenAt: latencyMeta.firstTokenAt ?? undefined,
        lastTokenAt: latencyMeta.lastTokenAt ?? undefined,
      } : undefined;
      const record = this.createTraceRecord(seq, purpose, requestAt, traceReq, traceRes, null, normalizedLatency);
      this.writeQueue.enqueue(session, seq, record);
      this.stateQueue.enqueue(session, seq, record);
    } catch (err) {
      const error = err instanceof Error
        ? { message: err.message, stack: this.sanitizeStackTrace(err.stack) }
        : { message: String(err) };
      const normalizedLatency = latencyMeta ? {
        requestSentAt: latencyMeta.requestSentAt,
        firstTokenAt: latencyMeta.firstTokenAt ?? undefined,
        lastTokenAt: latencyMeta.lastTokenAt ?? undefined,
      } : undefined;
      const record = this.createTraceRecord(seq, purpose, requestAt, traceReq, null, error, normalizedLatency);
      this.writeQueue.enqueue(session, seq, record);
      this.stateQueue.enqueue(session, seq, record);
    }
  }

  private sanitizeStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;
    return stack
      .replace(/\/home\/[^\/]+/g, '/home/[USER]')
      .replace(/\/Users\/[^\/]+/g, '/Users/[USER]')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]')
      .replace(/:\d{4,5}(?=[\/\s]|$)/g, ':[PORT]');
  }

  private createTraceRecord(
    seq: number,
    purpose: string,
    requestAt: string,
    traceReq: TraceRequest,
    traceRes: TraceResponse | null,
    error: { message: string, stack?: string } | null,
    latency?: { requestSentAt?: number, firstTokenAt?: number, lastTokenAt?: number }
  ): TraceRecord {
    return {
      id: seq,
      purpose,
      requestAt,
      responseAt: new Date().toISOString(),
      request: traceReq,
      response: traceRes,
      error,
      requestSentAt: latency?.requestSentAt,
      firstTokenAt: latency?.firstTokenAt ?? undefined,
      lastTokenAt: latency?.lastTokenAt ?? undefined,
    };
  }

  getInterceptor(): typeof fetch {
    return this.tracedFetch.bind(this);
  }

  installInterceptor(): void {
    if (this.interceptorInstalled) return;
    this.origFetch = globalThis.fetch; // Capture current fetch at installation time
    globalThis.fetch = this.getInterceptor();
    this.interceptorInstalled = true;
  }

  uninstallInterceptor(): void {
    if (!this.interceptorInstalled) return;
    globalThis.fetch = this.origFetch;
    this.interceptorInstalled = false;
  }

  async initStateManager(): Promise<void> {
    this.stateManager = new StateManager(this.traceDir);
    await this.stateManager.init();
    this.stateManager.sync();
    this.stateQueue.setStateManager(this.stateManager);
  }

  getStateManager(): StateManager | null {
    return this.stateManager;
  }
}