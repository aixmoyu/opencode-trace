import type { Parser, Conversation, Entry, Block } from "./types.js";
import {
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

export const anthropicParser: Parser = {
  provider: "anthropic",

  match(url: string, _body: unknown): boolean {
    return url.includes("/v1/messages");
  },

  parseRequest(body: unknown): Conversation {
    if (!isRecord(body)) {
      return { provider: this.provider, model: null, msgs: [], usage: null, stream: false };
    }

    const sysBlocks: Block[] = [];
    if (typeof body.system === "string") {
      sysBlocks.push(createTextBlock(body.system));
    } else if (Array.isArray(body.system)) {
      for (const b of body.system as unknown[]) {
        if (typeof b === "string") {
          sysBlocks.push(createTextBlock(b));
        } else if (isRecord(b) && b.type === "text" && typeof b.text === "string") {
          sysBlocks.push(createTextBlock(b.text));
        }
      }
    }

    const toolBlocks: Block[] = [];
    if (Array.isArray(body.tools)) {
      for (const tool of body.tools) {
        if (!isRecord(tool)) continue;
        toolBlocks.push(createToolDefinitionBlock(
          String(tool.name ?? ""),
          typeof tool.description === "string" ? tool.description : null,
          tool.input_schema ?? null
        ));
      }
    }

    const msgs: Entry[] = [];
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!isRecord(msg)) continue;
        const role = String(msg.role ?? "user") as "user" | "assistant" | "tool";
        const blocks: Block[] = [];

        if (typeof msg.content === "string") {
          blocks.push(createTextBlock(msg.content));
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content as unknown[]) {
            if (typeof block === "string") {
              blocks.push(createTextBlock(block));
            } else if (isRecord(block)) {
              if (block.type === "text" && typeof block.text === "string") {
                blocks.push(createTextBlock(block.text));
              } else if (block.type === "thinking" && typeof block.thinking === "string") {
                blocks.push(createThinkingBlock(block.thinking));
              } else if (block.type === "image" && isRecord(block.source)) {
                blocks.push(createImageBlock(block.source));
              } else if (block.type === "tool_use") {
                const input = typeof block.input === "string" 
                  ? block.input 
                  : JSON.stringify(block.input ?? {});
                blocks.push(createToolCallBlock(
                  String(block.id ?? ""),
                  String(block.name ?? ""),
                  input
                ));
              } else if (block.type === "tool_result") {
                let contentStr = "";
                if (typeof block.content === "string") {
                  contentStr = block.content;
                } else if (Array.isArray(block.content)) {
                  contentStr = (block.content as unknown[])
                    .map((c: unknown) => {
                      if (typeof c === "string") return c;
                      if (isRecord(c) && c.type === "text" && typeof c.text === "string") return c.text;
                      return "";
                    })
                    .join("");
                }
                blocks.push(createToolResultBlock(
                  String(block.tool_use_id ?? ""),
                  contentStr
                ));
              } else {
                blocks.push(createOtherBlock(block));
              }
            }
          }
        }

        if (blocks.length === 0) {
          blocks.push(createTextBlock(""));
        }

        msgs.push(createMsgEntry(role, blocks));
      }
    }

    return {
      provider: this.provider,
      model: typeof body.model === "string" ? body.model : null,
      sys: sysBlocks.length > 0 ? createSysEntry(sysBlocks) : undefined,
      tool: toolBlocks.length > 0 ? createToolEntry(toolBlocks) : undefined,
      msgs,
      usage: null,
      stream: body.stream === true,
    };
  },

  parseResponse(body: unknown): Partial<Conversation> {
    if (!isRecord(body)) return {};

    const msgs: Entry[] = [];
    if (Array.isArray(body.content)) {
      const blocks: Block[] = [];

      for (const block of body.content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string") {
          blocks.push(createTextBlock(block.text));
        } else if (block.type === "thinking" && typeof block.thinking === "string") {
          blocks.push(createThinkingBlock(block.thinking));
        } else if (block.type === "tool_use") {
          const input = typeof block.input === "string" 
            ? block.input 
            : JSON.stringify(block.input ?? {});
          blocks.push(createToolCallBlock(
            String(block.id ?? ""),
            String(block.name ?? ""),
            input
          ));
        } else {
          blocks.push(createOtherBlock(block));
        }
      }

      if (blocks.length > 0) {
        msgs.push(createMsgEntry("assistant", blocks));
      }
    }

    const usage = body.usage;
    let parsedUsage: Conversation["usage"] = null;
    if (isRecord(usage)) {
      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      const cachedTokens = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
      
      const inputMiss = inputTokens - cachedTokens;
      
      parsedUsage = {
        inputMissTokens: inputMiss > 0 ? inputMiss : null,
        inputHitTokens: cachedTokens > 0 ? cachedTokens : null,
        outputTokens: outputTokens > 0 ? outputTokens : null,
      };
    }

    return {
      model: typeof body.model === "string" ? body.model : undefined,
      msgs,
      usage: parsedUsage,
    };
  },
};

import { registerParser } from "./registry.js";
registerParser(anthropicParser);
