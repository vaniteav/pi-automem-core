# Contributing to pi-automem-core

## Development setup

```bash
git clone https://github.com/vaniteav/pi-automem-core.git
cd pi-automem-core
npm install
```

You need a working AutoMem MCP server configured in `~/.pi/agent/mcp.json` to run the live tests. The offline tests (`test:unit` and `test:phase2`) run without network access.

## Running tests

| Command | Requires network | What it covers |
|---|---|---|
| `npm run test:unit` | No | context-injector, config validation, project detection, SSE parsing, recall parsing |
| `npm run test:phase2` | No | write policy, secret scanning, tool registration |
| `npm run test:phase1` | Yes (AutoMem) | live health check, recall, parser, display modes |
| `npm run test:phase2:live` | Yes (AutoMem) | full round-trip: commit, dedupe, update, delete |
| `npm test` | No | runs test:unit + test:phase2 |

Run `npm test` before opening a pull request. Run `test:phase1` and `test:phase2:live` before publishing a release.

## Architecture

The extension has four layers:

1. **Transport** (`mcp-client.ts`) — JSON-RPC over HTTP to the AutoMem MCP sidecar. Reads connection config from `~/.pi/agent/mcp.json`. Handles both JSON and SSE responses. Tool names are discovered at session start and cached; the cache is cleared if the server name changes.

2. **Recall** (`recall.ts`, `context-injector.ts`) — Startup recall runs once at session start; turn recall runs before each agent prompt. Both enforce byte budgets to avoid bloating context. The `parseSearchResults` function handles AutoMem's human-readable format; it falls back to `type: "Context"` when type info is absent from the response.

3. **Write pipeline** (`write-policy.ts`, `secret-scan.ts`, `tools/memory-tools.ts`) — Every write goes through: normalize → secret scan → policy check → dedupe recall → confirm/auto → store. No write bypasses this pipeline.

4. **Extension lifecycle** (`index.ts`) — Hooks into pi events (`session_start`, `before_agent_start`, `session_shutdown`), registers commands (`/automem-status`, `/automem-recall`), and registers tools (`automem_propose_memory`, `automem_commit_memory`, `automem_update_memory`).

Project detection (`project-detect.ts`) runs before each turn recall to scope the query to the current project. It checks git remotes (walking up from cwd), folder names, and prompt keywords in that priority order.

## Known constraints

**Do not use `Type.Intersect` for pi tool parameter schemas.**
TypeBox's `Type.Intersect([SchemaA, Type.Object({...})])` produces `{ allOf: [...] }` with no top-level `type: "object"`. OpenAI's function-calling API rejects this — pi cannot boot. Always flatten tool parameters into a single `Type.Object` containing all fields.

**Prompts and skills must only reference tools that currently exist.**
The `prompts/automem-guidelines.md` and `skills/SKILL.md` files are loaded by pi at session start. If they reference tools from a future phase that haven't been implemented yet, pi will attempt to call them and emit `Unknown tool` errors on every turn. Only document capabilities that are implemented in the current version.

## Release checklist

Before tagging a release and publishing to npm:

1. Run `npm test` (offline tests must pass).
2. Run `npm run test:phase1` and `npm run test:phase2:live` against a live AutoMem instance.
3. Scan for sensitive data: `grep -rE "Bearer |sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}" src/ prompts/ skills/ examples/` — expect no matches.
4. Run `npm pack --dry-run` and verify only intended files are included (`src/`, `skills/`, `prompts/`, `examples/`, `README.md`, `CHANGELOG.md`, `LICENSE`).
5. Update `CHANGELOG.md` with the version and changes.
6. Publish with the `pi-package` keyword so it appears in pi's package gallery: `npm publish --access public`.

## Versioning

This package uses [Semantic Versioning](https://semver.org/):

- Patch (`0.x.1`): bug fixes that don't change config or tool signatures
- Minor (`0.2.0`): new features or config keys that are backwards-compatible
- Major (`1.0.0`): breaking changes to config format, tool names, or default behavior
