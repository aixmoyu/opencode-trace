import { z } from "zod";

export const TraceRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});

export const TraceResponseSchema = z.object({
  status: z.number().int(),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});

export const TraceErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
});

export const TraceRecordSchema = z.object({
  id: z.number().int().positive(),
  purpose: z.string(),
  requestAt: z.string(),
  responseAt: z.string(),
  request: TraceRequestSchema,
  response: TraceResponseSchema.nullable(),
  error: TraceErrorSchema.nullable(),
  requestSentAt: z.number().optional(),
  firstTokenAt: z.number().optional(),
  lastTokenAt: z.number().optional(),
});

export type TraceRequestValidated = z.infer<typeof TraceRequestSchema>;
export type TraceResponseValidated = z.infer<typeof TraceResponseSchema>;
export type TraceErrorValidated = z.infer<typeof TraceErrorSchema>;
export type TraceRecordValidated = z.infer<typeof TraceRecordSchema>;
