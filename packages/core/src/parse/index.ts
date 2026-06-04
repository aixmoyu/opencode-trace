/** 
 * Parsed cache format version. 
 * Increment when `detectAndParse()` output format changes 
 * (e.g., Conversation type fields added/renamed/removed).
 * This ensures the viewer detects stale cached parsed files 
 * after a core/plugin upgrade.
 */
export const PARSED_CACHE_VERSION = "1";

import "./openai-chat.js";
import "./openai-responses.js";
import "./anthropic.js";

export { openaiChatParser } from "./openai-chat.js";
export { openaiResponsesParser } from "./openai-responses.js";
export { anthropicParser } from "./anthropic.js";

export {
  detectAndParse,
  detectProvider,
  extractUsage,
  extractLatency,
} from "./detect.js";
export type { LatencyInfo } from "./detect.js";
export {
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
export type {
  Conversation,
  Entry,
  Block,
  BlockType,
  TextBlock,
  ThinkingBlock,
  ToolDefinitionBlock,
  ToolCallBlock,
  ToolResultBlock,
  ImageBlock,
  OtherBlock,
  Parser,
} from "./types.js";
