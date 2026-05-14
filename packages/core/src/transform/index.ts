import { parseSSE } from "./sse.js";
import type { Entry, Block, Conversation } from "../parse/types.js";
import { createMsgEntry, createTextBlock, createThinkingBlock, createToolCallBlock } from "../parse/utils.js";
import { logger } from "../logger.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface SSEParseResult {
  messages: Entry[];
  usage: Conversation["usage"];
}

export function sseOpenaiChatToMessages(raw: string): Entry[] {
  const result = sseOpenaiChatParse(raw);
  return result.messages;
}

export function sseOpenaiChatParse(raw: string): SSEParseResult {
  const events = parseSSE(raw);
  let content = "";
  let reasoningContent = "";
  const toolCalls: { id: string; name: string; arguments: string }[] = [];
  let usage: Conversation["usage"] = null;

  for (const event of events) {
    if (!event.data || event.data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(event.data);
      if (!isRecord(parsed)) continue;

      if (isRecord(parsed.usage)) {
        const promptDetails = isRecord(parsed.usage.prompt_tokens_details) ? parsed.usage.prompt_tokens_details : {};
        const completionDetails = isRecord(parsed.usage.completion_tokens_details) ? parsed.usage.completion_tokens_details : {};

        const inputTokens = typeof parsed.usage.prompt_tokens === "number" ? parsed.usage.prompt_tokens : 0;
        const outputTokens = typeof parsed.usage.completion_tokens === "number" ? parsed.usage.completion_tokens : 0;
        const cachedTokens = typeof promptDetails.cached_tokens === "number" ? promptDetails.cached_tokens : 0;
        const inputMiss = inputTokens - cachedTokens;

        usage = {
          inputMissTokens: inputMiss > 0 ? inputMiss : null,
          inputHitTokens: cachedTokens > 0 ? cachedTokens : null,
          outputTokens: outputTokens > 0 ? outputTokens : null,
        };
      }

      const choices = parsed.choices;
      if (!Array.isArray(choices) || choices.length === 0) continue;
      const delta = (choices[0] as Record<string, unknown>)?.delta;
      if (!isRecord(delta)) continue;

      if (typeof delta.content === "string") {
        content += delta.content;
      }

      if (typeof delta.reasoning_content === "string") {
        reasoningContent += delta.reasoning_content;
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls as unknown[]) {
          if (!isRecord(tc)) continue;
          const idx = typeof tc.index === "number" ? tc.index : toolCalls.length;
          const fn = isRecord(tc.function) ? tc.function : {};
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: String(tc.id ?? ""),
              name: String(fn.name ?? ""),
              arguments: "",
            };
          }
          if (typeof fn.arguments === "string") {
            toolCalls[idx].arguments += fn.arguments;
          }
        }
      }
    } catch (err) {
      logger.debug("Failed to parse SSE event in OpenAI Chat stream", { error: String(err) });
    }
  }

  if (content === "" && toolCalls.length === 0 && reasoningContent === "") {
    return { messages: [], usage };
  }

  const blocks: Block[] = [];
  if (reasoningContent) {
    blocks.push(createThinkingBlock(reasoningContent));
  }
  if (content) {
    blocks.push(createTextBlock(content));
  }
  for (const tc of toolCalls) {
    blocks.push(createToolCallBlock(tc.id, tc.name, tc.arguments));
  }

  if (blocks.length === 0) {
    blocks.push(createTextBlock(""));
  }

  return { messages: [createMsgEntry("assistant", blocks)], usage };
}

export function sseOpenaiResponsesToMessages(raw: string): Entry[] {
  const result = sseOpenaiResponsesParse(raw);
  return result.messages;
}

