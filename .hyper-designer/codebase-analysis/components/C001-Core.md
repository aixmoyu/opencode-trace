# M001-Core Module Detail Analysis

## Module Overview

| Property | Value |
|----------|-------|
| **Module ID** | M001 |
| **Module Name** | Core |
| **Module Path** | packages/core/src/ |
| **Priority** | High |
| **Layer** | Infrastructure + Domain + Business (跨三层) |
| **Depends on** | M001.1-Store, M001.2-Parse, M001.3-Transform, M001.4-Query, M001.5-Record, M001.6-State, M001.7-Format, M001.8-Schemas |
| **Depended on by** | M002-CLI, M003-Plugin, M004-Viewer |

### Summary

The Core module is the foundational package of the opencode-trace system, providing the complete infrastructure for recording, parsing, storing, and analyzing AI API trace data. It serves as the central library that all other packages (CLI, Plugin, Viewer) depend upon. The module implements a multi-provider parsing system supporting OpenAI Chat API, OpenAI Responses API, and Anthropic Messages API, with SQLite-based state management and comprehensive XML/JSON formatting capabilities.

---

## File Structure

```
packages/core/src/
├── index.ts              # Entry point - namespace exports
├── types.ts              # Core type definitions (TraceRequest, TraceRecord, etc.)
├── logger.ts             # Winston-based logging utility
├── store/
│   └── index.ts          # File system storage operations (540 lines)
├── parse/
│   ├── index.ts          # Parser exports and utilities
│   ├── types.ts          # Block, Entry, Conversation types
│   ├── detect.ts         # Provider detection and parsing logic
│   ├── utils.ts          # Block/Entry creation utilities
│   ├── registry.ts       # Parser registration (Strategy pattern)
│   ├── openai-chat.ts    # OpenAI Chat API parser (215 lines)
│   ├── openai-responses.ts # OpenAI Responses API parser (253 lines)
│   └── anthropic.ts      # Anthropic Messages API parser (185 lines)
├── transform/
│   ├── index.ts          # SSE transformation exports
│   ├── sse.ts            # SSE event parsing (65 lines)
├── query/
│   ├── index.ts          # Query exports
│   ├── types.ts          # Timeline and metadata types
│   ├── session.ts        # Timeline building logic (268 lines)
├── record/
│   ├── index.ts          # Recording exports
│   ├── control.ts        # Recording control logic (202 lines)
├── state/
│   ├── index.ts          # StateManager class (596 lines)
├── format/
│   ├── index.ts          # Format exports
│   ├── xml.ts            # XML conversion (184 lines)
│   ├── collapse.ts       # Collapsed export generation (427 lines)
├── schemas/
│   ├── index.ts          # Schema exports
│   ├── types.ts          # TraceRecord Zod schema
│   ├── parse-types.ts    # Block/Conversation Zod schemas
│   ├── query-types.ts    # Timeline Zod schemas
│   ├── store-types.ts    # Session Zod schemas
```

**Total Source Lines**: ~2,500+ (excluding tests)

---

## Public Interface Analysis

### Entry File: `src/index.ts`

```typescript
// packages/core/src/index.ts:1-18
export * as store from "./store/index.js";
export * as parse from "./parse/index.js";
export * as transform from "./transform/index.js";
export * as query from "./query/index.js";
export * as record from "./record/index.js";
export * as state from "./state/index.js";
export * as format from "./format/index.js";
export * as schemas from "./schemas/index.js";
export { logger } from "./logger.js";

export type {
  TraceRequest,
  TraceResponse,
  TraceError,
  TraceRecord,
} from "./types.js";

export type { BlockType } from "./parse/types.js";
```

### Namespace: `store`

