import { z } from "zod";
import { BlockSchema, EntrySchema } from "./parse-types.js";

export const EntryDeltaSchema = z.object({
  id: z.string(),
  added: z.array(BlockSchema).optional(),
  removed: z.array(BlockSchema).optional(),
});

export const DeltaSchema = z.object({
  sys: EntryDeltaSchema.optional(),
  tool: EntryDeltaSchema.optional(),
  msgs: z.array(EntryDeltaSchema),
});

export const RequestChangeSchema = z.object({
  requestId: z.number().int().positive(),
  delta: DeltaSchema,
  interRequestDuration: z.number().nullable(),
  isUserCall: z.boolean(),
});

export const SessionTimelineSchema = z.object({
  sessionId: z.string(),
  totalRequests: z.number().int().nonnegative(),
  changes: z.array(RequestChangeSchema),
});

export const TokenUsageSchema = z.object({
  inputMissTokens: z.number(),
  inputHitTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  cacheHitRate: z.number(),
});

export const LatencyStatsSchema = z.object({
  avgTTFT: z.number().nullable(),
  maxTTFT: z.number().nullable(),
  avgTPOT: z.number().nullable(),
  maxTPOT: z.number().nullable(),
  streamRequestCount: z.number().int().nonnegative(),
});

export const DurationStatsSchema = z.object({
  wallTime: z.number(),
  totalRequestDuration: z.number(),
});

export const SessionMetadataSchema = z.object({
  sessionId: z.string(),
  tokenUsage: TokenUsageSchema,
  requestCount: z.number().int().nonnegative(),
  subSessions: z.array(z.string()),
  parentSession: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  folderPath: z.string().optional(),
  latencyStats: LatencyStatsSchema.nullable(),
  durationStats: DurationStatsSchema.nullable(),
});

export const TimelineRecordSchema = z.object({
  id: z.number().int().positive(),
  requestAt: z.string().optional(),
  requestMsgs: z.array(EntrySchema).optional(),
  parsed: z.object({
    provider: z.string(),
    model: z.string().nullable(),
    msgs: z.array(EntrySchema),
  }).passthrough(),
});
