# AGENTS.md - OpenCode Trace

## Project Structure

Monorepo with npm workspaces + turbo, 4 packages under `packages/*`. Build order is managed by `tsc -b` via project references.

| Package | Purpose | Key Dependencies | Exports |
|---------|---------|------------------|---------|
| `@opencode-trace/core` | Core (parse, store, query, record, state, format, transform) | zod, winston | `.` + `./state` subpath |
| `@opencode-trace/cli` | CLI tool (`opencode-trace`) | core | `bin: opencode-trace` |
| `@opencode-trace/plugin` | OpenCode plugin (intercepts fetch) | @opencode-ai/plugin, core | plugin entry |
| `@opencode-trace/viewer` | Web viewer (`opencode-trace-viewer`) | fastify, vue, core | `bin: opencode-trace-viewer` |

Root `.opencode/opencode.json` loads `@opencode-trace/plugin`.

## Commands

```bash
npm run build           # turbo run build (dependsOn: ^build — core first)
npm run build:frontend  # turbo run build:frontend — Vite build for viewer Vue app
npm run test            # turbo run test (dependsOn: build — always builds first)
npm run clean           # turbo run clean (rm -rf dist *.tsbuildinfo)
npm run dev             # concurrently "tsc -b --watch" "nodemon viewer"
npm run cli             # node packages/cli/dist/index.js
npm run viewer          # node packages/viewer/dist/cli.js
npx tsc --noEmit        # type-check all packages (CI lint job)
```

## Testing

- Vitest, tests colocated: `packages/*/src/**/*.test.ts`
- Root vitest.config uses jsdom env (for Vue components) and excludes `dist/` + `src/viewer/frontend/`
- `packages/core/vitest.config.ts` sets `globals: true`
- Viewer uses `@vue/test-utils` for component tests
- Tests always run after build (turbo `dependsOn: ["build"]`)

## Build Quirks

- **Clean always** after stale builds: `rm -rf dist *.tsbuildinfo` — tsbuildinfo files cause `tsc -b` to skip rebuilding
- **Viewer build is two-phase**: `tsc` (server) → `npm run build:frontend` (Vite/vue → `dist/public/`)
- **Viewer tsconfig** excludes `src/frontend/` — the Vue app has its own Vite build
- **Publishing order** (CI): core → cli → plugin → viewer. Skips if version already published.
- No eslint, prettier, or formatter config exists in this repo.

## Windows CI Compatibility (IMPORTANT)

This project runs CI on both Linux and Windows. File system behavior differs significantly:

### MUST Follow
- **`fs.rename()` is NOT atomic on Windows (NTFS)**. Unlike POSIX, Windows rename can fail
  with `EACCES`/`EPERM` if the destination is locked (antivirus, delayed flush). All rename
  operations in this project use `safeRename()` with retry logic (3 retries, exponential backoff).
  NEVER use bare `fs.rename()` for `.tmp → final` atomic write patterns — always use `safeRename()`.
- **Test file polling MUST match assertion filters**. `waitForFiles()` and similar helpers must
  use the SAME file filter regex as the assertion (e.g. `/^\d+\.json$/`). Using `.endsWith(".json")`
  counts `metadata.json` and can cause early return with fewer record files than expected, especially
  on slow Windows CI where writes take longer.
- **Always flush before assertions**. After async writes, call `plugin.flush()` (or equivalent)
  before reading the filesystem. Windows I/O is slower and NTFS metadata caching means `readdirSync`
  may not immediately reflect completed writes.
- **Test timeouts on Windows need margin**. The default `waitForFiles` timeout (5s) is sufficient
  but tight on Windows CI. If tests become flaky, increase rather than decrease.

### MUST NOT Do
- **NEVER use bare `fs.rename()` for production write paths**. Always use `safeRename()` from
  `AsyncWriteQueue` which retries on Windows transient lock errors.
