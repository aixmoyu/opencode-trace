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
  createOtherBlock,
} from "./utils.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractInputMessages(input: unknown): Entry[] {
  const msgs: Entry[] = [];
  if (typeof input === "string") {
    msgs.push(createMsgEntry("user", [createTextBlock(input)]));
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === "string") {
        msgs.push(createMsgEntry("user", [createTextBlock(item)]));
        continue;
      }
      if (!isRecord(item)) continue;
      const type = item.type;

      if (type === "message" || item.role) {
        const role = String(item.role ?? "user") as "user" | "assistant" | "tool";
        const contentParts = item.content;
        const blocks: Block[] = [];

        if (typeof contentParts === "string") {
          blocks.push(createTextBlock(contentParts));
        } else if (Array.isArray(contentParts)) {
          for (const part of contentParts as unknown[]) {
            if (typeof part === "string") {
              blocks.push(createTextBlock(part));
            } else if (isRecord(part)) {
              if (part.type === "input_text" && typeof part.text === "string") {
                blocks.push(createTextBlock(part.text));
              } else if (part.type === "text" && typeof part.text === "string") {
                blocks.push(createTextBlock(part.text));
              } else if (part.type === "output_text" && typeof part.text === "string") {
                blocks.push(createTextBlock(part.text));
              } else if (part.type === "input_image") {
                blocks.push(createOtherBlock({ type: "image", source: part }));
              } else if (part.type === "input_file") {
                blocks.push(createOtherBlock({ type: "file", source: part }));
              } else if (typeof part.text === "string") {
                blocks.push(createTextBlock(part.text));
              } else {
                blocks.push(createOtherBlock(part));
              }
            }
          }
        }

        if (role === "tool" && item.tool_call_id != null) {
          const content = blocks.length > 0 
            ? blocks.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("")
            : "";
          msgs.push(createMsgEntry("tool", [createToolResultBlock(String(item.tool_call_id), content || JSON.stringify(item.content ?? ""))]));
        } else {
          if (blocks.length === 0) {
            blocks.push(createTextBlock(""));
          }
          msgs.push(createMsgEntry(role, blocks));
        }
      } else if (type === "function_call") {
        msgs.push(createMsgEntry("assistant", [
          createToolCallBlock(
            String(item.id ?? item.call_id ?? ""),
            String(item.name ?? ""),
            typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {})
          )
        ]));
      } else if (type === "function_call_output") {
        msgs.push(createMsgEntry("tool", [
          createToolResultBlock(
            String(item.call_id ?? ""),
            typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "")
          )
        ]));
      }
    }
  }
  return msgs;
}

export const openaiResponsesParser: Parser = {
  provider: "openai-responses",

  match(url: string, body: unknown): boolean {
    if (!url.includes("/responses")) return false;
    if (isRecord(body) && body.input !== undefined) return true;
    return url.includes("openai.com");
  },

  parseRequest(body: unknown): Conversation {
    if (!isRecord(body)) {
      return { provider: this.provider, model: null, msgs: [], usage: null, stream: false };
    }

    const msgs = extractInputMessages(body.input);

    const toolBlocks: Block[] = [];
    if (Array.isArray(body.tools)) {
      for (const tool of body.tools) {
        if (!isRecord(tool)) continue;
        if (tool.type === "function" && isRecord(tool.function)) {
          toolBlocks.push(createToolDefinitionBlock(
            String(tool.function.name ?? ""),
            typeof tool.function.description === "string" ? tool.function.description : null,
            tool.function.parameters ?? null
          ));
        } else if (tool.type === "web_search_preview" || tool.type === "web_search_preview_2025_03_11") {
          toolBlocks.push(createToolDefinitionBlock("web_search_preview", "Web search tool", null));
        } else if (tool.type === "file_search") {
          toolBlocks.push(createToolDefinitionBlock(
            "file_search",
            typeof tool.vector_store_ids === "string" ? "File search: " + tool.vector_store_ids : "File search tool",
            null
          ));
        } else if (tool.type === "computer_use_preview") {
          toolBlocks.push(createToolDefinitionBlock("computer_use_preview", "Computer use tool", null));
        } else if (tool.type === "code_interpreter") {
          toolBlocks.push(createToolDefinitionBlock("code_interpreter", "Code interpreter tool", null));
        } else {
          toolBlocks.push(createToolDefinitionBlock(
            String(tool.name ?? tool.type ?? ""),
            typeof tool.description === "string" ? tool.description : null,
            null
          ));
        }
      }
    }

    const sysBlocks: Block[] = [];
    if (typeof body.instructions === "string") {
      sysBlocks.push(createTextBlock(body.instructions));
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
    if (Array.isArray(body.output)) {
      for (const item of body.output) {
        if (!isRecord(item)) continue;

        if (item.type === "message") {
          const contentParts = item.content;
          const blocks: Block[] = [];

          if (Array.isArray(contentParts)) {
            for (const p of contentParts as unknown[]) {
              if (!isRecord(p)) continue;
              if (p.type === "output_text" && typeof p.text === "string") {
                blocks.push(createTextBlock(p.text));
              } else if (p.type === "refusal" && typeof p.refusal === "string") {
                blocks.push(createTextBlock("[refused: " + p.refusal + "]"));
              } else {
                blocks.push(createOtherBlock(p));
              }
            }
          }

          if (blocks.length === 0) {
            blocks.push(createTextBlock(""));
          }
          msgs.push(createMsgEntry("assistant", blocks));
        } else if (item.type === "function_call") {
          msgs.push(createMsgEntry("assistant", [
            createToolCallBlock(
              String(item.id ?? item.call_id ?? ""),
              String(item.name ?? ""),
              typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {})
            )
          ]));
        } else if (item.type === "function_call_output") {
          msgs.push(createMsgEntry("tool", [
            createToolResultBlock(
              String(item.call_id ?? ""),
              typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "")
            )
          ]));
        } else if (item.type === "reasoning") {
          let thinkingText = "";
          if (Array.isArray(item.summary)) {
            thinkingText = (item.summary as unknown[])
              .map((s: unknown) => {
                if (isRecord(s) && s.type === "summary_text" && typeof s.text === "string") return s.text;
                return "";
              })
              .join("");
          }
          msgs.push(createMsgEntry("assistant", thinkingText ? [createThinkingBlock(thinkingText)] : [createTextBlock("")]));
        } else if (item.type === "web_search_call") {
          msgs.push(createMsgEntry("assistant", [createOtherBlock({ type: "web_search", status: item.status })]));
        } else if (item.type === "file_search_call") {
          msgs.push(createMsgEntry("assistant", [createOtherBlock({ type: "file_search", status: item.status })]));
        } else if (item.type === "computer_call") {
          msgs.push(createMsgEntry("assistant", [createOtherBlock({ type: "computer_use" })]));
        } else {
          msgs.push(createMsgEntry("assistant", [createOtherBlock(item)]));
        }
      }
    }

    const usage = body.usage;
    let parsedUsage: Conversation["usage"] = null;
    if (isRecord(usage)) {
      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      
      const cachedTokens = isRecord(usage.input_tokens_details) && typeof (usage.input_tokens_details as Record<string, unknown>).cached_tokens === "number"
        ? (usage.input_tokens_details as Record<string, unknown>).cached_tokens as number
        : 0;
      
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
registerParser(openaiResponsesParser);
