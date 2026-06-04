import { AsyncWriteQueue, TimelineEntry } from "./write-queue.js";
import { redactHeaders } from "./redact.js";
import { sanitizePath, parse, logger } from "@opencode-trace/core";
import { ConfigManager } from "@opencode-trace/core/state";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TraceRecord, TraceRequest, TraceResponse } from "./trace.js";

export interface TracerConfig {
  globalDir?: string;
  localDir: string;
}

export type TraceScope = "global" | "local" | "session";
export type StorageLocation = "global" | "local";

export interface ScopeStatus {
  globalEnabled: boolean;
  localEnabled: boolean;
  sessionEnabled: boolean | null;
  effectiveEnabled: boolean;
  storageLocation: StorageLocation;
  globalDir: string;
  localDir: string;
}

export class TracePlugin {
  private origFetch: typeof fetch;
  private ids: Map<string, number> = new Map();
  private writeQueue: AsyncWriteQueue;
  private interceptorInstalled: boolean = false;
  private globalDir: string;
  private localDir: string;
  private globalConfigManager: ConfigManager | null = null;
  private localConfigManager: ConfigManager | null = null;

  constructor(config: TracerConfig) {
    if (!config.localDir) {
      throw new TypeError("TracerConfig.localDir is required");
    }
    this.globalDir = config.globalDir ?? join(homedir(), ".opencode-trace");
    this.localDir = config.localDir;
    this.origFetch = globalThis.fetch;
    this.writeQueue = new AsyncWriteQueue(this.globalDir);
  }

  async initStateManager(): Promise<void> {
    this.globalConfigManager = new ConfigManager(this.globalDir);
    await this.globalConfigManager.init();

    this.localConfigManager = new ConfigManager(this.localDir);
    await this.localConfigManager.init();
  }

  getStateManager(): ConfigManager | null {
    return this.globalConfigManager;
  }

  getGlobalConfigManager(): ConfigManager | null {
    return this.globalConfigManager;
  }

  getLocalConfigManager(): ConfigManager | null {
    return this.localConfigManager;
  }

  resolveTraceDir(sessionId?: string): string {
    if (sessionId && this.globalConfigManager) {
      const sessionPref = this.globalConfigManager.getSessionStoragePreference(sessionId);
      if (sessionPref === "local") return this.localDir;
      if (sessionPref === "global") return this.globalDir;
    }

    if (this.globalConfigManager) {
      const globalPref = this.globalConfigManager.getStoragePreference();
      if (globalPref === "local") return this.localDir;
    }

    return this.globalDir;
  }

  shouldRecord(sessionId?: string): boolean {
    if (!this.globalConfigManager) return true;

    const globalEnabled = this.globalConfigManager.getGlobalState("global_trace_enabled") === "true";
    if (globalEnabled) return true;

    if (this.localConfigManager) {
      const localEnabled = this.localConfigManager.getGlobalState("global_trace_enabled") === "true";
      if (localEnabled) return true;
    }

    if (!sessionId) return false;

    return this.globalConfigManager.getSessionEnabled(sessionId);
  }

  getScopeStatus(sessionId?: string): ScopeStatus {
    const globalEnabled = this.globalConfigManager
      ? this.globalConfigManager.getGlobalState("global_trace_enabled") === "true"
      : false;

    const localEnabled = this.localConfigManager
      ? this.localConfigManager.getGlobalState("global_trace_enabled") === "true"
      : false;

    const sessionEnabled = sessionId && this.globalConfigManager
      ? this.globalConfigManager.getSessionEnabled(sessionId)
      : null;

    const effectiveEnabled = this.shouldRecord(sessionId);

    const traceDir = this.resolveTraceDir(sessionId);
    const storageLocation: StorageLocation = traceDir === this.localDir ? "local" : "global";

    return {
      globalEnabled,
      localEnabled,
      sessionEnabled,
      effectiveEnabled,
      storageLocation,
      globalDir: this.globalDir,
      localDir: this.localDir,
    };
  }

