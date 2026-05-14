# @opencode-trace/viewer

opencode-trace Web viewer for visualizing AI session trace data.

[![npm version](https://img.shields.io/npm/v/@opencode-trace/viewer)](https://www.npmjs.com/package/@opencode-trace/viewer)

## Installation

```bash
# Global install
npm install -g @opencode-trace/viewer

# Or use npx (no installation required)
npx @opencode-trace/viewer
```

## Usage

```bash
# Start Viewer
npx @opencode-trace/viewer

# Or (if globally installed)
opencode-trace-viewer

# Or (via CLI)
opencode-trace viewer
```

After starting, browser automatically opens (default http://localhost:3000).

### Options

| Option | Description |
|--------|-------------|
| `--port <num>` | Specify port (default 3000) |
| `--no-open` | Don't auto-open browser |

## Features

### Session Management

- Session list (supports tree view)
- Session search and filtering
- Session export/import (ZIP format)
- Session deletion (cascade delete sub-sessions)

### Timeline View

- Request sequence visualization
- Change comparison (added/deleted messages and Blocks)
- Token usage statistics (per request)
- Latency metrics (TTFT, TPOT)

### Record Details

- Complete request/response content
- Block classification (text, thinking, tool_call, image, etc.)
- SSE stream data display
- Error information display

### Trace Control

- Global trace switch
- Session-level trace switch
- Real-time status display

## API Endpoints

Viewer provides RESTful API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/sessions` | List sessions |
| `GET /api/sessions/tree` | Session tree |
| `GET /api/sessions/:id/timeline` | Timeline data |
| `GET /api/sessions/:id/metadata` | Session metadata |
| `GET /api/sessions/:id/records/:rid` | Record details |
| `POST /api/sessions/import` | Import ZIP |
| `GET /api/sessions/:id/export` | Export ZIP |
| `DELETE /api/sessions/:id` | Delete session |
| `POST /api/trace/enable` | Enable tracing |
| `POST /api/trace/disable` | Disable tracing |
| `GET /api/trace/status` | Trace status |

## Data Source

Viewer reads from `~/.opencode-trace/` directory by default.

Can specify custom directory via environment variable `OPENCODE_TRACE_DIR`.

## License

MIT