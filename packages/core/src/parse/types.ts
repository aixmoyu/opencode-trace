export type BlockType = "text" | "thinking" | "td" | "tc" | "tr" | "image" | "other";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolDefinitionBlock {
  type: "td";
  name: string;
  description: string | null;
  inputSchema: unknown;
}

export interface ToolCallBlock {
  type: "tc";
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResultBlock {
  type: "tr";
  toolCallId: string;
  content: string;
}

export interface ImageBlock {
  type: "image";
  source: unknown;
}

export interface OtherBlock {
  type: "other";
  raw: unknown;
}

export type Block = TextBlock | ThinkingBlock | ToolDefinitionBlock | ToolCallBlock | ToolResultBlock | ImageBlock | OtherBlock;

export interface Entry {
  id: string;
  role?: "user" | "assistant" | "tool";
  blocks: Block[];
}

export interface Conversation {
  provider: string;
  model: string | null;
  sys?: Entry;
  tool?: Entry;
  msgs: Entry[];
  usage: {
    inputMissTokens: number | null;
    inputHitTokens: number | null;
    outputTokens: number | null;
  } | null;
  stream: boolean;
}

export interface Parser {
  readonly provider: string;
  match(url: string, body: unknown): boolean;
  parseRequest(body: unknown): Conversation;
  parseResponse(body: unknown): Partial<Conversation>;
}