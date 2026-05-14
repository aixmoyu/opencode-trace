import { z } from "zod";

export const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
});

export const ToolDefinitionBlockSchema = z.object({
  type: z.literal("td"),
  name: z.string(),
  description: z.string().nullable(),
  inputSchema: z.unknown(),
});

export const ToolCallBlockSchema = z.object({
  type: z.literal("tc"),
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
});

export const ToolResultBlockSchema = z.object({
  type: z.literal("tr"),
  toolCallId: z.string(),
  content: z.string(),
});

export const ImageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.unknown(),
});

export const OtherBlockSchema = z.object({
  type: z.literal("other"),
  raw: z.unknown(),
});

export const BlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ThinkingBlockSchema,
  ToolDefinitionBlockSchema,
  ToolCallBlockSchema,
  ToolResultBlockSchema,
  ImageBlockSchema,
  OtherBlockSchema,
]);

export const EntrySchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]).optional(),
  blocks: z.array(BlockSchema),
});

export const UsageSchema = z.object({
  inputMissTokens: z.number().nullable(),
  inputHitTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
});

export const ConversationSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  sys: EntrySchema.optional(),
  tool: EntrySchema.optional(),
  msgs: z.array(EntrySchema),
  usage: UsageSchema.nullable(),
  stream: z.boolean(),
});