- **NEVER use `.endsWith(".json")` to count record files in tests**. This matches `metadata.json`,
  `config.json`, and other non-record files. Use `/^\d+\.json$/` or a specific regex.
- **NEVER assume file writes are immediately visible in directory listings on Windows**. Always
  flush the write queue and poll for file appearance before asserting file counts.

## Architecture Principles

### File System is Source of Truth
No database. All data lives in `~/.opencode-trace/` as files:
```
~/.opencode-trace/
├── config.json              # Global state (JSON, atomic writes via .tmp+rename)
├── <session-id>/            # Per-session directory
│   ├── {seq}.json           # Raw TraceRecord (source of truth)
│   ├── {seq}.sse            # Raw SSE stream (if streaming)
│   ├── {seq}.parsed         # Parsed conversation cache (detectAndParse output)
│   ├── timeline.ndjson      # Summary index (one JSON line per record, append-only)
│   └── metadata.json        # Session metadata
```

## Parsed Cache Versioning (IMPORTANT)

`{seq}.parsed` is a **cache** of `detectAndParse(record)`. When changing the parsed output format
(`Conversation` type fields, `Block` types, provider parser output), you MUST increment
`PARSED_CACHE_VERSION` in `packages/core/src/parse/index.ts`.

This guarantees the viewer detects stale cached files after a core/plugin upgrade and falls
back to re-parsing from `{seq}.json`.

- **Increment when**: Conversation type structure changes (field added/renamed/removed)
- **Do NOT increment when**: Only parser *logic* changes but output format stays the same
- **Consequence of forgetting**: Viewer silently serves stale parsed data

## Read Performance Hierarchy

The viewer reads data in priority order — each fallback is slower but always correct:
1. **timeline.ndjson** — lightweight summary index (fastest, no parsing)
2. **{seq}.parsed** — cached full parse result (fast, skips detectAndParse)
3. **{seq}.json + detectAndParse()** — source of truth (slowest, always correct)

When `timeline.ndjson` is missing/corrupted, the viewer falls back to scanning JSON files
and asynchronously rebuilds the ndjinx.

## Real-Time Updates

- **chokidar** watches trace directories (global + local) for file changes
- **SSE** (`/api/events`) pushes events to the frontend: `record:added`, `record:deleted`,
  `record:updated`, `session:created`, `session:deleted`
- Frontend uses `useSSE()` composable → `watch(refreshKey)` → re-fetch endpoints
- When `{seq}.json` is deleted, the chokidar `unlink` handler also cleans up the
  corresponding entry from `timeline.ndjinx` to prevent ghost records

## Viewer

- **Port**: 3210 (default), `--no-open` to skip browser launch
- Fastify server with Vue SPA frontend (vite-built to `dist/public/`)
- Serves `index.html` via SPA fallback (`setNotFoundHandler`)
- API prefix: `/api/` (sessions, timeline, metadata, records, export, import, trace control)

## Plugin

- Loaded via OpenCode plugin system (`@opencode-ai/plugin` SDK)
- Core module re-exported from `.` (not `./dist/index.js` — actual entry is `./dist/trace.js`)

## Trace Enable/Disable Logic (Scope & Storage)

### Scope Model

Three independent scopes control whether tracing is enabled:

| Scope | Config Location | Description |
|-------|----------------|-------------|
| `global` | `~/.opencode-trace/config.json` → `global_trace_enabled` | All projects, all sessions |
| `local` | `<project>/.opencode-trace/config.json` → `global_trace_enabled` | This project folder only |
| `session` | Session `metadata.json` → `trace_enabled` | Current session only |

### Enable Resolution (largest scope wins)

```
global_trace_enabled === true  →  tracing is ON (regardless of local/session)
global_trace_enabled === false →  check local
  local global_trace_enabled === true  →  tracing is ON
  local global_trace_enabled === false →  check session
    session trace_enabled === true  →  tracing is ON
    session trace_enabled === false →  tracing is OFF
    session trace_enabled === null  →  tracing is OFF (default)
```

