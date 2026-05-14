# @opencode-trace/plugin

OpenCode plugin for automatically tracing AI API interactions.

[![npm version](https://img.shields.io/npm/v/@opencode-trace/plugin)](https://www.npmjs.com/package/@opencode-trace/plugin)

## Installation

Install OpenCode plugin:

```bash
opencode plugin @opencode-trace/plugin
```

Or add in OpenCode configuration file (`opencode.json`):

```json
{
  "plugin": ["@opencode-trace/plugin"]
}
```

## Usage

After installation, the plugin automatically intercepts all HTTP requests from OpenCode and records them to `~/.opencode-trace/`.

No manual operation required, every interaction with AI is automatically traced.

### Tracing Content

- Complete request (URL, Headers, Body)
- Complete response (Status, Headers, Body)
- SSE stream data (incremental tokens)
- Token usage statistics (input/output)
- Latency metrics (first token latency TTFT, token interval TPOT)
- Error information (failed requests)

### Supported APIs

- OpenAI Chat Completions API
- OpenAI Responses API (new format)
- Anthropic Messages API

### Trace Control

Control tracing via CLI or Viewer:

```bash
# CLI
opencode-trace enable              # Enable global tracing
opencode-trace disable             # Disable global tracing
opencode-trace status              # View status

# Or use Viewer web interface
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENCODE_TRACE_DIR` | Custom trace directory (default `~/.opencode-trace`) |
| `OPENCODE_TRACE_REDACT` | Whether to redact sensitive information (default `true`) |

### Redaction Rules

The plugin automatically redacts the following sensitive information:

- HTTP Headers: `authorization`, `api-key`, `x-api-key`, etc.
- Stack traces: user paths, IP addresses, ports

Can disable redaction via `OPENCODE_TRACE_REDACT=false`.

## Data Storage

Trace data storage structure:

```
~/.opencode-trace/
├── <session-id>/          # Session directory
│   ├── 1.json             # 1st request record
│   ├── 1.sse              # SSE stream data
│   ├── 2.json             # 2nd request record
│   ├── metadata.json      # Session metadata
├── state.db               # SQLite state database
```

## Tools

The plugin provides the following OpenCode tools:

| Tool | Description |
|------|-------------|
| `trace_enable` | Enable tracing |
| `trace_disable` | Disable tracing |
| `trace_status` | View tracing status |

Can be called directly in conversation:

```
User: Please enable tracing
AI: [calls trace_enable tool] Tracing enabled
```

## Troubleshooting

### Tracing Not Working

1. Confirm plugin installed: check `opencode.json` configuration
2. Confirm tracing enabled: run `opencode-trace status`
3. Check directory permissions: ensure `~/.opencode-trace` is writable

### SQLite Corrupted

Run repair command:

```bash
opencode-trace sync --repair
```

## License

MIT