# pi-automem-core

Long-term semantic memory for [pi](https://pi.dev) agents via an AutoMem MCP server.

`pi-automem-core` adds automatic recall to pi sessions:

- startup recall for preferences, environment, and operating style
- turn-level recall based on the current prompt and detected project
- compact/hidden context injection so memory helps the model without cluttering chat
- `/automem-status` and `/automem-recall` commands for debugging
- explicit write tools that propose, scan, dedupe, and confirm before storing

Current status: recall is automatic; memory writes are explicit and policy-gated. The default write mode is propose-first, not automatic.

## Requirements

- pi with package support
- an AutoMem-compatible MCP server configured in `~/.pi/agent/mcp.json`

The extension reads your existing MCP configuration. It does not store AutoMem URLs, API tokens, or credentials.

## Installation

From npm, after publication:

```bash
pi install npm:pi-automem-core
```

From GitHub:

```bash
pi install git:github.com/vaniteav/pi-automem-core
```

From a local checkout:

```bash
pi install /path/to/pi-automem-core
```

## MCP configuration

Add an AutoMem MCP server to `~/.pi/agent/mcp.json`:

```json
{
  "mcpServers": {
    "automem": {
      "url": "https://your-automem-mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${AUTOMEM_TOKEN}"
      }
    }
  }
}
```

Use environment-variable interpolation for secrets. Do not hardcode credentials in project files.

## Quick config

Create `~/.pi/agent/automem.json`:

```json
{
  "mcpServerName": "automem",
  "startupRecall": {
    "queries": [
      "user preferences working style",
      "current environment setup",
      "active projects and recent decisions"
    ],
    "limit": 5
  },
  "behavior": {
    "displayRecall": "hidden"
  }
}
```

Start or reload pi. AutoMem recall is now automatic.

## Recall display modes

The model needs memory context; the user usually does not need to see a large recall block. Configure visibility with `behavior.displayRecall`:

| Mode | Behavior |
|---|---|
| `hidden` | Inject recall through the per-turn system prompt. No recall block is shown. Recommended default. |
| `summary` | Inject recall through the per-turn system prompt and show a compact notification. |
| `full` | Show the full injected recall block. Useful for debugging relevance and parser issues. |

Example:

```json
{
  "behavior": {
    "displayRecall": "summary"
  }
}
```

## Commands

| Command | Description |
|---|---|
| `/automem-status` | Show AutoMem health, memory count, and config summary |
| `/automem-recall <query>` | Manually query AutoMem for debugging |
| `automem_propose_memory` | Tool: validate and preview a memory candidate without writing |
| `automem_commit_memory` | Tool: store a policy-approved memory; returns DUPLICATE_DETECTED if a similar memory exists |
| `automem_update_memory` | Tool: update an existing memory by ID |

## Configuration reference

Configuration lives at `~/.pi/agent/automem.json` unless `AUTOMEM_CONFIG_PATH` is set.

Important sections:

| Section | Purpose |
|---|---|
| `mcpServerName` | Name of the MCP server in `mcp.json` |
| `startupRecall` | Queries, tags, tag mode, limits, and byte budget for session-start recall |
| `turnRecall` | Limits, memory types, and relation/entity expansion for each prompt |
| `projectDetection` | folder/git/prompt → project tag mappings for scoped turn recall |
| `writePolicy` | Write mode, safe/confirm/blocked categories, minimum importance, dedupe settings |
| `vault` | Optional canonical-source metadata for users who maintain an external knowledge base |
| `behavior` | Recall display mode and content-length preferences |

See `examples/config.minimal.json` and `examples/config.advanced.json` for templates.

## Example advanced config

```json
{
  "mcpServerName": "automem",
  "startupRecall": {
    "queries": [
      "user preferences working style",
      "agent operating guidelines",
      "local development environment",
      "active projects recent decisions"
    ],
    "tags": ["source:pi"],
    "tagMode": "any",
    "limit": 6,
    "maxBytes": 5000
  },
  "projectDetection": {
    "folderTags": {
      "projects": ["project"],
      "my-repo": ["project:my-project"]
    },
    "gitRepoToTag": {
      "my-org/my-project": "project:my-project"
    }
  },
  "turnRecall": {
    "limit": 5,
    "maxBytes": 3000,
    "contextTypes": ["Preference", "Decision", "Pattern", "Insight", "Context"],
    "expandRelations": true,
    "expandEntities": true
  },
  "behavior": {
    "displayRecall": "hidden"
  }
}
```

## Security and privacy

- This package does not include user-specific configuration.
- Secrets should live in environment variables or your local MCP configuration, not in this package.
- Write tools are explicit and policy-gated; default mode proposes rather than auto-writes.
- Secret-like content, credentials, raw transcripts, blocked categories, and low-importance candidates are blocked before storage.
- Use `automem_propose_memory` before committing a memory. Use `automem_commit_memory` only after explicit approval unless your local config enables safe-auto for that exact low-risk category.

### Duplicate handling

When `automem_commit_memory` is called with dedupe enabled (default), AutoMem is queried for similar memories before storing. If a close match exists, the tool returns a `DUPLICATE_DETECTED` response containing the existing memory's ID and content. You can then:

1. **Update the existing memory** — call `automem_commit_memory` again with `updateMemoryId` set to the returned ID, or use `automem_update_memory` directly.
2. **Force a new store** — set `dedupeQuery` to `""` to skip the dedupe check.
3. **Cancel** — do nothing if the existing memory already covers the information.

## Write policy example

```json
{
  "writePolicy": {
    "mode": "propose",
    "autoWriteCategories": ["technical-decision", "agent-pattern", "bug-fix", "tooling-lesson"],
    "confirmCategories": ["personal", "financial", "private", "identity"],
    "blockedCategories": ["secret", "credential", "api-key", "raw-transcript"],
    "minImportanceToWrite": 0.7,
    "dedupeBeforeWrite": true
  }
}
```

Modes:

| Mode | Behavior |
|---|---|
| `off` | Block all writes |
| `propose` | Default. Propose candidates; require approval to commit |
| `safe-auto` | Auto-write only configured low-risk categories; confirm risky categories |
| `confirm-all` | Require confirmation for every write |

## Development

```bash
npm install
npm test
```

| Script | What it tests |
|---|---|
| `npm run test:phase1` | Live smoke test: health, recall, parser, project detection, display modes |
| `npm run test:phase2` | Write policy, secret scanning, tool registration (no writes) |
| `npm run test:phase2:live` | Full round-trip: commit, dedupe detection, update, cleanup |

`test:phase1` and `test:phase2:live` require a working AutoMem MCP server. `test:phase2` runs entirely offline.

## Updating memories

Use `automem_update_memory` when you have a specific memory ID and want to correct or enrich it without creating a duplicate:

```
automem_update_memory({
  memoryId: "uuid-of-existing-memory",
  content: "Corrected content",
  tags: ["source:pi", "corrected"],
  approvedByUser: true
})
```

Fields `content`, `type`, `tags`, `importance`, `confidence`, and `metadata` are all optional — only the fields you provide are updated. The `metadata` object is merged with existing metadata.

## Changelog

### 0.1.0 — 2026-06-04

- Recall-only core: startup recall, turn-level recall, project detection, three display modes
- Curated writes: propose → scan → confirm → store pipeline with secret scanning
- Duplicate detection: `automem_commit_memory` surfaces `DUPLICATE_DETECTED` with existing memory ID
- Update path: `automem_update_memory` standalone tool + `updateMemoryId` param on commit
- Configurable write modes: off, propose, safe-auto, confirm-all
- Bounded recall with byte budgets and configurable limits

## License

MIT