  async tracedFetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
    origFetch?: typeof globalThis.fetch,
  ): Promise<Response> {
    const delegate = origFetch ?? this.origFetch;
    const req = this.parseRequest(input, init);
    if (!req) return delegate(input, init);

    const meta = await this.captureRequestMeta(req);
    if (!meta) return delegate(req);

    let res: Response;
    try {
      res = await delegate(req);
    } catch (err) {
      const error =
        err instanceof Error
          ? { message: err.message, stack: this.sanitizeStackTrace(err.stack) }
          : { message: String(err) };
      const record = this.createTraceRecord(
        meta.seq,
        meta.purpose,
        meta.requestAt,
        meta.traceReq,
        null,
        error,
        { requestSentAt: meta.requestSentAt },
      );
      const timelineEntry = this.buildTimelineEntry(
        meta.session,
        meta.seq,
        meta.purpose,
        meta.requestAt,
        meta.traceReq,
        null,
        error,
      );
      this.writeQueue.enqueue(meta.session, meta.seq, record, timelineEntry, meta.traceDir);
      this.writeParsedCacheAsync(meta.session, meta.seq, record, meta.traceDir);
      throw err;
    }

    let latencyMeta:
      | {
          requestSentAt: number;
          firstTokenAt: number | null;
          lastTokenAt: number | null;
        }
      | undefined;
    if (meta.isStream && res.body) {
      res = this.wrapStreamResponse(res, meta.requestSentAt);
      latencyMeta = (res as any).__latencyMeta;
    }

    void this.recordResponse(
      meta.session,
      meta.seq,
      meta.purpose,
      meta.requestAt,
      meta.traceReq,
      res,
      latencyMeta,
      meta.traceDir,
    );

    return res;
  }

  private getSessionId(req: Request): string | undefined {
    return (
      req.headers.get("x-opencode-session") ??
      req.headers.get("x-session-affinity") ??
      req.headers.get("session_id") ??
      undefined
    );
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
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  private classifyPurpose(raw: unknown): string {
    if (
      typeof raw === "object" &&
      raw !== null &&
      !Array.isArray(raw) &&
      Array.isArray((raw as any).tools) &&
      (raw as any).tools.length > 0
    )
      return "";
    return "[meta]";
  }

  private parseRequest(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Request | null {
    try {
      return new Request(input, init);
    } catch {
      return null;
    }
  }

  private async captureRequestMeta(
    req: Request,
  ): Promise<{
    session: string;
    seq: number;
    requestSentAt: number;
    requestAt: string;
    reqBody: unknown;
    isStream: boolean;
    purpose: string;
    traceReq: TraceRequest;
    traceDir: string;
  } | null> {
    const session = this.getSessionId(req);
    if (session === undefined) return null;

    if (!this.shouldRecord(session)) return null;

    const traceDir = this.resolveTraceDir(session);

    const seq = (this.ids.get(session) ?? 0) + 1;
    this.ids.set(session, seq);

    const requestSentAt = performance.now();
    const requestAt = new Date().toISOString();

    const reqBodyText = await req
      .clone()
      .text()
      .catch((err) => {
        logger.error("Failed to clone request body", {
          url: req.url,
          error: String(err),
        });
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

    return {
      session,
      seq,
      requestSentAt,
      requestAt,
      reqBody,
      isStream,
      purpose,
      traceReq,
      traceDir,
    };
  }

  private wrapStreamResponse(res: Response, requestSentAt: number): Response {
    const latencyMeta: {
      requestSentAt: number;
      firstTokenAt: number | null;
      lastTokenAt: number | null;
    } = { requestSentAt, firstTokenAt: null, lastTokenAt: null };

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

  private async recordResponse(
    session: string,
    seq: number,
    purpose: string,
    requestAt: string,
    traceReq: TraceRequest,
    res: Response,
    latencyMeta?: {
      requestSentAt: number;
      firstTokenAt?: number | null;
      lastTokenAt?: number | null;
    },
    traceDir?: string,
  ): Promise<void> {
    const dir = traceDir ?? this.globalDir;
    try {
      const resBodyText = await res.clone().text();
      const resBody = this.parseBody(resBodyText);
      const traceRes = {
        status: res.status,
        statusText: res.statusText,
        headers: redactHeaders(this.headersToObject(res.headers)),
        body: resBody,
      };
      const normalizedLatency = latencyMeta
        ? {
            requestSentAt: latencyMeta.requestSentAt,
            firstTokenAt: latencyMeta.firstTokenAt ?? undefined,
            lastTokenAt: latencyMeta.lastTokenAt ?? undefined,
          }
        : undefined;
      const record = this.createTraceRecord(
        seq,
        purpose,
        requestAt,
        traceReq,
        traceRes,
        null,
        normalizedLatency,
      );
      const timelineEntry = this.buildTimelineEntry(
        session,
        seq,
        purpose,
        requestAt,
        traceReq,
        traceRes,
        null,
      );
      this.writeQueue.enqueue(session, seq, record, timelineEntry, dir);
      this.writeParsedCacheAsync(session, seq, record, dir);
    } catch (err) {
      const error =
        err instanceof Error
          ? { message: err.message, stack: this.sanitizeStackTrace(err.stack) }
          : { message: String(err) };
      const normalizedLatency = latencyMeta
        ? {
            requestSentAt: latencyMeta.requestSentAt,
            firstTokenAt: latencyMeta.firstTokenAt ?? undefined,
            lastTokenAt: latencyMeta.lastTokenAt ?? undefined,
          }
        : undefined;
      const record = this.createTraceRecord(
        seq,
        purpose,
        requestAt,
        traceReq,
        null,
        error,
        normalizedLatency,
      );
      const timelineEntry = this.buildTimelineEntry(
        session,
        seq,
        purpose,
        requestAt,
        traceReq,
        null,
        error,
      );
      this.writeQueue.enqueue(session, seq, record, timelineEntry, dir);
      this.writeParsedCacheAsync(session, seq, record, dir);
    }
  }

  private buildTimelineEntry(
    _session: string,
    seq: number,
    purpose: string,
    requestAt: string,
    traceReq: TraceRequest,
    traceRes: TraceResponse | null,
    error: { message: string; stack?: string } | null,
  ): TimelineEntry {
    const responseAt = new Date().toISOString();
    const requestTime = new Date(requestAt).getTime();
    const responseTime = new Date(responseAt).getTime();
    const totalDurationMs = responseTime - requestTime;

    let provider: string | null = null;
    let model: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    if (traceRes?.body && typeof traceRes.body === "object" && traceRes.body !== null) {
      const body = traceRes.body as Record<string, unknown>;
      if (typeof body.model === "string") model = body.model;
      if (body.usage && typeof body.usage === "object") {
        const usage = body.usage as Record<string, unknown>;
        if (typeof usage.input_tokens === "number") inputTokens = usage.input_tokens;
        if (typeof usage.output_tokens === "number") outputTokens = usage.output_tokens;
        if (typeof usage.prompt_tokens === "number") inputTokens = usage.prompt_tokens;
        if (typeof usage.completion_tokens === "number") outputTokens = usage.completion_tokens;
      }
    }

    if (traceReq.url.includes("openai.com") || traceReq.url.includes("api.openai")) {
      provider = "openai";
    } else if (traceReq.url.includes("anthropic.com") || traceReq.url.includes("api.anthropic")) {
      provider = "anthropic";
    }

    return {
      seq,
      url: traceReq.url,
      method: traceReq.method,
      purpose,
      requestAt,
      responseAt: error ? null : responseAt,
      status: error ? 0 : (traceRes?.status ?? 0),
      provider,
      model,
      inputTokens,
      outputTokens,
      totalDurationMs,
    };
  }

  private sanitizeStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;
    const userHome = homedir();
    return sanitizePath(stack, userHome)
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP]")
      .replace(/:\d{4,5}(?=[\/\\\s]|$)/g, ":[PORT]");
  }

  private createTraceRecord(
    seq: number,
    purpose: string,
    requestAt: string,
    traceReq: TraceRequest,
    traceRes: TraceResponse | null,
    error: { message: string; stack?: string } | null,
    latency?: {
      requestSentAt?: number;
      firstTokenAt?: number;
      lastTokenAt?: number;
    },
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

  private writeParsedCacheAsync(session: string, seq: number, record: TraceRecord, traceDir?: string): void {
    setImmediate(() => {
      try {
        const parsed = parse.detectAndParse(record as Parameters<typeof parse.detectAndParse>[0]);
        this.writeQueue.writeParsedCache(session, seq, {
          ...(parsed as unknown as Record<string, unknown>),
          _pcv: parse.PARSED_CACHE_VERSION,
        }, traceDir);
      } catch {
        // fail silently — parsed cache is optional
      }
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue.flush();
  }

  wrap(fetch: typeof globalThis.fetch): typeof fetch {
    const capturedOrig = fetch;
    return async (input, init) => this.tracedFetch(input, init, capturedOrig);
  }

  getInterceptor(): typeof fetch {
    const capturedOrig = this.origFetch;
    return async (input, init) => this.tracedFetch(input, init, capturedOrig);
  }

  installInterceptor(): void {
    if (this.interceptorInstalled) return;
    this.origFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => this.tracedFetch(input, init, this.origFetch);
    this.interceptorInstalled = true;
  }

  uninstallInterceptor(): void {
    if (!this.interceptorInstalled) return;
    globalThis.fetch = this.origFetch;
    this.interceptorInstalled = false;
  }
}
