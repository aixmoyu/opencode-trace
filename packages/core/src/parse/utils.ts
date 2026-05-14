import type { Block, Entry, ToolDefinitionBlock } from "./types.js";

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).slice(0, 9);
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export function generateStableId(role: string, blocks: Block[]): string {
  const contentKey = blocks.map(b => {
    switch (b.type) {
      case "text": return `t:${b.text.slice(0, 100)}`;
      case "thinking": return `k:${b.thinking.slice(0, 100)}`;
      case "tc": return `c:${b.id}:${b.name}`;
      case "tr": return `r:${b.toolCallId}`;
      default: return b.type;
    }
  }).join("|");
  return hashString(`${role}:${contentKey}`);
}

export function createSysEntry(blocks: Block[]): Entry {
  return { id: "sys", blocks };
}

export function createToolEntry(blocks: Block[]): Entry {
  return { id: "tool", blocks };
}

export function createMsgEntry(role: "user" | "assistant" | "tool", blocks: Block[]): Entry {
  return { id: generateStableId(role, blocks), role, blocks };
}

export function createTextBlock(text: string): Block {
  return { type: "text", text };
}

export function createThinkingBlock(thinking: string): Block {
  return { type: "thinking", thinking };
}

export function createToolDefinitionBlock(name: string, description: string | null, inputSchema: unknown): ToolDefinitionBlock {
  return { type: "td", name, description, inputSchema };
}

export function createToolCallBlock(id: string, name: string, args: string): Block {
  return { type: "tc", id, name, arguments: args };
}

export function createToolResultBlock(toolCallId: string, content: string): Block {
  return { type: "tr", toolCallId, content };
}

export function createImageBlock(source: unknown): Block {
  return { type: "image", source };
}

export function createOtherBlock(raw: unknown): Block {
  return { type: "other", raw };
}