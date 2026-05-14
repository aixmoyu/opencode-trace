# M001.7-Format Module Detail Analysis

## Module Overview

| Property | Value |
|----------|-------|
| **Module ID** | M001.7 |
| **Module Name** | Format |
| **Module Path** | packages/core/src/format/ |
| **Priority** | Low |
| **Layer** | Business (Export/Formatting) |
| **Depends on** | M001.2-Parse, M001.4-Query |
| **Depended on by** | M001-Core, M004-Viewer |

### Summary

The Format module provides XML and JSON serialization capabilities for trace data export. It handles conversion of parsed conversation data and timeline structures into human-readable formats, with intelligent collapsing of large blocks into separate files for efficient export. The module supports both full exports and incremental delta exports, making it suitable for both static snapshots and streaming use cases.

---

## File Structure

```
packages/core/src/format/
├── index.ts          # Public API exports (30 lines)
├── xml.ts            # XML conversion utilities (184 lines)
└── collapse.ts       # Collapsed export generation (427 lines)
```

**Total Source Lines**: ~641 (excluding tests)

---

## Public Interface Analysis

### Entry File: `src/format/index.ts`

```typescript
// packages/core/src/format/index.ts
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
```

### XML Conversion Functions (`xml.ts`)

| Function | Signature | Description | Location |
|----------|-----------|-------------|----------|
| `escapeXML` | `(str: string) => string` | Escape XML special characters | xml.ts:4 |
| `blockToXML` | `(block: Block, indent: string) => string` | Convert block to XML element | xml.ts:50 |
| `entryToXML` | `(entry: Entry, indent: string) => string` | Convert entry to XML element | xml.ts:71 |
| `entryDeltaToXML` | `(delta: EntryDelta, indent: string) => string` | Convert entry delta to XML | xml.ts:91 |
| `conversationToXML` | `(conv: Conversation) => string` | Convert full conversation to XML | xml.ts:84 |
| `timelineToXML` | `(timeline: SessionTimeline) => string` | Convert session timeline to XML | xml.ts:141 |
| `conversationsMapToXML` | `(map: Record<number, Conversation>) => string` | Convert conversations map to XML | xml.ts:159 |
| `deltasMapToXML` | `(map: Record<number, Delta>) => string` | Convert deltas map to XML | xml.ts:172 |

### Collapse Functions (`collapse.ts`)

| Function | Signature | Description | Location |
|----------|-----------|-------------|----------|
| `getBlockId` | `(block: Block, index: number) => string` | Generate unique block identifier | collapse.ts:26 |
| `writeBlockFile` | `(block: Block, requestId: number, format: string) => BlockFile` | Create block file for export | collapse.ts:37 |
| `writeEntryFile` | `(entry: Entry, requestId: number, type: "sys"\|"tool", format: string) => EntryFile` | Create entry file for export | collapse.ts:51 |
| `collapseBlocksInEntry` | `(entry: Entry, requestId: number, collapseBlocks: BlockType[], format: string) => CollapsedEntry` | Collapse specified blocks in entry | collapse.ts:72 |
| `collapseConversation` | `(conversation: Conversation, requestId: number, options: CollapseOptions) => CollapsedConversation` | Collapse single conversation | collapse.ts:176 |
| `collapseConversations` | `(conversations: Record<number, Conversation>, options: CollapseOptions) => CollapsedExport` | Collapse conversations map | collapse.ts:225 |
| `collapseDelta` | `(delta: Delta, requestId: number, options: CollapseOptions) => CollapsedDelta` | Collapse single delta | collapse.ts:317 |
| `collapseDeltas` | `(deltas: Record<number, Delta>, options: CollapseOptions) => CollapsedExport` | Collapse deltas map | collapse.ts:354 |

---

## Type Definitions

### CollapseOptions (collapse.ts:5-9)

```typescript
interface CollapseOptions {
  collapse?: ("sys" | "tool" | "msgs")[];  // Entry fields to collapse
  collapseBlocks?: BlockType[];              // Block types to collapse
  format?: "json" | "xml";                   // Output format
}
```

### CollapsedExport (collapse.ts:11-14)

```typescript
interface CollapsedExport {
  main: string;                    // Main document content
  blocks: Map<string, string>;      // Collapsed block files (path -> content)
}
```

### CollapsedConversation (collapse.ts:107-110)

```typescript
interface CollapsedConversation {
  conversation: Conversation;      // Collapsed conversation
  files: Map<string, string>;       // Extracted files
}
```

### CollapsedDelta (collapse.ts:312-315)

```typescript
interface CollapsedDelta {
  delta: Delta;                     // Collapsed delta
  files: Map<string, string>;       // Extracted files
}
```

### BlockFile & EntryFile (collapse.ts:16-24)

```typescript
interface BlockFile {
  refPath: string;    // Reference path (e.g., "blocks/req-1-tc-call123.xml")
  content: string;    // File content
}

interface EntryFile {
  refPath: string;    // Reference path (e.g., "blocks/req-1-sys.xml")
  content: string;    // File content
}
```

