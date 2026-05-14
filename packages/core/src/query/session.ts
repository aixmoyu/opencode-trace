import type { Conversation, Entry, Block } from "../parse/types.js";
import type { TraceRecord } from "../types.js";
import type { RequestChange, SessionTimeline, Delta, EntryDelta, SessionMetadata, TokenUsage, LatencyStats, DurationStats, TimelineRecord } from "./types.js";
import { extractLatency } from "../parse/detect.js";

function blockKey(block: Block): string {
  switch (block.type) {
    case "text":
      return `text:${block.text.slice(0, 50)}`;
    case "thinking":
      return `thinking:${block.thinking.slice(0, 50)}`;
    case "td":
      return `td:${block.name}`;
    case "tc":
      return `tc:${block.id}:${block.name}`;
    case "tr":
      return `tr:${block.toolCallId}`;
    case "image":
      return `image:${JSON.stringify(block.source).slice(0, 50)}`;
    case "other":
      return `other:${JSON.stringify(block.raw).slice(0, 50)}`;
    default:
      return `unknown`;
  }
}

function msgKey(msg: Entry): string {
  return `${msg.id}:${msg.role ?? ""}`;
}

export function diffConversations(
  prev: Conversation,
  curr: Conversation,
  currRequestId: number,
  requestMsgs?: Entry[]
): RequestChange {
  const delta: Delta = { msgs: [] };

  if (prev.sys && curr.sys) {
    const prevKeys = new Set(prev.sys.blocks.map(blockKey));
    const currKeys = new Set(curr.sys.blocks.map(blockKey));
    const added = curr.sys.blocks.filter(b => !prevKeys.has(blockKey(b)));
    const removed = prev.sys.blocks.filter(b => !currKeys.has(blockKey(b)));
    if (added.length > 0 || removed.length > 0) {
      delta.sys = { id: prev.sys.id, added, removed };
    }
  } else if (!prev.sys && curr.sys) {
    delta.sys = { id: curr.sys.id, added: curr.sys.blocks };
  } else if (prev.sys && !curr.sys) {
    delta.sys = { id: prev.sys.id, removed: prev.sys.blocks };
  }

  if (prev.tool && curr.tool) {
    const prevKeys = new Set(prev.tool.blocks.map(blockKey));
    const currKeys = new Set(curr.tool.blocks.map(blockKey));
    const added = curr.tool.blocks.filter(b => !prevKeys.has(blockKey(b)));
    const removed = prev.tool.blocks.filter(b => !currKeys.has(blockKey(b)));
    if (added.length > 0 || removed.length > 0) {
      delta.tool = { id: prev.tool.id, added, removed };
    }
  } else if (!prev.tool && curr.tool) {
    delta.tool = { id: curr.tool.id, added: curr.tool.blocks };
  } else if (prev.tool && !curr.tool) {
    delta.tool = { id: prev.tool.id, removed: prev.tool.blocks };
  }

  const prevMsgKeys = new Map<string, Entry>();
  for (const msg of prev.msgs) {
    prevMsgKeys.set(msgKey(msg), msg);
  }

  const currMsgKeys = new Map<string, Entry>();
  for (const msg of curr.msgs) {
    currMsgKeys.set(msgKey(msg), msg);
  }

  for (const currMsg of curr.msgs) {
    const key = msgKey(currMsg);
    const prevMsg = prevMsgKeys.get(key);

    if (!prevMsg) {
      delta.msgs.push({ id: currMsg.id, added: currMsg.blocks });
    } else {
      const prevBlockKeys = new Set(prevMsg.blocks.map(blockKey));
      const currBlockKeys = new Set(currMsg.blocks.map(blockKey));
      const added = currMsg.blocks.filter(b => !prevBlockKeys.has(blockKey(b)));
      const removed = prevMsg.blocks.filter(b => !currBlockKeys.has(blockKey(b)));
      if (added.length > 0 || removed.length > 0) {
        delta.msgs.push({ id: currMsg.id, added, removed });
      }
    }
  }

  for (const prevMsg of prev.msgs) {
    const key = msgKey(prevMsg);
    if (!currMsgKeys.has(key)) {
      delta.msgs.push({ id: prevMsg.id, removed: prevMsg.blocks });
    }
  }

  const isUserCall = checkIsUserCall(requestMsgs ?? curr.msgs);

  return {
    requestId: currRequestId,
    delta,
    interRequestDuration: null,
    isUserCall,
  };
}

function buildInitialChange(conv: Conversation, requestId: number, requestMsgs?: Entry[]): RequestChange {
  const delta: Delta = { msgs: [] };
  
  if (conv.sys) {
    delta.sys = { id: conv.sys.id, added: conv.sys.blocks };
  }
  if (conv.tool) {
    delta.tool = { id: conv.tool.id, added: conv.tool.blocks };
  }
  for (const msg of conv.msgs) {
    delta.msgs.push({ id: msg.id, added: msg.blocks });
  }
  
  const isUserCall = checkIsUserCall(requestMsgs ?? conv.msgs);
  
  return { requestId, delta, interRequestDuration: null, isUserCall };
}

