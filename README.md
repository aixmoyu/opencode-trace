# opencode-trace

A tool suite for tracing OpenCode AI interactions, helping debug conversations, analyze costs, and replay history.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@opencode-trace/core)](https://www.npmjs.com/package/@opencode-trace/core)

## About

opencode-trace automatically records every interaction between OpenCode and AI Providers (OpenAI, Anthropic), including complete request/response, token usage, latency metrics, etc. Supports multiple usage modes:

- **Plugin mode**: Automatic tracing, no manual operation required
- **Web Viewer**: Visualize conversation history, token statistics, timeline
- **CLI tool**: Command-line management, export, query

## Features

- Automatically intercepts HTTP requests, records complete API interactions
- Supports OpenAI Chat Completions, Responses API, Anthropic Messages API
- Real-time Web Viewer for conversation history and statistics
- Supports session parent-child relationships (Task tool creates sub-sessions)
- Export/import ZIP format for easy migration and backup
- SQLite + filesystem dual storage with graceful degradation

## Quick Start

No installation required, use directly:

```bash
# Start Web Viewer (automatically opens browser)
npx -y @opencode-trace/viewer@latest

# View CLI help
npx -y @opencode-trace/cli@latest -h

# Install OpenCode plugin (automatic tracing)
opencode plugin @opencode-trace/plugin
```

## Installation

### Plugin (Recommended)

After installing the OpenCode plugin, all conversations are automatically traced to `~/.opencode-trace`:

```bash
opencode plugin @opencode-trace/plugin
```

Or add in OpenCode configuration file:

```json
{
  "plugin": ["@opencode-trace/plugin"]
}
```

### CLI (Optional)

```bash
# Global install
npm install -g @opencode-trace/cli

# Or use npx (no installation required)
npx @opencode-trace/cli <command>
```

### Viewer (Optional)

```bash
# Global install
npm install -g @opencode-trace/viewer

# Or use npx (no installation required)
npx @opencode-trace/viewer
```

## Usage

### CLI Commands

```bash
# Trace control
opencode-trace enable              # Enable global tracing
opencode-trace enable -s <id>      # Enable tracing for specific session
opencode-trace disable             # Disable global tracing
opencode-trace disable -s <id>     # Disable tracing for specific session
opencode-trace status              # View tracing status
opencode-trace status -s <id>      # View status for specific session

# Session management
opencode-trace list                # List all sessions
opencode-trace sync                # Sync SQLite with filesystem
opencode-trace sync --repair       # Rebuild corrupted state.db

# Data viewing
opencode-trace show <id> metadata                    # Show session metadata
opencode-trace show <id> conversation                # Show last conversation
opencode-trace show <id> conversation -r 1:3         # Show conversation for requests 1-3
opencode-trace show <id> conversation --format xml   # XML format output
opencode-trace show <id> changes                     # Show all request changes
opencode-trace show <id> changes -r 1:5              # Show changes for requests 1-5

# Data export
opencode-trace export <id> -t raw -o ./output        # Export ZIP
opencode-trace export <id> -t conversation -o ./out  # Export conversation JSON
opencode-trace export <id> -t changes -o ./out       # Export changes JSON
opencode-trace export <id> -t metadata -o ./out      # Export metadata
opencode-trace export <id> -t conversation --format xml -o ./out  # XML format
opencode-trace export <id> -t conversation --collapse sys,tool,msgs  # Collapse output

# Start Viewer
opencode-trace viewer              # Start Web Viewer
opencode-trace viewer --port 8080  # Specify port
opencode-trace viewer --no-open    # Don't auto-open browser
```

### Web Viewer

Start Viewer standalone:

```bash
npx @opencode-trace/viewer
# Or (if globally installed)
opencode-trace-viewer
# Or (via CLI)
opencode-trace viewer
```

Viewer features:
- Session list (supports tree view)
- Timeline view (changes between requests)
- Token usage statistics (total tokens, input/output)
- Latency metrics (TTFT, TPOT)
- Export/import ZIP
- Enable/disable tracing

### Data Storage

Tracing data is stored in `~/.opencode-trace/`:

```
~/.opencode-trace/
├── <session-id>/          # Session directory
│   ├── 1.json             # 1st request record
│   ├── 1.sse              # SSE stream data (if any)
│   ├── 2.json             # 2nd request record
│   ├── metadata.json      # Session metadata (title, parent-child relationship)
├── state.db               # SQLite state database
```

### API Usage (Development Integration)

```typescript
import {
  store,    // Data persistence (listSessions, exportSessionZip)
  parse,    // AI Provider parsing (detectAndParse)
  query,    // Query building (buildSessionTimeline)
  record,   // Recording control (enable, disable)
  state,    // State management (StateManager)
  format,   // Format export (formatAsXML)
  schemas,  // Zod Schema (TraceRecordSchema)
} from '@opencode-trace/core';

// List sessions
const sessions = store.listSessions();

// Parse record
const parsed = parse.detectAndParse(record);

// Build timeline
const timeline = query.buildSessionTimeline(sessionId, parsedRecords);
```

## Architecture

```
packages/
├── core/        # Core functionality (parse, store, query, record, state, format)
├── cli/         # Command-line tool (bin: opencode-trace)
├── plugin/      # OpenCode plugin (intercepts fetch)
├── viewer/      # Web Viewer (bin: opencode-trace-viewer)
```

Core data flow:

```
HTTP Request → Plugin intercepts → Core-Parse parses → Core-Store stores → Core-Query queries → Viewer/CLI displays
```

## Packages

| Package | Description | Bin |
|---------|-------------|-----|
| [@opencode-trace/core](packages/core) | Core functionality: parsing, storage, query | - |
| [@opencode-trace/cli](packages/cli) | Command-line tool | `opencode-trace` |
| [@opencode-trace/plugin](packages/plugin) | OpenCode plugin | - |
| [@opencode-trace/viewer](packages/viewer) | Web viewer | `opencode-trace-viewer` |

## Development

```bash
# Clone project
git clone https://github.com/aixmoyu/opencode-trace.git
cd opencode-trace

# Install dependencies
npm install

# Build
npm run build

# Test
npm run test

# Development mode (Watch + Viewer)
npm run dev
```

## Contributing

Contributions welcome! Please submit Issues or Pull Requests.

Issue feedback: https://github.com/aixmoyu/opencode-trace/issues

## License

MIT License. See [LICENSE](LICENSE) for details.