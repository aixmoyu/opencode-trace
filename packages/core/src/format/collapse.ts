import type { BlockType, Block, Entry } from "../parse/types.js";
import type { Delta, EntryDelta } from "../query/types.js";
import { blockToXML, entryToXML, entryDeltaToXML, escapeXML } from "./xml.js";

export interface CollapseOptions {
  collapse?: ("sys" | "tool" | "msgs")[];
  collapseBlocks?: BlockType[];
  format?: "json" | "xml";
}

export interface CollapsedExport {
  main: string;
  blocks: Map<string, string>;
}

export interface BlockFile {
  refPath: string;
  content: string;
}

export interface EntryFile {
  refPath: string;
  content: string;
}

export function getBlockId(block: Block, index: number): string {
  switch (block.type) {
    case "tc":
      return block.id;
    case "tr":
      return block.toolCallId;
    default:
      return `${block.type}-${index}`;
  }
}

export function writeBlockFile(block: Block, requestId: number, format: string): BlockFile {
  const blockId = block.type === "tc" ? block.id 
    : block.type === "tr" ? block.toolCallId 
    : "0";

  const extension = format === "xml" ? "xml" : "json";
  const refPath = `blocks/req-${requestId}-${block.type}-${blockId}.${extension}`;
  const content = format === "xml" 
    ? blockToXML(block, "")
    : JSON.stringify(block);

  return { refPath, content };
}

export function writeEntryFile(entry: Entry, requestId: number, type: "sys" | "tool", format: string): EntryFile {
  const extension = format === "xml" ? "xml" : "json";
  const refPath = `blocks/req-${requestId}-${type}.${extension}`;
  const content = format === "xml" 
    ? entryToXML(entry, "")
    : JSON.stringify(entry);

  return { refPath, content };
}

export interface XMLRef {
  blockIndex: number;
  refPath: string;
}

export interface CollapsedEntry {
  entry: Entry;
  blockFiles: Map<string, string>;
  xmlRefs: XMLRef[];
}

export function collapseBlocksInEntry(
  entry: Entry,
  requestId: number,
  collapseBlocks: BlockType[],
  format: string
): CollapsedEntry {
  const blockFiles = new Map<string, string>();
  const xmlRefs: XMLRef[] = [];
  const newBlocks: Block[] = [];

  for (let i = 0; i < entry.blocks.length; i++) {
    const block = entry.blocks[i];
    
    if (collapseBlocks.includes(block.type)) {
      const blockFile = writeBlockFile(block, requestId, format);
      blockFiles.set(blockFile.refPath, blockFile.content);
      
      if (format === "json") {
        newBlocks.push({ "$ref": blockFile.refPath } as unknown as Block);
      } else {
        newBlocks.push(block);
        xmlRefs.push({ blockIndex: i, refPath: blockFile.refPath });
      }
    } else {
      newBlocks.push(block);
    }
  }

  return {
    entry: { ...entry, blocks: newBlocks },
    blockFiles,
    xmlRefs
  };
}

export interface CollapsedConversation {
  conversation: import("../parse/types.js").Conversation;
  files: Map<string, string>;
}

function collapseEntryField(
  entry: Entry | undefined,
  requestId: number,
  type: "sys" | "tool",
  shouldCollapse: boolean,
  format: string,
  files: Map<string, string>
): Entry | undefined {
  if (!entry || !shouldCollapse) {
    return entry;
  }
  
  const entryFile = writeEntryFile(entry, requestId, type, format);
  files.set(entryFile.refPath, entryFile.content);
  
  return format === "json"
    ? { "$ref": entryFile.refPath } as unknown as Entry
    : { ...entry, _xmlRef: entryFile.refPath } as unknown as Entry;
}

function collapseDeltaEntryField(
  entry: EntryDelta | undefined,
  requestId: number,
  type: "sys" | "tool",
  shouldCollapse: boolean,
  format: string,
  files: Map<string, string>
): EntryDelta | undefined {
  if (!entry || !shouldCollapse) {
    return entry;
  }
  
  const extension = format === "xml" ? "xml" : "json";
  const refPath = `blocks/req-${requestId}-${type}.${extension}`;
  files.set(refPath, format === "xml" 
    ? entryDeltaToXML(entry, "")
    : JSON.stringify(entry));
  
  return format === "json"
    ? { "$ref": refPath } as unknown as EntryDelta
    : { ...entry, _xmlRef: refPath } as unknown as EntryDelta;
}