| Function | Signature | Description | Location |
|----------|-----------|-------------|----------|
| `listSessions` | `(options?: StoreOptions) => SessionMeta[]` | List all sessions from trace directory | store/index.ts:88 |
| `listSessionsTree` | `(options?: StoreOptions) => SessionTreeNode[]` | List sessions as tree structure with parent-child relationships | store/index.ts:168 |
| `getSessionRecords` | `(sessionId: string, options?: StoreOptions) => TraceRecord[]` | Get all records for a session | store/index.ts:187 |
| `getRecord` | `(sessionId: string, recordId: number, options?: StoreOptions) => TraceRecord | null` | Get single record by ID | store/index.ts:221 |
| `getSSEStream` | `(sessionId: string, recordId: number, options?: StoreOptions) => string | null` | Get raw SSE stream data | store/index.ts:242 |
| `getTraceDir` | `(options?: StoreOptions) => string` | Get resolved trace directory path | store/index.ts:261 |
| `writeRecord` | `(sessionId: string, seq: number, record: TraceRecord, options?: StoreOptions) => Promise<void>` | Write a trace record to disk | store/index.ts:265 |
| `initStore` | `(options?: StoreOptions) => Promise<void>` | Initialize StateManager for store | store/index.ts:276 |
| `syncStore` | `(options?: StoreOptions) => void` | Sync SQLite state with filesystem | store/index.ts:281 |
| `exportSessionZip` | `(sessionId: string, options?: StoreOptions) => Promise<NodeJS.ReadableStream>` | Export session as ZIP archive | store/index.ts:347 |
| `importSessionZip` | `(zipBuffer: Buffer, options?: ImportOptions) => Promise<ImportResult>` | Import session from ZIP | store/index.ts:409 |
| `deleteSession` | `(sessionId: string, options?: StoreOptions) => Promise<void>` | Delete session and its sub-sessions | store/index.ts:518 |

### Namespace: `parse`

| Function/Type | Signature | Description | Location |
|---------------|-----------|-------------|----------|
| `openaiChatParser` | `Parser` | OpenAI Chat API parser instance | parse/index.ts:5 |
| `openaiResponsesParser` | `Parser` | OpenAI Responses API parser instance | parse/index.ts:6 |
| `anthropicParser` | `Parser` | Anthropic Messages API parser instance | parse/index.ts:7 |
| `detectAndParse` | `(record: TraceRecord) => Conversation` | Auto-detect provider and parse record | parse/detect.ts:49 |
| `detectProvider` | `(url: string, body: unknown) => string | null` | Detect provider from URL/body | parse/detect.ts:87 |
| `extractUsage` | `(record: TraceRecord) => Conversation["usage"]` | Extract token usage info | parse/detect.ts:92 |
| `extractLatency` | `(record: TraceRecord) => LatencyInfo | null` | Extract latency metrics | parse/detect.ts:123 |
| `BlockType` | `"text" | "thinking" | "td" | "tc" | "tr" | "image" | "other"` | Union type for block types | parse/types.ts:1 |

### Namespace: `transform`

| Function | Signature | Description | Location |
|----------|-----------|-------------|----------|
| `sseOpenaiChatToMessages` | `(raw: string) => Entry[]` | Convert OpenAI Chat SSE to messages | transform/index.ts:15 |
| `sseOpenaiChatParse` | `(raw: string) => SSEParseResult` | Parse OpenAI Chat SSE with usage | transform/index.ts:20 |
| `sseOpenaiResponsesToMessages` | `(raw: string) => Entry[]` | Convert OpenAI Responses SSE to messages | transform/index.ts:106 |
| `sseOpenaiResponsesParse` | `(raw: string) => SSEParseResult` | Parse OpenAI Responses SSE with usage | transform/index.ts:111 |
| `sseAnthropicToMessages` | `(raw: string) => Entry[]` | Convert Anthropic SSE to messages | transform/index.ts:225 |
| `sseAnthropicParse` | `(raw: string) => SSEParseResult` | Parse Anthropic SSE with usage | transform/index.ts:230 |
| `parseSSE` | `(raw: string) => SSEEvent[]` | Parse raw SSE text to events | transform/sse.ts:7 |

### Namespace: `query`

| Function | Signature | Description | Location |
|----------|-----------|-------------|----------|
| `diffConversations` | `(prev: Conversation, curr: Conversation, currRequestId: number, requestMsgs?: Entry[]) => RequestChange` | Compute delta between conversations | query/session.ts:31 |
| `buildSessionTimeline` | `(sessionId: string, records: TimelineRecord[]) => SessionTimeline` | Build complete session timeline | query/session.ts:136 |
| `buildSessionMetadata` | `(sessionId: string, records: {...}[], folderPath?: string) => SessionMetadata` | Build session statistics | query/session.ts:177 |

### Namespace: `record`

