export { 
  conversationToXML, 
  timelineToXML, 
  conversationsMapToXML, 
  deltasMapToXML,
  entryToXML,
  entryDeltaToXML
} from "./xml.js";

export { 
  collapseConversations, 
  collapseDeltas,
  collapseConversation,
  collapseDelta,
  collapseBlocksInEntry,
  getBlockId,
  writeBlockFile,
  writeEntryFile
} from "./collapse.js";

export type { 
  CollapseOptions, 
  CollapsedExport,
  CollapsedConversation,
  CollapsedDelta,
  BlockFile,
  EntryFile,
  XMLRef,
  CollapsedEntry
} from "./collapse.js";