function collapseBlockArray(
  blocks: Block[] | undefined,
  collapseBlocks: BlockType[],
  requestId: number,
  format: string,
  files: Map<string, string>
): Block[] | undefined {
  if (!blocks) return undefined;
  
  return blocks.map(block => {
    if (!collapseBlocks.includes(block.type)) return block;
    
    const blockFile = writeBlockFile(block, requestId, format);
    files.set(blockFile.refPath, blockFile.content);
    
    return format === "json"
      ? { "$ref": blockFile.refPath } as unknown as Block
      : block;
  });
}

export function collapseConversation(
  conversation: import("../parse/types.js").Conversation,
  requestId: number,
  options: CollapseOptions
): CollapsedConversation {
  const files = new Map<string, string>();
  const collapse = options.collapse ?? [];
  const collapseBlocks = options.collapseBlocks ?? [];
  const format = options.format ?? "json";

  const result: import("../parse/types.js").Conversation = {
    provider: conversation.provider,
    model: conversation.model,
    stream: conversation.stream,
    usage: conversation.usage,
    msgs: conversation.msgs
  };

  result.sys = collapseEntryField(conversation.sys, requestId, "sys", collapse.includes("sys"), format, files);
  result.tool = collapseEntryField(conversation.tool, requestId, "tool", collapse.includes("tool"), format, files);

  if (collapse.includes("msgs")) {
    const extension = format === "xml" ? "xml" : "json";
    const refPath = `blocks/req-${requestId}-msgs.${extension}`;
    files.set(refPath, format === "xml"
      ? conversation.msgs.map(m => entryToXML(m, "")).join("\n")
      : JSON.stringify(conversation.msgs));
    if (format === "json") {
      result.msgs = [{ "$ref": refPath }] as unknown as Entry[];
    } else {
      result.msgs = [{ id: "msgs", blocks: [], _xmlRef: refPath }] as unknown as Entry[];
    }
  } else if (collapseBlocks.length > 0) {
    const collapsedMsgs: Entry[] = [];
    for (const msg of conversation.msgs) {
      const collapsed = collapseBlocksInEntry(msg, requestId, collapseBlocks, format);
      collapsedMsgs.push(collapsed.entry);
      for (const [path, content] of collapsed.blockFiles) {
        files.set(path, content);
      }
    }
    result.msgs = collapsedMsgs;
  } else {
    result.msgs = conversation.msgs;
  }

  return { conversation: result, files };
}

export function collapseConversations(
  conversations: Record<number, import("../parse/types.js").Conversation>,
  options: CollapseOptions
): CollapsedExport {
  const blocks = new Map<string, string>();
  const collapsedMap: Record<number, import("../parse/types.js").Conversation> = {};

  for (const [requestId, conversation] of Object.entries(conversations)) {
    const reqId = parseInt(requestId, 10);
    const result = collapseConversation(conversation, reqId, options);
    collapsedMap[reqId] = result.conversation;

    for (const [path, content] of result.files) {
      blocks.set(path, content);
    }
  }

  const format = options.format ?? "json";
  const main = format === "xml"
    ? conversationsMapToCollapsedXML(collapsedMap)
    : JSON.stringify(collapsedMap, null, 2);

  return { main, blocks };
}

function conversationsMapToCollapsedXML(
  map: Record<number, import("../parse/types.js").Conversation>
): string {
  const lines: string[] = [];
  lines.push("<conversations>");

  for (const [reqId, conv] of Object.entries(map)) {
    lines.push(`  <conversation reqId="${reqId}">`);
    lines.push(`    <provider>${escapeXML(conv.provider)}</provider>`);
    if (conv.model) {
      lines.push(`    <model>${escapeXML(conv.model)}</model>`);
    }

    if (conv.sys) {
      if ((conv.sys as any)._xmlRef) {
        lines.push(`    <sys ref="${(conv.sys as any)._xmlRef}"/>`);
      } else if ((conv.sys as any).$ref) {
        lines.push(`    <sys ref="${(conv.sys as any).$ref}"/>`);
      } else {
        lines.push("    <sys>");
        lines.push(entryToXML(conv.sys, "      "));
        lines.push("    </sys>");
      }
    }

    if (conv.tool) {
      if ((conv.tool as any)._xmlRef) {
        lines.push(`    <tool ref="${(conv.tool as any)._xmlRef}"/>`);
      } else if ((conv.tool as any).$ref) {
        lines.push(`    <tool ref="${(conv.tool as any).$ref}"/>`);
      } else {
        lines.push("    <tool>");
        lines.push(entryToXML(conv.tool, "      "));
        lines.push("    </tool>");
      }
    }

    lines.push("    <msgs>");
    for (const msg of conv.msgs) {
      if ((msg as any)._xmlRef) {
        lines.push(`      <msgs ref="${(msg as any)._xmlRef}"/>`);
      } else {
        lines.push(entryToXML(msg, "      "));
      }
    }
    lines.push("    </msgs>");

    if (conv.usage) {
      lines.push("    <usage>");
      lines.push(`      <inputMissTokens>${conv.usage.inputMissTokens ?? 0}</inputMissTokens>`);
      lines.push(`      <inputHitTokens>${conv.usage.inputHitTokens ?? 0}</inputHitTokens>`);
      lines.push(`      <outputTokens>${conv.usage.outputTokens ?? 0}</outputTokens>`);
      lines.push("    </usage>");
    }

    lines.push("  </conversation>");
  }

  lines.push("</conversations>");
  return lines.join("\n");
}