| Function | Signature | Description | Location |
|----------|-----------|-------------|----------|
| `startRecording` | `(sessionId?: string, traceDir?: string) => Promise<string>` | Start a recording session | record/control.ts:46 |
| `stopRecording` | `(sessionId: string, traceDir?: string) => boolean` | Stop a recording session | record/control.ts:52 |
| `isRecording` | `(sessionId: string, traceDir?: string) => boolean` | Check if session is recording | record/control.ts:119 |
| `getRecordingStatus` | `(sessionId: string, traceDir?: string) => RecordingStatus` | Get current recording status | record/control.ts:132 |
| `listRecordings` | `(traceDir?: string) => RecordingStatus[]` | List all active recordings | record/control.ts:161 |
| `initStateManager` | `(traceDir?: string) => Promise<void>` | Initialize state manager | record/control.ts:191 |
| `syncState` | `(traceDir?: string) => void` | Sync state with filesystem | record/control.ts:196 |
| `setGlobalTraceEnabled` | `(enabled: boolean, traceDir?: string) => void` | Enable/disable global tracing | record/control.ts:76 |
| `getGlobalTraceEnabled` | `(traceDir?: string) => boolean` | Get global trace enabled status | record/control.ts:84 |
| `shouldRecord` | `(sessionId?: string, traceDir?: string) => boolean` | Check if should record given session | record/control.ts:110 |

### Namespace: `state`

| Class/Interface | Description | Location |
|-----------------|-------------|----------|
| `StateManager` | SQLite-based state management class | state/index.ts:47-596 |
| `SessionState` | Interface for session state data | state/index.ts:9-20 |
| `SessionMetadata` | Interface for session metadata | state/index.ts:22-28 |

**StateManager Methods**:
- `init(): Promise<void>` - Initialize database (state/index.ts:62)
- `getGlobalState(key: string): string | null` - Get global state value (state/index.ts:239)
- `setGlobalState(key: string, value: string | null): void` - Set global state value (state/index.ts:247)
- `startSession(sessionId?: string): string` - Start new session (state/index.ts:255)
- `stopSession(sessionId: string): void` - Stop session (state/index.ts:276)
- `getSession(sessionId: string): SessionState | null` - Get session state (state/index.ts:290)
- `getActiveSession(): string | null` - Get current active session ID (state/index.ts:311)
- `writeRecord(sessionId: string, seq: number, record: TraceRecord): Promise<void>` - Write record to disk (state/index.ts:329)
- `sync(): void` - Sync SQLite with filesystem (state/index.ts:357)
- `listSessions(): SessionState[]` - List all sessions (state/index.ts:387)

### Namespace: `format`

| Function | Signature | Description | Location |
|----------|-----------|-------------|----------|
| `conversationToXML` | `(conv: Conversation) => string` | Convert conversation to XML | format/xml.ts:84 |
| `timelineToXML` | `(timeline: SessionTimeline) => string` | Convert timeline to XML | format/xml.ts:141 |
| `entryToXML` | `(entry: Entry, indent: string) => string` | Convert entry to XML | format/xml.ts:71 |
| `blockToXML` | `(block: Block, indent: string) => string` | Convert block to XML | format/xml.ts:50 |
| `collapseConversations` | `(conversations: Record<number, Conversation>, options: CollapseOptions) => CollapsedExport` | Collapse conversations for export | format/collapse.ts:225 |
| `collapseDeltas` | `(deltas: Record<number, Delta>, options: CollapseOptions) => CollapsedExport` | Collapse deltas for export | format/collapse.ts:354 |

### Namespace: `schemas`

Exported Zod schemas for runtime validation:
- `TraceRecordSchema` - validates trace records (schemas/types.ts:22)
- `BlockSchema` - validates block types (schemas/parse-types.ts:43)
- `EntrySchema` - validates entries (schemas/parse-types.ts:53)
- `ConversationSchema` - validates conversations (schemas/parse-types.ts:65)
- `SessionTimelineSchema` - validates timelines (schemas/query-types.ts:23)
- `SessionMetadataSchema` - validates session metadata (schemas/query-types.ts:50)

---

## Core Type Definitions

### TraceRecord (types.ts:20-31)

```typescript
interface TraceRecord {
  id: number;
  purpose: string;
  requestAt: string;
  responseAt: string;
  request: TraceRequest;
  response: TraceResponse | null;
  error: TraceError | null;
  requestSentAt?: number;   // Timestamp for latency tracking
  firstTokenAt?: number;    // First streaming token timestamp
  lastTokenAt?: number;     // Last streaming token timestamp
}
```

### Conversation (parse/types.ts:51-63)

```typescript
interface Conversation {
  provider: string;
  model: string | null;
  sys?: Entry;       // System message
  tool?: Entry;      // Tool definitions
  msgs: Entry[];     // User/Assistant messages
  usage: {
    inputMissTokens: number | null;
    inputHitTokens: number | null;   // Cache hit tokens
    outputTokens: number | null;
  } | null;
  stream: boolean;
}
```