### XMLRef (collapse.ts:61-64)

```typescript
interface XMLRef {
  blockIndex: number;  // Index of block in entry
  refPath: string;     // Reference path for external file
}
```

### CollapsedEntry (collapse.ts:66-70)

```typescript
interface CollapsedEntry {
  entry: Entry;                   // Modified entry with collapsed blocks
  blockFiles: Map<string, string>; // Extracted block files
  xmlRefs: XMLRef[];              // XML reference markers
}
```

---

## Design Patterns

### 1. Strategy Pattern - Format Selection

**Location**: Throughout collapse.ts

The module supports multiple output formats (JSON/XML) through conditional logic:

```typescript
// collapse.ts:42-46
const content = format === "xml" 
  ? blockToXML(block, "")
  : JSON.stringify(block);
```

```typescript
// collapse.ts:89-94
if (format === "json") {
  newBlocks.push({ "$ref": blockFile.refPath } as unknown as Block);
} else {
  newBlocks.push(block);
  xmlRefs.push({ blockIndex: i, refPath: blockFile.refPath });
}
```

### 2. Builder Pattern - Collapsed Export

**Location**: `collapseConversations`, `collapseDeltas` (collapse.ts:225-248, 354-376)

The collapse functions build exports incrementally:

```typescript
export function collapseConversations(
  conversations: Record<number, Conversation>,
  options: CollapseOptions
): CollapsedExport {
  const blocks = new Map<string, string>();
  const collapsedMap: Record<number, Conversation> = {};

  for (const [requestId, conversation] of Object.entries(conversations)) {
    const result = collapseConversation(conversation, reqId, options);
    collapsedMap[reqId] = result.conversation;
    for (const [path, content] of result.files) {
      blocks.set(path, content);
    }
  }

  return { main, blocks };
}
```

### 3. Template Method - XML Generation

**Location**: `conversationBodyToXML`, `deltaToXML` (xml.ts:13-48, 115-139)

Private helper functions define the structure, with public functions filling in details:

```typescript
function conversationBodyToXML(conv: Conversation, baseIndent: string): string[] {
  const lines: string[] = [];
  lines.push(`${baseIndent}<provider>...`);
  // Add optional sections conditionally
  if (conv.sys) { /* ... */ }
  if (conv.tool) { /* ... */ }
  // ...
  return lines;
}
```

---

## Key Call Chains

### 1. Full Conversation Export

```
Viewer/CLI requests export
    ↓
format.collapseConversations(map, options)
    ↓
    ├─ For each conversation:
    │   └─ collapseConversation() → collapseEntryField() for sys/tool
    │       └─ writeEntryFile() → entryToXML() or JSON.stringify
    └─ conversationsMapToCollapsedXML() or JSON.stringify
```

### 2. Delta Export (Timeline)

```
Viewer/CLI requests delta export
    ↓
format.collapseDeltas(deltas, options)
    ↓
    ├─ For each delta:
    │   └─ collapseDelta() → collapseDeltaEntryField() for sys/tool
    │       └─ entryDeltaToXML() or JSON.stringify
    └─ deltasMapToCollapsedXML() or JSON.stringify
```

### 3. Single Entry Block Collapse

```
collapseBlocksInEntry(entry, requestId, blockTypes, format)
    ↓
    ├─ For each block:
    │   ├─ If block type in collapseBlocks:
    │   │   └─ writeBlockFile() → blockToXML() or JSON.stringify
    │   └─ Else: keep block inline
    └─ Return CollapsedEntry with refs
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Input Data Sources                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐   │
│  │ Conversation[]   │  │ SessionTimeline  │  │ Delta[]        │   │
│  │ (from parse)     │  │ (from query)     │  │ (from query)   │   │
│  └──────────────────┘  └──────────────────┘  └────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         M001.7-Format                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    collapse.ts                               │   │
│  │  ┌───────────────────┐    ┌────────────────────────────┐    │   │
│  │  │ CollapseOptions   │    │ Collapse Decision Logic    │    │   │
│  │  │ - collapse[]      │───▶│ - sys/tool/msgs extraction │    │   │
│  │  │ - collapseBlocks[]│    │ - block type filtering     │    │   │
│  │  │ - format          │    │ - ref path generation      │    │   │
│  │  └───────────────────┘    └────────────────────────────┘    │   │
│  │                                      │                       │   │
│  │                                      ▼                       │   │
│  │  ┌────────────────────────────────────────────────────┐    │   │
│  │  │              Block/Entry Extraction                │    │   │
│  │  │  writeBlockFile()  writeEntryFile()                │    │   │
│  │  └────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                     │
│                               ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                       xml.ts                                 │   │
│  │  ┌───────────────────────────────────────────────────────┐   │   │
│  │  │              XML Serialization                         │   │   │
│  │  │  escapeXML() → blockToXML() → entryToXML()             │   │   │
│  │  │           → conversationToXML() → conversationsMap...  │   │   │
│  │  │           → entryDeltaToXML() → timelineToXML()       │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                     │
│                               ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Output Types                              │   │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐     │   │
│  │  │ CollapsedExport │    │   CollapsedConversation     │     │   │
│  │  │ - main: string  │    │   CollapsedDelta            │     │   │
│  │  │ - blocks: Map   │    │                             │     │   │
│  │  └─────────────────┘    └─────────────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Output Consumers                            │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │ ZIP Export       │  │ Web Viewer       │                        │
│  │ (store module)   │  │ (viewer package) │                        │
│  └──────────────────┘  └──────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## XML Output Examples

### Conversation XML Structure

```xml
<conversation>
  <provider>openai</provider>
  <model>gpt-4</model>
  <sys>
    <entry id="sys-1">
      <blocks>
        <block type="text">You are a helpful assistant.</block>
      </blocks>
    </entry>
  </sys>
  <msgs>
    <entry id="msg-1" role="user">
      <blocks>
        <block type="text">Hello!</block>
      </blocks>
    </entry>
    <entry id="msg-2" role="assistant">
      <blocks>
        <block type="thinking">Let me think...</block>
        <block type="text">Hi there!</block>
      </blocks>
    </entry>
  </msgs>
  <usage>
    <inputMissTokens>0</inputMissTokens>
    <inputHitTokens>100</inputHitTokens>
    <outputTokens>50</outputTokens>
  </usage>
