import type { Conversation, Entry, Block } from "../parse/types.js";
import type { SessionTimeline, RequestChange, Delta, EntryDelta } from "../query/types.js";

export function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function conversationBodyToXML(conv: Conversation, baseIndent: string): string[] {
  const lines: string[] = [];
  lines.push(`${baseIndent}<provider>${escapeXML(conv.provider)}</provider>`);
  
  if (conv.model) {
    lines.push(`${baseIndent}<model>${escapeXML(conv.model)}</model>`);
  }
  
  if (conv.sys) {
    lines.push(`${baseIndent}<sys>`);
    lines.push(entryToXML(conv.sys, `${baseIndent}  `));
    lines.push(`${baseIndent}</sys>`);
  }
  
  if (conv.tool) {
    lines.push(`${baseIndent}<tool>`);
    lines.push(entryToXML(conv.tool, `${baseIndent}  `));
    lines.push(`${baseIndent}</tool>`);
  }
  
  lines.push(`${baseIndent}<msgs>`);
  for (const msg of conv.msgs) {
    lines.push(entryToXML(msg, `${baseIndent}  `));
  }
  lines.push(`${baseIndent}</msgs>`);
  
  if (conv.usage) {
    lines.push(`${baseIndent}<usage>`);
    lines.push(`${baseIndent}  <inputMissTokens>${conv.usage.inputMissTokens ?? 0}</inputMissTokens>`);
    lines.push(`${baseIndent}  <inputHitTokens>${conv.usage.inputHitTokens ?? 0}</inputHitTokens>`);
    lines.push(`${baseIndent}  <outputTokens>${conv.usage.outputTokens ?? 0}</outputTokens>`);
    lines.push(`${baseIndent}</usage>`);
  }
  
  return lines;
}

export function blockToXML(block: Block, indent: string): string {
  switch (block.type) {
    case "text":
      return `${indent}<block type="text">${escapeXML(block.text)}</block>`;
    case "thinking":
      return `${indent}<block type="thinking">${escapeXML(block.thinking)}</block>`;
    case "td":
      return `${indent}<block type="td" name="${escapeXML(block.name)}">${escapeXML(block.description ?? "")}</block>`;
    case "tc":
      return `${indent}<block type="tc" id="${escapeXML(block.id)}" name="${escapeXML(block.name)}">${escapeXML(block.arguments)}</block>`;
    case "tr":
      return `${indent}<block type="tr" toolCallId="${escapeXML(block.toolCallId)}">${escapeXML(block.content)}</block>`;
    case "image":
      return `${indent}<block type="image">${JSON.stringify(block.source)}</block>`;
    case "other":
      return `${indent}<block type="other">${JSON.stringify(block.raw)}</block>`;
    default:
      return `${indent}<block type="unknown"/>`;
  }
}

export function entryToXML(entry: Entry, indent: string): string {
  const lines: string[] = [];
  const attrs = entry.role ? ` id="${escapeXML(entry.id)}" role="${entry.role}"` : ` id="${escapeXML(entry.id)}"`;
  lines.push(`${indent}<entry${attrs}>`);
  lines.push(`${indent}  <blocks>`);
  for (const block of entry.blocks) {
    lines.push(blockToXML(block, `${indent}    `));
  }
  lines.push(`${indent}  </blocks>`);
  lines.push(`${indent}</entry>`);
  return lines.join("\n");
}

export function conversationToXML(conv: Conversation): string {
  const lines: string[] = ["<conversation>"];
  lines.push(...conversationBodyToXML(conv, "  "));
  lines.push("</conversation>");
  return lines.join("\n");
}

export function entryDeltaToXML(delta: EntryDelta, indent: string): string {
  const lines: string[] = [];
  lines.push(`${indent}<entryDelta id="${escapeXML(delta.id)}">`);
  
  if (delta.added && delta.added.length > 0) {
    lines.push(`${indent}  <added>`);
    for (const block of delta.added) {
      lines.push(blockToXML(block, `${indent}    `));
    }
    lines.push(`${indent}  </added>`);
  }
  
  if (delta.removed && delta.removed.length > 0) {
    lines.push(`${indent}  <removed>`);
    for (const block of delta.removed) {
      lines.push(blockToXML(block, `${indent}    `));
    }
    lines.push(`${indent}  </removed>`);
  }
  
  lines.push(`${indent}</entryDelta>`);
  return lines.join("\n");
}

function deltaToXML(delta: Delta, indent: string): string {
  const lines: string[] = [];
  lines.push(`${indent}<delta>`);
  
  if (delta.sys) {
    lines.push(`${indent}  <sys>`);
    lines.push(entryDeltaToXML(delta.sys, `${indent}    `));
    lines.push(`${indent}  </sys>`);
  }
  
  if (delta.tool) {
    lines.push(`${indent}  <tool>`);
    lines.push(entryDeltaToXML(delta.tool, `${indent}    `));
    lines.push(`${indent}  </tool>`);
  }
  
  lines.push(`${indent}  <msgs>`);
  for (const msgDelta of delta.msgs) {
    lines.push(entryDeltaToXML(msgDelta, `${indent}    `));
  }
  lines.push(`${indent}  </msgs>`);
  
  lines.push(`${indent}</delta>`);
  return lines.join("\n");
}

export function timelineToXML(timeline: SessionTimeline): string {
  const lines: string[] = [];
  lines.push("<timeline>");
  lines.push(`  <sessionId>${escapeXML(timeline.sessionId)}</sessionId>`);
  lines.push(`  <totalRequests>${timeline.totalRequests}</totalRequests>`);
  lines.push("  <changes>");
  
  for (const change of timeline.changes) {
    lines.push(`    <change requestId="${change.requestId}">`);
    lines.push(deltaToXML(change.delta, "      "));
    lines.push(`    </change>`);
  }
  
  lines.push("  </changes>");
  lines.push("</timeline>");
  return lines.join("\n");
}

export function conversationsMapToXML(map: Record<number, Conversation>): string {
  const lines: string[] = ["<conversations>"];
  
  for (const [reqId, conv] of Object.entries(map)) {
    lines.push(`  <conversation reqId="${reqId}">`);
    lines.push(...conversationBodyToXML(conv, "    "));
    lines.push("  </conversation>");
  }
  
  lines.push("</conversations>");
  return lines.join("\n");
}

export function deltasMapToXML(map: Record<number, Delta>): string {
  const lines: string[] = [];
  lines.push("<deltas>");
  
  for (const [reqId, delta] of Object.entries(map)) {
    lines.push(`  <delta reqId="${reqId}">`);
    lines.push(deltaToXML(delta as Delta, "    "));
    lines.push("  </delta>");
  }
  
  lines.push("</deltas>");
  return lines.join("\n");
}