### Block Union Type (parse/types.ts:43)

```typescript
type Block = TextBlock | ThinkingBlock | ToolDefinitionBlock | 
             ToolCallBlock | ToolResultBlock | ImageBlock | OtherBlock;

type BlockType = "text" | "thinking" | "td" | "tc" | "tr" | "image" | "other";
```

---

## Design Patterns

### 1. Strategy Pattern - Parser Registry

**Location**: `parse/registry.ts` + individual parser files

The module implements a Strategy pattern for multi-provider API parsing:

```typescript
// parse/registry.ts:1-18
const parsers: Parser[] = [];

export function registerParser(parser: Parser): void {
  if (parsers.some((p) => p.provider === parser.provider)) {
    throw new Error(`Parser already registered for provider: ${parser.provider}`);
  }
  parsers.push(parser);
}

export function getParsers(): Parser[] {
  return [...parsers];
}
```

**Parser Interface** (parse/types.ts:65-70):
```typescript
interface Parser {
  readonly provider: string;
  match(url: string, body: unknown): boolean;
  parseRequest(body: unknown): Conversation;
  parseResponse(body: unknown): Partial<Conversation>;
}
```

**Evidence**: Each parser (openai-chat.ts, openai-responses.ts, anthropic.ts) self-registers at module load:
```typescript
// parse/openai-chat.ts:214-215
import { registerParser } from "./registry.js";
registerParser(openaiChatParser);
```

### 2. Singleton Pattern - StateManager Cache

**Location**: `store/index.ts:58-69` and `record/control.ts:20-35`

```typescript
// store/index.ts:58-69
const managers = new Map<string, StateManager>();
const initPromises = new Map<string, Promise<void>>();

async function getManager(traceDir: string): Promise<StateManager> {
  if (!managers.has(traceDir)) {
    const manager = new StateManager(traceDir);
    managers.set(traceDir, manager);
    initPromises.set(traceDir, manager.init());
  }
  await initPromises.get(traceDir);
  return managers.get(traceDir)!;
}
```

This ensures a single StateManager instance per trace directory, with lazy initialization.

### 3. Facade Pattern - Namespace Exports

**Location**: `index.ts:1-18`

The main index.ts provides a facade over 8 sub-modules, exposing them as namespaces:

```typescript
export * as store from "./store/index.js";
export * as parse from "./parse/index.js";
export * as transform from "./transform/index.js";
export * as query from "./query/index.js";
export * as record from "./record/index.js";
export * as state from "./state/index.js";
export * as format from "./format/index.js";
export * as schemas from "./schemas/index.js";
```

### 4. Repository Pattern - StateManager

**Location**: `state/index.ts:47-596`

StateManager abstracts SQLite database operations, providing:
- Schema creation and migration
- CRUD operations for sessions and global state
- Filesystem fallback for session data
- Database persistence and recovery from corruption

### 5. Factory Pattern - Block/Entry Creation

**Location**: `parse/utils.ts:30-68`

Utility functions serve as factories for creating typed blocks:

```typescript
export function createTextBlock(text: string): Block
export function createThinkingBlock(thinking: string): Block
export function createToolCallBlock(id: string, name: string, args: string): Block
export function createToolResultBlock(toolCallId: string, content: string): Block
export function createMsgEntry(role: "user" | "assistant" | "tool", blocks: Block[]): Entry
```

---

## Key Call Chains

### 1. Trace Recording Flow

```
Plugin captures request/response
    ↓
record.startRecording() → StateManager.startSession()
    ↓
record.shouldRecord() → StateManager.isTraceEnabled()
    ↓
store.writeRecord() → StateManager.writeRecord()
    ↓
StateManager persists to filesystem + SQLite
```

### 2. Parsing Flow

```
store.getSessionRecords() → TraceRecord[]
    ↓
parse.detectAndParse(record) → Conversation
    ↓
    ├─ detectProvider() → find matching Parser
    ├─ Parser.parseRequest() → request Conversation
    ├─ transform SSE or Parser.parseResponse()
    └─ combine → final Conversation
```

### 3. Timeline Building Flow

```
TraceRecord[] with parsed Conversation[]
    ↓
query.buildSessionTimeline()
    ↓
    ├─ For each record:
    │   ├─ diffConversations(prev, curr) → RequestChange
    │   └─ accumulate changes
    └─ return SessionTimeline
```

### 4. Export Flow