export interface CollapsedDelta {
  delta: Delta;
  files: Map<string, string>;
}

export function collapseDelta(
  delta: Delta,
  requestId: number,
  options: CollapseOptions
): CollapsedDelta {
  const files = new Map<string, string>();
  const collapse = options.collapse ?? [];
  const collapseBlocks = options.collapseBlocks ?? [];
  const format = options.format ?? "json";

  const result: Delta = { msgs: delta.msgs };

  result.sys = collapseDeltaEntryField(delta.sys, requestId, "sys", collapse.includes("sys"), format, files);
  result.tool = collapseDeltaEntryField(delta.tool, requestId, "tool", collapse.includes("tool"), format, files);

  if (collapse.includes("msgs")) {
    const extension = format === "xml" ? "xml" : "json";
    const refPath = `blocks/req-${requestId}-msgs.${extension}`;
    files.set(refPath, format === "xml"
      ? delta.msgs.map(m => entryDeltaToXML(m, "")).join("\n")
      : JSON.stringify(delta.msgs));
    if (format === "json") {
      result.msgs = [{ "$ref": refPath }] as unknown as EntryDelta[];
    } else {
      result.msgs = [{ id: "msgs", added: [], _xmlRef: refPath }] as unknown as EntryDelta[];
    }
  } else if (collapseBlocks.length > 0) {
    result.msgs = delta.msgs.map(msgDelta => ({
      id: msgDelta.id,
      added: collapseBlockArray(msgDelta.added, collapseBlocks, requestId, format, files),
      removed: collapseBlockArray(msgDelta.removed, collapseBlocks, requestId, format, files)
    }));
  }

  return { delta: result, files };
}

export function collapseDeltas(
  deltas: Record<number, Delta>,
  options: CollapseOptions
): CollapsedExport {
  const blocks = new Map<string, string>();
  const collapsedMap: Record<number, Delta> = {};

  for (const [requestId, delta] of Object.entries(deltas)) {
    const reqId = parseInt(requestId, 10);
    const result = collapseDelta(delta, reqId, options);
    collapsedMap[reqId] = result.delta;

    for (const [path, content] of result.files) {
      blocks.set(path, content);
    }
  }

  const main = options.format === "xml"
    ? deltasMapToCollapsedXML(collapsedMap)
    : JSON.stringify(collapsedMap, null, 2);

  return { main, blocks };
}

function deltasMapToCollapsedXML(map: Record<number, Delta>): string {
  const lines: string[] = [];
  lines.push("<deltas>");

  for (const [reqId, delta] of Object.entries(map)) {
    lines.push(`  <delta reqId="${reqId}">`);

    if (delta.sys) {
      const sys = delta.sys as any;
      if (sys._xmlRef) {
        lines.push(`    <sys ref="${sys._xmlRef}"/>`);
      } else if (sys.$ref) {
        lines.push(`    <sys ref="${sys.$ref}"/>`);
      } else {
        lines.push("    <sys>");
        lines.push(entryDeltaToXML(delta.sys!, "      "));
        lines.push("    </sys>");
      }
    }

    if (delta.tool) {
      const tool = delta.tool as any;
      if (tool._xmlRef) {
        lines.push(`    <tool ref="${tool._xmlRef}"/>`);
      } else if (tool.$ref) {
        lines.push(`    <tool ref="${tool.$ref}"/>`);
      } else {
        lines.push("    <tool>");
        lines.push(entryDeltaToXML(delta.tool!, "      "));
        lines.push("    </tool>");
      }
    }

    lines.push("    <msgs>");
    for (const msgDelta of delta.msgs) {
      const msg = msgDelta as any;
      if (msg._xmlRef) {
        lines.push(`      <msgs ref="${msg._xmlRef}"/>`);
      } else {
        lines.push(entryDeltaToXML(msgDelta, "      "));
      }
    }
    lines.push("    </msgs>");

    lines.push("  </delta>");
  }

  lines.push("</deltas>");
  return lines.join("\n");
}