</conversation>
```

### Collapsed XML with References

```xml
<conversations>
  <conversation reqId="1">
    <provider>openai</provider>
    <sys ref="blocks/req-1-sys.xml"/>
    <tool ref="blocks/req-1-tool.xml"/>
    <msgs>
      <entry id="msg-1" role="user">...</entry>
    </msgs>
  </conversation>
</conversations>
```

### Timeline XML Structure

```xml
<timeline>
  <sessionId>session-abc123</sessionId>
  <totalRequests>5</totalRequests>
  <changes>
    <change requestId="1">
      <delta>
        <msgs>
          <entryDelta id="msg-1">
            <added>
              <block type="text">Hello!</block>
            </added>
          </entryDelta>
        </msgs>
      </delta>
    </change>
  </changes>
</timeline>
```

---

## Quality Assessment

### Code Smells Identified

| Issue | Location | Severity | Recommendation |
|-------|----------|----------|----------------|
| Type casting with `as unknown as` | collapse.ts:90, 128, 151, etc. | Medium | Use proper type guards or refactored types |
| Duplicated collapse logic | collapse.ts:112-174 | Low | Extract common collapse helper |
| Large function | collapse.ts:176-223 | Low | Consider splitting collapseConversation |
| Magic strings | collapse.ts:43 (file extensions) | Low | Define constants |

### Test Coverage

Test files:
- `format/xml.test.ts` - XML conversion tests
- `format/collapse.test.ts` - Collapse functionality tests

### Dependencies

| Dependency | Purpose | Type |
|------------|---------|------|
| `../parse/types.js` | Block, Entry, Conversation types | Internal |
| `../query/types.js` | Delta, EntryDelta, SessionTimeline types | Internal |

---

## Risk Assessment

| Risk | Description | Mitigation |
|------|-------------|------------|
| Memory Usage | Large conversations loaded entirely in memory | Caller should chunk large exports |
| XML Injection | User content not escaped could break XML | `escapeXML()` handles all special chars |
| Path Collision | Generated ref paths could collide | Uses requestId and unique block IDs |
| Type Safety | Heavy use of `as unknown as` casts | Runtime validation in callers |

---

## Recommendations

1. **Improve Type Safety**: Replace `as unknown as` casts with proper type definitions or union types that include `$ref` and `_xmlRef` properties.

2. **Extract Common Collapse Logic**: The `collapseEntryField` and `collapseDeltaEntryField` functions share similar patterns - consider a generic helper.

3. **Add Streaming Support**: For very large exports, consider adding streaming variants that don't require loading all data in memory.

4. **Path Generation Configuration**: Allow custom path generation strategies for block files instead of hardcoded `blocks/req-X-type.xml` pattern.

5. **Document Block Type Semantics**: Add documentation explaining when each block type (text, thinking, td, tc, tr, image, other) is used and how they should be rendered.

---

## Conclusion

M001.7-Format is a focused business-layer module that provides essential export functionality for the opencode-trace system. Its key features include:

- **Dual Format Support**: Both XML and JSON output with consistent reference patterns
- **Intelligent Collapsing**: Extracts large blocks/entries to separate files for manageable exports
- **Full and Delta Exports**: Supports both complete conversation snapshots and incremental change exports
- **Clean Public API**: Simple functions with configurable options

The module successfully separates serialization concerns from the core parsing and querying logic, making it easy to add new output formats or modify export strategies without affecting other parts of the system.