```
SessionTimeline + Conversation map
    ↓
format.collapseConversations() → CollapsedExport
    ↓
    ├─ Collapse large blocks to separate files
    └─ format.conversationsMapToXML() or JSON.stringify
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External Consumers                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                          │
│  │   CLI    │  │  Plugin  │  │  Viewer  │                          │
│  └──────────┘  └──────────┘  └──────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           M001-Core                                 │
│                                                                     │
│  ┌─────────┐     ┌─────────┐     ┌───────────┐     ┌─────────┐     │
│  │ record  │────▶│  state  │────▶│   store   │────▶│schemas  │     │
│  │(control)│     │(Manager)│     │(fs ops)   │     │(zod)    │     │
│  └─────────┘     └─────────┘     └───────────┘     └─────────┘     │
│       │              │                  │                          │
│       ▼              ▼                  ▼                          │
│  ┌─────────┐     ┌─────────┐     ┌───────────┐                     │
│  │  parse  │────▶│transform│────▶│   query   │                     │
│  │(parsers)│     │(SSE)    │     │(timeline) │                     │
│  └─────────┘     └─────────┘     └───────────┘                     │
│       │                              │                             │
│       ▼                              ▼                             │
│  ┌─────────────────────────────────────────┐                       │
│  │              format (XML/JSON)           │                       │
│  └─────────────────────────────────────────┘                       │
│                                                                     │
│  ┌─────────────────────────────────────────┐                       │
│  │              logger (winston)            │                       │
│  └─────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Infrastructure                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                          │
│  │    FS    │  │  SQLite  │  │  Winston │                          │
│  │(node:fs) │  │ (sql.js) │  │ (logger) │                          │
│  └──────────┘  └──────────┘  └──────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quality Assessment

### Code Smells Identified

| Issue | Location | Severity | Recommendation |
|-------|----------|----------|----------------|
| SQL Injection Risk | state/index.ts:242-252 | Medium | Use parameterized queries instead of string interpolation |
| Duplicate isRecord helper | Multiple files | Low | Extract to shared utility |
| Large class | state/index.ts:596 lines | Medium | Consider splitting StateManager into focused classes |
| Magic numbers | parse/utils.ts:10-11 | Low | Document hash algorithm rationale |
| Type casting | format/collapse.ts:264, 386 | Low | Use proper type guards |

### Test Coverage

Test files are colocated with source:
- `types.test.ts` - Types module tests
- `store/index.test.ts` - Store operations tests
- `record/control.test.ts` - Recording control tests
- `parse/*.test.ts` - Parser tests (registry, detection)
- `state/state.test.ts` - StateManager tests
- `format/*.test.ts` - XML and collapse tests
- `schemas/schemas.test.ts` - Zod schema tests

### Dependencies

| Dependency | Purpose | Version |
|------------|---------|---------|
| `sql.js` | SQLite in-memory database | External |
| `winston` | Logging utility | External |
| `zod` | Runtime type validation | External |
| `archiver` | ZIP archive creation | External (store) |
| `adm-zip` | ZIP extraction | External (store) |

---

## Risk Assessment

| Risk | Description | Mitigation |
|------|-------------|------------|
| Database Corruption | SQLite file corruption from crashes | state/index.ts:146-163 handles corruption recovery |
| Provider Mismatch | New API format not parsed correctly | Fallback parsing in detect.ts:11-37 |
| State Sync | SQLite vs filesystem inconsistency | sync() method reconciles differences |
| Memory Usage | Large SSE streams in memory | Stream processing recommended for large data |

---

## Recommendations

1. **Add Parameterized Queries**: Replace string interpolation in StateManager SQL operations to prevent potential injection issues.

2. **Extract Common Utilities**: The `isRecord` helper function appears in 6+ files - should be extracted to a shared utility module.

3. **Consider Stream Processing**: For large SSE responses, implement streaming parsing to reduce memory pressure.

4. **Add Provider Extensibility**: Allow runtime registration of custom parsers without modifying core files.

5. **Document Block Types**: Add documentation explaining the semantic meaning of each BlockType and when each is used.

---

## Conclusion

M001-Core is a well-structured, foundational module implementing:
- **Infrastructure Layer**: SQLite state management, filesystem operations, logging
- **Domain Layer**: TraceRecord, Conversation, Block types with Zod validation
- **Business Layer**: Recording control, timeline analysis, export formatting

The module successfully serves as the backbone for the entire opencode-trace system, with clear separation of concerns across 8 sub-modules. The Strategy pattern for parsers enables easy provider extensibility, while the Repository pattern (StateManager) abstracts persistence complexity.
