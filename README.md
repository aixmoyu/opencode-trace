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
# Install OpenCode plugin (automatic tracing)
opencode plugin -g @opencode-trace/plugin

# Start Web Viewer (automatically opens browser)
npx -y @opencode-trace/viewer@latest


```

## Installation

### Plugin (Recommended)

After installing the OpenCode plugin, all conversations are automatically traced to `~/.opencode-trace`:

```bash
opencode plugin -g @opencode-trace/plugin
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

### Trace Control (Slash Commands)

In OpenCode, use `/trace` commands to control recording. These are **user-facing slash commands**:

```bash
/trace on                     # Enable globally (default)
/trace on -g                  # Enable globally
/trace on -l                  # Enable locally (this project folder)
/trace on -s                  # Enable for current session only
/trace on -g -l               # Enable global + local
/trace on -d local            # Enable globally, save to local directory
/trace on -s -d local         # Enable session, save locally

/trace off                    # Disable globally
/trace off -l                 # Disable locally
/trace off -s                 # Disable for current session
/trace off -g -l -s           # Disable all scopes

/trace status                 # Show all scope statuses
/trace help                   # Show help
```

### Trace Control (Agent Tools)

The plugin registers three tools for AI agents to control tracing programmatically.
Agent tools only operate at the **session** level:

| Tool | Description | Parameters |
|------|-------------|------------|
| `trace_on` | Enable trace recording for current session | (none) |
| `trace_off` | Disable trace recording for current session | (none) |
| `trace_status` | Show current trace status | (none) |

### Scope & Storage Model

**Scope** controls *whether* tracing is enabled. Three independent scopes:

| Scope | Config Location | Description |
|-------|----------------|-------------|
| `global` | `~/.opencode-trace/config.json` | All projects, all sessions |
| `local` | `<project>/.opencode-trace/config.json` | This project folder only |
| `session` | Session metadata | Current session only |

**Enable resolution** (largest scope wins):
```
global ON  →  tracing is ON (regardless of local/session)
global OFF →  check local
  local ON  →  tracing is ON
  local OFF →  check session
    session ON  →  tracing is ON
    session OFF →  tracing is OFF
```

**Storage** controls *where* traces are saved:

| Storage | Path | Description |
|---------|------|-------------|
| `global` | `~/.opencode-trace/` | User home directory (default) |
| `local` | `<project>/.opencode-trace/` | Project directory |

**Storage resolution** (smallest scope wins):
```
session has preference  →  use session preference
session has no preference →  use global preference (default: global)
```

### CLI Commands

```bash
# Trace control
opencode-trace enable                    # Enable global tracing
opencode-trace enable -g                 # Enable global tracing
opencode-trace enable -l                 # Enable local tracing
opencode-trace enable -s <id>            # Enable tracing for specific session
opencode-trace enable -g -l              # Enable global + local
opencode-trace enable -d local           # Enable globally, save locally
opencode-trace disable                   # Disable global tracing
opencode-trace disable -l                # Disable local tracing
opencode-trace disable -s <id>           # Disable tracing for specific session
opencode-trace disable -g -l -s <id>     # Disable all scopes
opencode-trace status                    # View global tracing status
opencode-trace status -g -l -s <id>      # View all scope statuses

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

Tracing data is stored in two possible locations:

**Global directory** (`~/.opencode-trace/`):
```
~/.opencode-trace/
├── config.json              # Global state (scope enable, storage preference)
├── <session-id>/            # Session directory
│   ├── 1.json               # 1st request record
│   ├── 1.sse                # SSE stream data (if any)
│   ├── 2.json               # 2nd request record
│   ├── metadata.json        # Session metadata (title, parent-child, trace_enabled, storage_preference)
```

**Local directory** (`<project>/.opencode-trace/`):
```
<project>/.opencode-trace/
├── config.json              # Local state (scope enable)
├── <session-id>/            # Session directory (same structure as global)
```

### API Usage (Development Integration)

```typescript
import {
  store,    // Data persistence (listSessions, exportSessionZip)
  parse,    // AI Provider parsing (detectAndParse)
  query,    // Query building (buildSessionTimeline)
  record,   // Recording control (enable, disable, scope, storage)
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