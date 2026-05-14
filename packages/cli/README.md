# @opencode-trace/cli

opencode-trace command-line tool, providing trace data management, query, and export functionality.

[![npm version](https://img.shields.io/npm/v/@opencode-trace/cli)](https://www.npmjs.com/package/@opencode-trace/cli)

## Installation

```bash
# Global install
npm install -g @opencode-trace/cli

# Or use npx (no installation required)
npx @opencode-trace/cli <command>
```

## Usage

```bash
opencode-trace <command> [options]
```

### Commands

#### Trace Control

```bash
opencode-trace enable              # Enable global tracing
opencode-trace enable -s <id>      # Enable tracing for specific session
opencode-trace disable             # Disable global tracing
opencode-trace disable -s <id>     # Disable tracing for specific session
opencode-trace status              # View global tracing status
opencode-trace status -s <id>      # View status for specific session
```

#### Session Management

```bash
opencode-trace list                # List all sessions
opencode-trace sync                # Sync SQLite with filesystem
opencode-trace sync --repair       # Rebuild corrupted state.db
```

#### Data Viewing

```bash
# Show session metadata (Token statistics, latency metrics)
opencode-trace show <id> metadata

# Show conversation content
opencode-trace show <id> conversation                # Last conversation
opencode-trace show <id> conversation -r 1:3         # Conversation for requests 1-3
opencode-trace show <id> conversation -r 1           # Conversation from request 1 to last
opencode-trace show <id> conversation --format xml   # XML format
opencode-trace show <id> conversation --compact      # Compact output

# Show request changes (added/deleted messages and Blocks)
opencode-trace show <id> changes                     # All request changes
opencode-trace show <id> changes -r 1:5              # Changes for requests 1-5
opencode-trace show <id> changes --format xml        # XML format
```

#### Data Export

```bash
# Export raw data (ZIP format)
opencode-trace export <id> -t raw -o ./output

# Export conversation content
opencode-trace export <id> -t conversation -o ./output
opencode-trace export <id> -t conversation --format xml -o ./output

# Export change analysis
opencode-trace export <id> -t changes -o ./output

# Export metadata
opencode-trace export <id> -t metadata -o ./output

# Collapse options (simplified output)
opencode-trace export <id> -t conversation --collapse sys,tool,msgs -o ./output
opencode-trace export <id> -t conversation --collapse-blocks text,thinking -o ./output
```

#### Start Viewer

```bash
opencode-trace viewer              # Start Web Viewer (default port 3000)
opencode-trace viewer --port 8080  # Specify port
opencode-trace viewer --no-open    # Don't auto-open browser
```

### Options

| Option | Description |
|--------|-------------|
| `-s, --session <id>` | Specify session ID |
| `-r, --range <range>` | Request range (e.g., `1:3` or `1`) |
| `--format <json|xml>` | Output format |
| `--compact` | Compact JSON output |
| `-t, --type <type>` | Export type (raw/conversation/changes/metadata) |
| `-o, --output <path>` | Output directory |
| `--collapse <items>` | Collapse items (sys,tool,msgs) |
| `--collapse-blocks <types>` | Collapse Block types (text,thinking,td,tc,tr,image,other) |
| `--port <num>` | Viewer port |
| `--no-open` | Don't auto-open browser |
| `--repair` | Rebuild corrupted database |

## Examples

```bash
# Quickly view recent sessions
opencode-trace list

# View session details
opencode-trace show session-abc123 metadata

# Export session as ZIP
opencode-trace export session-abc123 -t raw -o ./export

# Start Viewer to view
opencode-trace viewer
```

## License

MIT