export function sseOpenaiResponsesParse(raw: string): SSEParseResult {
  const events = parseSSE(raw);
  const msgs: Entry[] = [];
  let currentText = "";
  let currentThinking = "";
  const toolCalls: { id: string; name: string; arguments: string }[] = [];
  const toolCallArgs: Map<number, { id: string; name: string; args: string }> = new Map();
  let usage: Conversation["usage"] = null;

  for (const event of events) {
    if (!event.data) continue;
    try {
      const parsed = JSON.parse(event.data);
      if (!isRecord(parsed)) continue;
      const type = parsed.type;

      if (isRecord(parsed.usage)) {
        const inputDetails = isRecord(parsed.usage.input_tokens_details) ? parsed.usage.input_tokens_details : {};

        const inputTokens = typeof parsed.usage.input_tokens === "number" ? parsed.usage.input_tokens : 0;
        const outputTokens = typeof parsed.usage.output_tokens === "number" ? parsed.usage.output_tokens : 0;
        const cachedTokens = typeof inputDetails.cached_tokens === "number" ? inputDetails.cached_tokens : 0;
        const inputMiss = inputTokens - cachedTokens;

        usage = {
          inputMissTokens: inputMiss > 0 ? inputMiss : null,
          inputHitTokens: cachedTokens > 0 ? cachedTokens : null,
          outputTokens: outputTokens > 0 ? outputTokens : null,
        };
      }

      if (type === "response.output_text.delta") {
        if (typeof parsed.delta === "string") {
          currentText += parsed.delta;
        }
      } else if (type === "response.reasoning_summary_text.delta") {
        if (typeof parsed.delta === "string") {
          currentThinking += parsed.delta;
        }
      } else if (type === "response.function_call_arguments.delta") {
        const outputIdx = typeof parsed.output_index === "number" ? parsed.output_index : -1;
        if (typeof parsed.delta === "string") {
          const existing = toolCallArgs.get(outputIdx);
          if (existing) {
            existing.args += parsed.delta;
          }
        }
      } else if (type === "response.output_item.added") {
        const item = parsed.item;
        if (isRecord(item)) {
          if (item.type === "function_call") {
            const outputIdx = typeof parsed.output_index === "number" ? parsed.output_index : toolCallArgs.size;
            toolCallArgs.set(outputIdx, {
              id: String(item.id ?? item.call_id ?? ""),
              name: String(item.name ?? ""),
              args: "",
            });
          }
        }
      } else if (type === "response.output_item.done") {
        const item = parsed.item;
        if (isRecord(item) && item.type === "function_call") {
          const outputIdx = typeof parsed.output_index === "number" ? parsed.output_index : -1;
          const entry = toolCallArgs.get(outputIdx);
          const finalArgs = typeof item.arguments === "string" ? item.arguments : (entry?.args ?? "");
          toolCalls.push({
            id: String(item.id ?? item.call_id ?? entry?.id ?? ""),
            name: String(item.name ?? entry?.name ?? ""),
            arguments: finalArgs,
          });
        }
      } else if (type === "response.completed") {
        if (currentText || currentThinking || toolCalls.length > 0) {
          const blocks: Block[] = [];
          if (currentThinking) {
            blocks.push(createThinkingBlock(currentThinking));
          }
          if (currentText) {
            blocks.push(createTextBlock(currentText));
          }
          for (const tc of toolCalls) {
            blocks.push(createToolCallBlock(tc.id, tc.name, tc.arguments));
          }
          if (blocks.length === 0) {
            blocks.push(createTextBlock(""));
          }
          msgs.push(createMsgEntry("assistant", blocks));
        }
      }
    } catch (err) {
      logger.debug("Failed to parse SSE event in OpenAI Responses stream", { error: String(err) });
    }
  }

  if (msgs.length === 0 && (currentText || currentThinking || toolCalls.length > 0)) {
    const blocks: Block[] = [];
    if (currentThinking) {
      blocks.push(createThinkingBlock(currentThinking));
    }
    if (currentText) {
      blocks.push(createTextBlock(currentText));
    }
    for (const tc of toolCalls) {
      blocks.push(createToolCallBlock(tc.id, tc.name, tc.arguments));
    }
    if (blocks.length === 0) {
      blocks.push(createTextBlock(""));
    }
    msgs.push(createMsgEntry("assistant", blocks));
  }

  return { messages: msgs, usage };
}

export function sseAnthropicToMessages(raw: string): Entry[] {
  const result = sseAnthropicParse(raw);
  return result.messages;
}

export function sseAnthropicParse(raw: string): SSEParseResult {
  const events = parseSSE(raw);
  let content = "";
  let thinking = "";
  const toolCalls: { id: string; name: string; arguments: string }[] = [];
  let usage: Conversation["usage"] = null;

  for (const event of events) {
    if (!event.data) continue;
    try {
      const parsed = JSON.parse(event.data);
      if (!isRecord(parsed)) continue;
      const type = parsed.type;

      if (isRecord(parsed.usage)) {
        const inputTokens = typeof parsed.usage.input_tokens === "number" ? parsed.usage.input_tokens : 0;
        const outputTokens = typeof parsed.usage.output_tokens === "number" ? parsed.usage.output_tokens : 0;
        const cachedTokens = typeof parsed.usage.cache_read_input_tokens === "number" ? parsed.usage.cache_read_input_tokens : 0;
        const inputMiss = inputTokens - cachedTokens;

        usage = {
          inputMissTokens: inputMiss > 0 ? inputMiss : null,
          inputHitTokens: cachedTokens > 0 ? cachedTokens : null,
          outputTokens: outputTokens > 0 ? outputTokens : null,
        };
      }

      if (type === "content_block_delta") {
        const delta = parsed.delta;
        if (isRecord(delta)) {
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            content += delta.text;
          } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
            thinking += delta.thinking;
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
            if (toolCalls.length > 0) {
              toolCalls[toolCalls.length - 1].arguments += delta.partial_json;
            }
          }
        }
      } else if (type === "content_block_start") {
        const contentBlock = parsed.content_block;
        if (isRecord(contentBlock)) {
          if (contentBlock.type === "tool_use") {
            toolCalls.push({
              id: String(contentBlock.id ?? ""),
              name: String(contentBlock.name ?? ""),
              arguments: "",
            });
          } else if (contentBlock.type === "thinking" && typeof contentBlock.thinking === "string") {
            thinking += contentBlock.thinking;
          }
        }
      }
    } catch (err) {
      logger.debug("Failed to parse SSE event in Anthropic stream", { error: String(err) });
    }
  }

  if (content === "" && toolCalls.length === 0 && thinking === "") {
    return { messages: [], usage };
  }

  const blocks: Block[] = [];
  if (thinking) {
    blocks.push(createThinkingBlock(thinking));
  }
  if (content) {
    blocks.push(createTextBlock(content));
  }
  for (const tc of toolCalls) {
    blocks.push(createToolCallBlock(tc.id, tc.name, tc.arguments));
  }

  if (blocks.length === 0) {
    blocks.push(createTextBlock(""));
  }

  return { messages: [createMsgEntry("assistant", blocks)], usage };
}

export { parseSSE, isSSEData } from "./sse.js";
export type { SSEEvent } from "./sse.js";