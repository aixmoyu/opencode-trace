# @opencode-trace/core

opencode-trace core functionality package, providing AI interaction data parsing, storage, query, state management, and more.

## Installation

```bash
npm install @opencode-trace/core
```

## Features

- **parse** — AI Provider parsers (OpenAI Chat/Responses, Anthropic)
- **store** — Data persistence (file read/write, SQLite state)
- **query** — Query building (Timeline, token statistics, latency metrics)
- **record** — Recording control (global/session switches)
- **state** — State management (StateManager class)
- **format** — Format export (XML, Collapse)
- **schemas** — Zod Schema definitions
- **transform** — SSE stream parsing

## Usage

### Namespace Imports

```typescript
import {
  store,    // Data persistence
  parse,    // AI Provider parsing
  transform, // SSE stream transformation
  query,    // Query building
  record,   // Recording control
  state,    // State management
  format,   // Format export
  schemas,  // Zod Schema
  logger,   // Logging utility
} from '@opencode-trace/core';
```

### Store API

```typescript
import { store } from '@opencode-trace/core';

// List sessions
const sessions = store.listSessions();
// → SessionMeta[] (sorted by time descending)

// List in tree structure
const tree = store.listSessionsTree();
// → SessionTreeNode[] (with children)

// Get session records
const records = store.getSessionRecords('session-123');
// → TraceRecord[]

// Export session (ZIP)
const zipStream = await store.exportSessionZip('session-123');

// Import session
const result = await store.importSessionZip(buffer, { conflictStrategy: 'rename' });
// → ImportResult

// Delete session
await store.deleteSession('session-123');
```

### Parse API

```typescript
import { parse } from '@opencode-trace/core';

// Auto-detect Provider and parse
const parsed = parse.detectAndParse(record);
// → { provider: 'openai-chat' | 'anthropic', conversation: Conversation }

// Conversation structure
parsed.conversation.messages  // Entry[]
parsed.conversation.blocks    // Block[]
parsed.conversation.usage     // Usage (token statistics)
```

### Query API

```typescript
import { query } from '@opencode-trace/core';

// Build session Timeline
const timeline = query.buildSessionTimeline('session-123', parsedRecords);
// → SessionTimeline (with changes, meta)

// Build session metadata statistics
const meta = query.buildSessionMetadata('session-123', parsedRecords);
// → SessionMetadata (token statistics, latency metrics)
```

### Record API

```typescript
import { record } from '@opencode-trace/core';

// Enable global tracing
record.setGlobalTraceEnabled(true);

// Check if should record
const should = record.shouldRecord('session-123');
// → boolean (global switch + session switch)

// List active recordings
const recordings = record.listRecordings();
// → RecordingStatus[]
```

### State API

```typescript
import { state } from '@opencode-trace/core';

// Create StateManager
const manager = new state.StateManager('/path/to/trace/dir');
await manager.init();

// Session management
const sessionId = manager.startSession();
manager.stopSession(sessionId);
manager.updateSessionMetadata(sessionId, { title: 'My Session' });

// Global state
manager.setGlobalState('global_trace_enabled', 'true');
const enabled = manager.getGlobalState('global_trace_enabled');

// Token statistics
manager.setGlobalState('total_tokens_used', '12345');
```

### Format API

```typescript
import { format } from '@opencode-trace/core';

// Format as XML
const xml = format.formatAsXML(parsedRecords);

// Collapse export (compressed format)
const collapsed = format.collapseConversations(parsedRecords);
```

### Schemas API

```typescript
import { schemas } from '@opencode-trace/core';

// Validate TraceRecord
const valid = schemas.TraceRecordSchema.safeParse(data);

// Validate SessionMetadata
const metaValid = schemas.SessionMetadataFileSchema.safeParse(meta);
```

## Types

Main type definitions:

```typescript
// TraceRecord — Single request record
interface TraceRecord {
  id: number;
  purpose: string;
  requestAt: string;
  responseAt: string;
  request: TraceRequest;
  response: TraceResponse | null;
  error: { message: string; stack?: string } | null;
}

// SessionMeta — Session metadata
interface SessionMeta {
  id: string;
  requestCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  title?: string;
  parentID?: string;
  subSessions?: string[];
}

// Conversation — Parsed conversation
interface Conversation {
  provider: string;
  messages: Entry[];
  blocks: Block[];
  usage?: Usage;
}
```

## License

MIT