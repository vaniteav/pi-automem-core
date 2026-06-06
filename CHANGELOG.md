# Changelog

## 0.2.0 — 2026-06-06

### Added
- `automem_link_memories` — create a typed relationship between two existing memories by ID (`src/tools/relationship-tools.ts`)
- `automem_correct_memory` — store a corrected memory and link old → new with EVOLVED_INTO or CONTRADICTS relationship; preserves provenance history
- `projectOverrides` config section — per-project `limit`, `maxBytes`, `contextTypes`, `expandRelations`, `expandEntities` overrides applied during turn recall when a project tag is detected

## 0.1.0 — 2026-06-06 (pre-publish cleanup)

### Changed
- Default `writePolicy.mode` changed from `propose` to `safe-auto`. Low-risk categories (technical-decision, agent-pattern, bug-fix, tooling-lesson) now auto-write by default; all other writes still require approval.

### Removed
- `vault` config section removed from `AutoMemConfig` type, defaults, examples, and README. This section was specific to Obsidian-based setups and has no place in a general-purpose package.

## 0.1.0 — 2026-06-04

### Phase 1 — Recall core
- Config loader with defaults and validation for `~/.pi/agent/automem.json`
- MCP JSON-RPC client reusing pi's existing `~/.pi/agent/mcp.json` connection
- Tool discovery with name normalization for `automem_` prefix
- Startup recall (queries + tags at session start)
- Turn-level recall (per-prompt, with project-scoped tags)
- Three display modes: `hidden`, `summary`, `full`
- Project detection from git remote, folder path, and prompt text
- `/automem-status` and `/automem-recall` commands
- Graceful degradation when AutoMem is unavailable

### Phase 2 — Curated writes
- `automem_propose_memory` — validates and previews candidates without writing
- `automem_commit_memory` — policy-gated store with secret scanning, dedupe check, and confirmation flow
- `automem_update_memory` — standalone tool to update any memory by ID
- `automemUpdate()` wrapper in mcp-client for `update_memory` MCP tool
- Write policy modes: `off`, `propose` (default), `safe-auto`, `confirm-all`
- Secret/credential scanning (API keys, bearer tokens, private keys, connection strings, etc.)
- Configurable auto-write, confirm, and blocked categories
- Minimum importance threshold for writes
- Dedupe recall with configurable limit and `dedupeQuery` override

### Update-vs-duplicate handling
- `automem_commit_memory` returns `DUPLICATE_DETECTED` when dedupe finds a matching memory
- `updateMemoryId` param on `automem_commit_memory` to update existing instead of storing duplicate
- `dedupeQuery: ""` to skip dedupe check for intentional first stores
- `automem_update_memory` standalone tool with optional confirmation gate
- Extended live write test covering: commit → dedupe → update paths → cleanup

### Fixed
- `Type.Intersect` on `automem_commit_memory` parameters produced `{ allOf: [...] }` with no `type: "object"` — broke OpenAI function-calling API. Replaced with flat `Type.Object`.
