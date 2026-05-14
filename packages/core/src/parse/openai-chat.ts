import type { Parser, Conversation, Entry, Block } from "./types.js";
import {
  generateId,
  createSysEntry,
  createToolEntry,
  createMsgEntry,
  createTextBlock,
  createThinkingBlock,
  createToolDefinitionBlock,
  createToolCallBlock,
  createToolResultBlock,
  createImageBlock,
  createOtherBlock,
} from "./utils.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractMessages(body: Record<string, unknown>): Entry[] {
  const raw = body.messages;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((msg: unknown) => !(isRecord(msg) && (msg.role === "system" || msg.role === "developer")))
    .map((msg: unknown): Entry => {
    if (!isRecord(msg)) return createMsgEntry("user", [createTextBlock(String(msg))]);

    const role = (String(msg.role ?? "user") as "user" | "assistant" | "tool");
    const blocks: Block[] = [];

    if (typeof msg.content === "string" && msg.content) {
      blocks.push(createTextBlock(msg.content));
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as unknown[]) {
        if (typeof part === "string") {
          blocks.push(createTextBlock(part));
        } else if (isRecord(part)) {
          if (typeof part.text === "string" && part.text) {
            blocks.push(createTextBlock(part.text));
          } else if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
            blocks.push(createImageBlock(part.image_url.url));
          } else if (part.type === "input_audio") {
            blocks.push(createOtherBlock({ type: "audio", data: part }));
          } else {
            blocks.push(createOtherBlock(part));
          }
        }
      }
    }

    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as unknown[]) {
        if (!isRecord(tc)) continue;
        const fn = isRecord(tc.function) ? tc.function : {};
        blocks.push(createToolCallBlock(
          String(tc.id ?? ""),
          String(fn.name ?? ""),
          typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {})
        ));
      }
    }

    if (msg.tool_call_id != null) {
      const content = blocks.length > 0 
        ? blocks.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("")
        : "";
      return createMsgEntry(role, [createToolResultBlock(String(msg.tool_call_id), content || JSON.stringify(msg.content ?? ""))]);
    }

    if (typeof msg.reasoning_content === "string") {
      blocks.unshift(createThinkingBlock(msg.reasoning_content));
    }

    if (blocks.length === 0) {
      blocks.push(createTextBlock(""));
    }

    return createMsgEntry(role, blocks);
  });
}

function extractTools(body: Record<string, unknown>): Entry | undefined {
  const raw = body.tools;
  if (!Array.isArray(raw)) return undefined;

  const blocks = raw.map((tool: unknown): Block => {
    if (!isRecord(tool)) return createToolDefinitionBlock(String(tool), null, null);
    const fn = isRecord(tool.function) ? tool.function : {};
    return createToolDefinitionBlock(
      String(fn.name ?? tool.name ?? ""),
      typeof fn.description === "string" ? fn.description : null,
      fn.parameters ?? null
    );
  });

  if (blocks.length === 0) return undefined;
  return createToolEntry(blocks);
}

function extractSystem(body: Record<string, unknown>): Entry | undefined {
  const systemParts: string[] = [];

  if (typeof body.system === "string") systemParts.push(body.system);
  if (typeof body.developer === "string") systemParts.push(body.developer);
  if (typeof body.instructions === "string") systemParts.push(body.instructions);

  const systemFromMessages = (Array.isArray(body.messages) ? body.messages as unknown[] : [])
    .filter((m): m is Record<string, unknown> => isRecord(m) && (m.role === "system" || m.role === "developer"))
    .map((m) => (typeof m.content === "string" ? m.content : ""));

  systemParts.push(...systemFromMessages);

  const text = systemParts.join("\n");
  if (!text) return undefined;
  return createSysEntry([createTextBlock(text)]);
}

function extractUsage(body: Record<string, unknown>): Conversation["usage"] {
  const usage = body.usage;
  if (!isRecord(usage)) return null;
  
  const inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  
  const cachedTokens = typeof promptDetails.cached_tokens === "number" ? promptDetails.cached_tokens : 0;
  
  const inputMiss = inputTokens - cachedTokens;
  
  return {
    inputMissTokens: inputMiss > 0 ? inputMiss : null,
    inputHitTokens: cachedTokens > 0 ? cachedTokens : null,
    outputTokens: outputTokens > 0 ? outputTokens : null,
  };
}

export const openaiChatParser: Parser = {
  provider: "openai-chat",

  match(url: string, body: unknown): boolean {
    if (!url.includes("/chat/completions")) return false;
    if (isRecord(body) && Array.isArray(body.messages)) return true;
    return url.includes("openai.com");
  },

  parseRequest(body: unknown): Conversation {
    if (!isRecord(body)) {
      return { provider: this.provider, model: null, msgs: [], usage: null, stream: false };
    }

    return {
      provider: this.provider,
      model: typeof body.model === "string" ? body.model : null,
      sys: extractSystem(body),
      tool: extractTools(body),
      msgs: extractMessages(body),
      usage: null,
      stream: body.stream === true,
    };
  },

  parseResponse(body: unknown): Partial<Conversation> {
    if (!isRecord(body)) return {};

    const choices = body.choices;
    const msgs: Entry[] = [];

    if (Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0];
      if (isRecord(choice)) {
        const msg = choice.message;
        if (isRecord(msg)) {
          const blocks: Block[] = [];

          if (typeof msg.reasoning_content === "string") {
            blocks.push(createThinkingBlock(msg.reasoning_content));
          }

          if (typeof msg.content === "string" && msg.content) {
            blocks.push(createTextBlock(msg.content));
          }

          if (Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls as unknown[]) {
              if (!isRecord(tc)) continue;
              const fn = isRecord(tc.function) ? tc.function : {};
              blocks.push(createToolCallBlock(
                String(tc.id ?? ""),
                String(fn.name ?? ""),
                typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {})
              ));
            }
          }

          if (blocks.length === 0) {
            blocks.push(createTextBlock(""));
          }

          msgs.push(createMsgEntry("assistant", blocks));
        }
      }
    }

    return {
      model: typeof body.model === "string" ? body.model : undefined,
      msgs,
      usage: extractUsage(body),
    };
  },
};

import { registerParser } from "./registry.js";
registerParser(openaiChatParser);
