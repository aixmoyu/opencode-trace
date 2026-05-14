# AGENTS.md - OpenCode Trace

## Project Structure

Monorepo with npm workspaces + turbo, 4 packages under `packages/*`. Build order is managed by `tsc -b` via project references.

| Package | Purpose | Key Dependencies | Exports |
|---------|---------|------------------|---------|
| `@opencode-trace/core` | Core (parse, store, query, record, state, format, transform) | sql.js, zod, winston | `.` + `./state` subpath |
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

## Core Architecture

Entry point: `packages/core/src/index.ts` re-exports 9 modules as namespaces (store, parse, transform, query, record, state, format, schemas).

Data flow: HTTP Request → Plugin intercepts → Core Parse → Core Store → Core Query → Viewer/CLI

`store/index.ts` reads/writes `~/.opencode-trace/` — session dirs with `{N}.json`, `{N}.sse`, `metadata.json` + `state.db` (SQLite).

## Viewer

- **Port**: 3210 (default), `--no-open` to skip browser launch
- Fastify server with Vue SPA frontend (vite-built to `dist/public/`)
- Serves `index.html` via SPA fallback (`setNotFoundHandler`)
- API prefix: `/api/` (sessions, timeline, metadata, records, export, import, trace control)

## Plugin

- Loaded via OpenCode plugin system (`@opencode-ai/plugin` SDK)
- Core module re-exported from `.` (not `./dist/index.js` — actual entry is `./dist/trace.js`)