function checkIsUserCall(msgs: Entry[]): boolean {
  if (msgs.length === 0) return false;
  const lastMsg = msgs[msgs.length - 1];
  if (!lastMsg.blocks || lastMsg.blocks.length === 0) return false;
  return lastMsg.blocks.some(b => b.type === "text");
}

export function buildSessionTimeline(
  sessionId: string,
  records: TimelineRecord[]
): SessionTimeline {
  const changes: RequestChange[] = [];
  let prev: Conversation | null = null;
  let prevRequestAt: string | null = null;

  for (const rec of records) {
    const curr = rec.parsed as Conversation;
    const requestMsgs = rec.requestMsgs;
    const requestAt = rec.requestAt;
    
    let interRequestDuration: number | null = null;
    if (prevRequestAt && requestAt) {
      const prevTime = new Date(prevRequestAt).getTime();
      const currTime = new Date(requestAt).getTime();
      interRequestDuration = currTime - prevTime;
    }
    
    let change: RequestChange;
    if (!prev) {
      change = buildInitialChange(curr, rec.id, requestMsgs);
    } else {
      change = diffConversations(prev, curr, rec.id, requestMsgs);
    }
    
    change.interRequestDuration = interRequestDuration;
    changes.push(change);
    
    prev = curr;
    prevRequestAt = requestAt ?? null;
  }

  return {
    sessionId,
    totalRequests: records.length,
    changes,
  };
}

export function buildSessionMetadata(
  sessionId: string,
  records: { id: number; record?: TraceRecord; parsed: Conversation }[],
  folderPath?: string
): SessionMetadata {
  let inputMissTokens = 0;
  let inputHitTokens = 0;
  let outputTokens = 0;

  const ttftValues: number[] = [];
  const tpotValues: number[] = [];

  const requestAtValues: string[] = [];
  const responseAtValues: string[] = [];
  const requestDurations: number[] = [];

  for (const rec of records) {
    const usage = rec.parsed.usage;
    if (usage) {
      inputMissTokens += usage.inputMissTokens ?? 0;
      inputHitTokens += usage.inputHitTokens ?? 0;
      outputTokens += usage.outputTokens ?? 0;
    }

    if (rec.record) {
      const latency = extractLatency(rec.record);
      if (latency) {
        if (latency.ttft != null) ttftValues.push(latency.ttft);
        if (latency.tpot != null) tpotValues.push(latency.tpot);
      }

      if (rec.record.requestAt && rec.record.responseAt) {
        requestAtValues.push(rec.record.requestAt);
        responseAtValues.push(rec.record.responseAt);
        const duration = new Date(rec.record.responseAt).getTime() - new Date(rec.record.requestAt).getTime();
        requestDurations.push(duration);
      }
    }
  }

  const totalTokens = inputMissTokens + inputHitTokens + outputTokens;
  const totalInput = inputMissTokens + inputHitTokens;
  const cacheHitRate = totalInput > 0 ? inputHitTokens / totalInput : 0;

  let latencyStats: LatencyStats | null = null;
  if (ttftValues.length > 0 || tpotValues.length > 0) {
    const avgTTFT = ttftValues.length > 0 ? ttftValues.reduce((a, b) => a + b, 0) / ttftValues.length : null;
    const maxTTFT = ttftValues.length > 0 ? Math.max(...ttftValues) : null;
    const avgTPOT = tpotValues.length > 0 ? tpotValues.reduce((a, b) => a + b, 0) / tpotValues.length : null;
    const maxTPOT = tpotValues.length > 0 ? Math.max(...tpotValues) : null;

    latencyStats = {
      avgTTFT,
      maxTTFT,
      avgTPOT,
      maxTPOT,
      streamRequestCount: ttftValues.length,
    };
  }

  let durationStats: DurationStats | null = null;
  if (requestAtValues.length > 0 && responseAtValues.length > 0) {
    const minRequestAt = requestAtValues.reduce((a, b) => a < b ? a : b);
    const maxResponseAt = responseAtValues.reduce((a, b) => a > b ? a : b);
    const wallTime = new Date(maxResponseAt).getTime() - new Date(minRequestAt).getTime();
    const totalRequestDuration = requestDurations.reduce((a, b) => a + b, 0);

    durationStats = {
      wallTime,
      totalRequestDuration,
    };
  }

  return {
    sessionId,
    tokenUsage: {
      inputMissTokens,
      inputHitTokens,
      outputTokens,
      totalTokens,
      cacheHitRate,
    },
    latencyStats,
    durationStats,
    requestCount: records.length,
    subSessions: [],
    parentSession: null,
    createdAt: null,
    updatedAt: null,
    folderPath,
  };
}