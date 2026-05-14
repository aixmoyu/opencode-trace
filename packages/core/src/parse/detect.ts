import type { TraceRecord } from "../types.js";
import type { Conversation, Entry } from "./types.js";
import { getParsers } from "./registry.js";
import { createMsgEntry, createTextBlock } from "./utils.js";
import { sseOpenaiChatParse, sseOpenaiResponsesParse, sseAnthropicParse } from "../transform/index.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fallbackParse(reqBody: unknown, resBody: unknown): Conversation {
  const msgs: Conversation["msgs"] = [];
  if (isRecord(reqBody) && Array.isArray(reqBody.messages)) {
    for (const msg of reqBody.messages as unknown[]) {
      if (isRecord(msg)) {
        const blocks: Conversation["msgs"][number]["blocks"] = [];
        if (typeof msg.content === "string") {
          blocks.push({ type: "text", text: msg.content });
        } else if (msg.content != null) {
          blocks.push({ type: "text", text: JSON.stringify(msg.content) });
        }
        if (blocks.length === 0) {
          blocks.push({ type: "text", text: "" });
        }
        const role = (typeof msg.role === "string" ? msg.role : "user") as "user" | "assistant" | "tool";
        msgs.push(createMsgEntry(role, blocks));
      }
    }
  }
  return {
    provider: "unknown",
    model: isRecord(reqBody) && typeof reqBody.model === "string" ? reqBody.model : null,
    msgs,
    usage: null,
    stream: false,
  };
}

function parseSSEMessagesWithUsage(provider: string, raw: string): { messages: Entry[]; usage: Conversation["usage"] } {
  if (provider === "anthropic") return sseAnthropicParse(raw);
  if (provider === "openai-responses") return sseOpenaiResponsesParse(raw);
  return sseOpenaiChatParse(raw);
}

function isSSEBody(body: unknown): body is string {
  return typeof body === "string" && body.includes("data:");
}

export function detectAndParse(record: TraceRecord): Conversation {
  const url = record.request.url;
  const reqBody = record.request.body;
  const resBody = record.response?.body;

  const parser = getParsers().find((p) => p.match(url, reqBody));
  if (!parser) return fallbackParse(reqBody, resBody);

  const reqParsed = parser.parseRequest(reqBody);

  let responseMsgs: Entry[] = [];
  let responseModel: string | null | undefined;
  let responseUsage = reqParsed.usage;

  if (reqParsed.stream && isSSEBody(resBody)) {
    const sseResult = parseSSEMessagesWithUsage(parser.provider, resBody);
    responseMsgs = sseResult.messages;
    if (sseResult.usage) responseUsage = sseResult.usage;
  } else {
    const resParsed = parser.parseResponse(resBody);
    responseMsgs = resParsed.msgs ?? [];
    responseModel = resParsed.model;
    if (resParsed.usage) responseUsage = resParsed.usage;
  }

  const msgs = [...reqParsed.msgs, ...responseMsgs];

  return {
    provider: parser.provider,
    model: responseModel ?? reqParsed.model,
    sys: reqParsed.sys,
    tool: reqParsed.tool,
    msgs,
    usage: responseUsage,
    stream: reqParsed.stream,
  };
}

export function detectProvider(url: string, body: unknown): string | null {
  const parser = getParsers().find((p) => p.match(url, body));
  return parser?.provider ?? null;
}

export function extractUsage(record: TraceRecord): Conversation["usage"] {
  const url = record.request.url;
  const reqBody = record.request.body;
  const resBody = record.response?.body;

  const parser = getParsers().find((p) => p.match(url, reqBody));
  if (!parser) return null;

  const reqParsed = parser.parseRequest(reqBody);
  let responseUsage = reqParsed.usage;

  if (reqParsed.stream && isSSEBody(resBody)) {
    const sseResult = parseSSEMessagesWithUsage(parser.provider, resBody);
    if (sseResult.usage) responseUsage = sseResult.usage;
  } else {
    const resParsed = parser.parseResponse(resBody);
    if (resParsed.usage) responseUsage = resParsed.usage;
  }

  return responseUsage;
}

export interface LatencyInfo {
  requestSentAt: number | null;
  firstTokenAt: number | null;
  lastTokenAt: number | null;
  ttft: number | null;
  tpot: number | null;
  totalDuration: number | null;
}

export function extractLatency(record: TraceRecord): LatencyInfo | null {
  if (record.requestSentAt === undefined || 
      record.firstTokenAt === undefined ||
      record.lastTokenAt === undefined) {
    return null;
  }

  const ttft = record.firstTokenAt - record.requestSentAt;
  const totalDuration = record.lastTokenAt - record.requestSentAt;
  
  const parsed = detectAndParse(record);
  const outputTokens = parsed?.usage?.outputTokens ?? null;
  
  let tpot: number | null = null;
  if (typeof outputTokens === "number" && outputTokens > 0) {
    tpot = (record.lastTokenAt - record.firstTokenAt) / outputTokens;
  }

  return {
    requestSentAt: record.requestSentAt,
    firstTokenAt: record.firstTokenAt,
    lastTokenAt: record.lastTokenAt,
    ttft,
    tpot,
    totalDuration,
  };
}