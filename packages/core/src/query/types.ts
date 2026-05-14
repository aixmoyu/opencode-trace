import type { Block, Entry, Conversation } from "../parse/types.js";

export interface EntryDelta {
  id: string;
  added?: Block[];
  removed?: Block[];
}

export interface Delta {
  sys?: EntryDelta;
  tool?: EntryDelta;
  msgs: EntryDelta[];
}

export interface RequestChange {
  requestId: number;
  delta: Delta;
  interRequestDuration: number | null;
  isUserCall: boolean;
}

export interface SessionTimeline {
  sessionId: string;
  totalRequests: number;
  changes: RequestChange[];
}

export interface TokenUsage {
  inputMissTokens: number;
  inputHitTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
}

export interface LatencyStats {
  avgTTFT: number | null;
  maxTTFT: number | null;
  avgTPOT: number | null;
  maxTPOT: number | null;
  streamRequestCount: number;
}

export interface DurationStats {
  wallTime: number;
  totalRequestDuration: number;
}

export interface SessionMetadata {
  sessionId: string;
  tokenUsage: TokenUsage;
  requestCount: number;
  subSessions: string[];
  parentSession: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  folderPath?: string;
  latencyStats: LatencyStats | null;
  durationStats: DurationStats | null;
}

export interface TimelineRecord {
  id: number;
  requestAt?: string;
  requestMsgs?: Entry[];
  parsed: Conversation;
}
