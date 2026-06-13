# Changelog

## 0.2.1 — 2026-06-13

Patch release from a full review of the codebase. All fixes ship with
failing-test-first regression coverage in `tests/review-fixes.ts`.

### Security
- Secret/credential scanning now also inspects model-supplied `metadata` on
  memory writes. Previously only `content` and `tags` were scanned, so a secret
  placed in `metadata` (which is stored verbatim) could bypass the guard.
  (`src/write-policy.ts`)
- Config loader ignores `__proto__`, `constructor`, and `prototype` keys when
  merging a user config file, so a crafted `automem.json` cannot rebind the
  merged config's prototype. (`src/config.ts`)

### Fixed
- MCP client now surfaces tool-level failures (`isError`) instead of reporting
  them as success. A failed health check, store, or update previously returned
  silently — e.g. an unreachable database showed as "healthy" and a failed
  write reported "Memory stored." (`src/mcp-client.ts`)
- Turn recall now filters by a lowercased project tag so it matches the
  lowercased tags the write path stores. With AutoMem's default exact tag
  matching, recall could previously miss memories the extension itself wrote.
  (`src/recall.ts`)
- `automem_correct_memory` now stores the normalized candidate (with
  `alwaysTag`, default source, and whitespace normalization), consistent with
  every other write path. (`src/tools/relationship-tools.ts`)
- The `truncated` flag on recall results now reflects whether memories were
  dropped from the byte budget, instead of being effectively always false.
  (`src/recall.ts`)
- Project detection now examines every git remote, not just the first. A repo
  whose configured tag matched a non-first remote (e.g. `upstream`) previously
  failed to be detected. (`src/project-detect.ts`)
- `package.json` test scripts referenced filenames that no longer existed, so
  `npm test` failed; they now point at the actual test files.

### Added
- `turnRecall.timeoutMs` config option (default `8000`). Turn recall is
  best-effort enrichment on the prompt hot path, so it now uses a short, bounded
  timeout — a slow or unreachable sidecar can no longer block every prompt for
  the full 30s MCP timeout. Writes and health checks keep the longer timeout.
  (`src/config.ts`, `src/mcp-client.ts`, `src/recall.ts`)

### Changed
- The MCP server config (`mcp.json`) is now cached per server name instead of
  being re-read and re-parsed from disk on every call (it sits on the per-turn
  recall hot path). The cache is invalidated when the configured server name
  changes. (`src/mcp-client.ts`)
- Startup-recall content dedupe keys are namespaced so they cannot collide with
  memory IDs. (`src/recall.ts`)

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

### Recall core
- Config loader with defaults and validation for `~/.pi/agent/automem.json`
- MCP JSON-RPC client reusing pi's existing `~/.pi/agent/mcp.json` connection
- Tool discovery with name normalization for `automem_` prefix
- Startup recall (queries + tags at session start)
- Turn-level recall (per-prompt, with project-scoped tags)
- Three display modes: `hidden`, `summary`, `full`
- Project detection from git remote, folder path, and prompt text
- `/automem-status` and `/automem-recall` commands
- Graceful degradation when AutoMem is unavailable

### Write tools
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
