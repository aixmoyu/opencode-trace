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

## No sql.js / No SQLite

All sql.js/SQLite code has been removed. The only remaining `sql.js` reference is the
legacy migration code in `ConfigManager.init()` that reads an existing `state.db`,
migrates data to `config.json`, then deletes `state.db`. This dynamic import is
try-caught — if `sql.js` is not installed, it safely deletes the legacy file.

## Viewer

- **Port**: 3210 (default), `--no-open` to skip browser launch
- Fastify server with Vue SPA frontend (vite-built to `dist/public/`)
- Serves `index.html` via SPA fallback (`setNotFoundHandler`)
- API prefix: `/api/` (sessions, timeline, metadata, records, export, import, trace control)

## Plugin

- Loaded via OpenCode plugin system (`@opencode-ai/plugin` SDK)
- Core module re-exported from `.` (not `./dist/index.js` — actual entry is `./dist/trace.js`)