Implemented in `TracePlugin.shouldRecord(sessionId)` in `packages/plugin/src/plugin-instance.ts`.

### Storage Model

Two storage locations:

| Storage | Path | Description |
|---------|------|-------------|
| `global` | `~/.opencode-trace/` | User home directory (default) |
| `local` | `<project>/.opencode-trace/` | Project directory |

### Storage Resolution (smallest scope wins)

```
session has storage_preference  →  use session preference
session has no preference       →  use global config storage_preference (default: "global")
```

Implemented in `TracePlugin.resolveTraceDir(sessionId)` in `packages/plugin/src/plugin-instance.ts`.

### Config File Format

**Global config** (`~/.opencode-trace/config.json`):
```json
{
  "global_trace_enabled": false,
  "storage_preference": "global",
  "plugin_enabled": true,
  "current_session": null,
  "schema_version": 1
}
```

**Local config** (`<project>/.opencode-trace/config.json`):
```json
{
  "global_trace_enabled": false,
  "storage_preference": "global",
  "plugin_enabled": true,
  "current_session": null,
  "schema_version": 1
}
```

**Session metadata** (`<trace-dir>/<session-id>/metadata.json`):
```json
{
  "title": "Session Title",
  "parentID": null,
  "subSessions": [],
  "trace_enabled": null,
  "storage_preference": null,
  "folderPath": "/path/to/project",
  "startedAt": "2024-01-01T00:00:00Z"
}
```

### User Commands (Slash Commands)

`/trace` is a slash command for users to control recording:

```
/trace on [-g] [-l] [-s] [-d global|local]
/trace off [-g] [-l] [-s]
/trace status
/trace help
```

Scope flags (can combine multiple):
- `-g`, `--global` — Global scope (all projects, all sessions)
- `-l`, `--local` — Local scope (this project folder)
- `-s`, `--session` — Session scope (current session only)
- Default: `-g` if no scope flag given

Storage flag:
- `-d`, `--dir <global|local>` — Where to save traces (default: global)

### Agent Tools

Three tools registered for AI agents. Agent tools only operate at the **session** level:

| Tool | Parameters | Description |
|------|-----------|-------------|
| `trace_on` | (none) | Enable tracing for current session |
| `trace_off` | (none) | Disable tracing for current session |
| `trace_status` | (none) | Show all scope statuses and effective state |

### StateManager API (packages/core/src/state/index.ts)

Key methods for scope/storage management:

```typescript
class ConfigManager {
  // Global state
  getGlobalState(key: string): string
  setGlobalState(key: string, value: string): void

  // Session state
  getSessionEnabled(sessionId: string): boolean
  setSessionEnabled(sessionId: string, enabled: boolean): void

  // Storage preference
  getStoragePreference(): "global" | "local"
  setStoragePreference(pref: "global" | "local"): void
  getSessionStoragePreference(sessionId: string): "global" | "local" | null
  setSessionStoragePreference(sessionId: string, pref: "global" | "local"): void

  // Combined check
  isTraceEnabled(sessionId?: string): boolean
}
```

### Record Control API (packages/core/src/record/control.ts)

Exported functions for external use:

```typescript
// Scope enable/disable
setGlobalTraceEnabled(enabled: boolean, traceDir?: string): void
getGlobalTraceEnabled(traceDir?: string): boolean
setSessionEnabled(sessionId: string, enabled: boolean, traceDir?: string): void
getSessionEnabled(sessionId: string, traceDir?: string): boolean
shouldRecord(sessionId?: string, traceDir?: string): boolean

// Storage preference
setStoragePreference(pref: "global" | "local", traceDir?: string): void
getStoragePreference(traceDir?: string): "global" | "local"
setSessionStoragePreference(sessionId: string, pref: "global" | "local", traceDir?: string): void
getSessionStoragePreference(sessionId: string, traceDir?: string): "global" | "local" | null
```
