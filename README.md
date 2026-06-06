<div align="center">

# pi-automem-core

The missing link between [pi](https://github.com/earendil-works/pi) and [AutoMem](https://github.com/verygoodplugins/automem). If you already have both set up, this package connects them — giving pi automatic long-term memory: startup recall, turn-level recall, policy-gated writes, and relationship tools.

```bash
pi install npm:pi-automem-core
```

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/L2J320X82M)

</div>

---

## Before you begin

This package does not include pi or AutoMem — it connects them. You need both running independently first:

1. **[pi](https://github.com/earendil-works/pi)** — the agent this extension runs inside
2. **[AutoMem](https://github.com/verygoodplugins/automem)** — the graph-vector memory service (self-hosted or Railway)
3. **[mcp-automem](https://github.com/verygoodplugins/mcp-automem)** — the MCP bridge that exposes AutoMem's tools over the MCP protocol

Once those three are in place, add `mcp-automem` to pi's MCP config and install this package. That's all the wiring this package needs.

---

## What it does

- **Startup recall** — at session start, queries AutoMem for your preferences, working style, and environment
- **Turn-level recall** — before each agent prompt, retrieves memories relevant to the current task and detected project
- **Silent injection** — memory context is injected into the system prompt, not the chat window
- **Policy-gated writes** — every memory write is validated, secret-scanned, deduplicated, and confirmed before storage
- **Relationship tools** — link memories to each other or record corrections with provenance history
- **Per-project tuning** — configure different recall limits and filters per detected project

---

## Getting started

**1. Add your AutoMem server to `~/.pi/agent/mcp.json`:**

```json
{
  "mcpServers": {
    "automem": {
      "url": "https://your-automem-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${AUTOMEM_TOKEN}"
      }
    }
  }
}
```

Use `${ENV_VAR}` interpolation for secrets. Never hardcode credentials.

**2. Create `~/.pi/agent/automem.json`:**

```json
{
  "mcpServerName": "automem",
  "startupRecall": {
    "queries": [
      "user preferences working style",
      "current environment setup",
      "active projects and recent decisions"
    ]
  },
  "behavior": {
    "displayRecall": "summary"
  }
}
```

**3. Start or reload pi.** Recall is now automatic.

---

## Commands

| Command | What it does |
|---|---|
| `/automem-status` | Health check — shows memory count and active config |
| `/automem-recall <query>` | Manual recall query for debugging |

## Tools

| Tool | What it does |
|---|---|
| `automem_propose_memory` | Preview a memory candidate — validates, scans for secrets, checks for duplicates. Does not write. |
| `automem_commit_memory` | Store a policy-approved memory. Returns `DUPLICATE_DETECTED` if a similar memory exists. |
| `automem_update_memory` | Update an existing memory by ID. |
| `automem_link_memories` | Create a typed relationship between two existing memories. |
| `automem_correct_memory` | Store a correction and link old → new with a provenance relationship (EVOLVED_INTO or CONTRADICTS). |

---

## Write policy

Every write goes through: normalize → secret scan → policy check → dedupe → confirm/auto → store. Nothing bypasses this pipeline.

```json
{
  "writePolicy": {
    "mode": "safe-auto",
    "autoWriteCategories": ["technical-decision", "agent-pattern", "bug-fix", "tooling-lesson"],
    "confirmCategories": ["personal", "financial", "private", "identity"],
    "blockedCategories": ["secret", "credential", "api-key", "raw-transcript"],
    "minImportanceToWrite": 0.7,
    "dedupeBeforeWrite": true
  }
}
```

| Mode | Behavior |
|---|---|
| `safe-auto` | Auto-write configured low-risk categories; confirm everything else. **Default.** |
| `propose` | Propose all candidates; require explicit approval to commit. |
| `confirm-all` | Confirm every write individually. |
| `off` | Block all writes. |

### Duplicate handling

When a commit finds a close match, `automem_commit_memory` returns `DUPLICATE_DETECTED` with the existing memory's ID. Options:
1. Update it — re-call with `updateMemoryId` set to the returned ID
2. Force a new store — set `dedupeQuery: ""` to skip the check
3. Cancel — do nothing if the existing memory already covers it

---

## Recall display modes

| Mode | Behavior |
|---|---|
| `hidden` | Inject into system prompt only. Nothing shown in chat. |
| `summary` | Inject into system prompt + show a compact notification. |
| `full` | Show the full recall block. Useful for debugging. |

---

## Configuration reference

Config file: `~/.pi/agent/automem.json` (or `AUTOMEM_CONFIG_PATH`)

| Section | Purpose |
|---|---|
| `mcpServerName` | Which server in `mcp.json` to use |
| `startupRecall` | Queries, tags, limits, byte budget for session-start recall |
| `turnRecall` | Per-prompt recall: limits, memory types, relation/entity expansion |
| `projectDetection` | Map git repos and folder names to project tags for scoped recall |
| `projectOverrides` | Per-project overrides for turn recall limits and filters |
| `writePolicy` | Write mode, categories, importance threshold, dedupe settings |
| `behavior` | Display mode and content-length preferences |

See [`examples/config.minimal.json`](examples/config.minimal.json) and [`examples/config.advanced.json`](examples/config.advanced.json).

---

## Development

```bash
git clone https://github.com/vaniteav/pi-automem-core.git
cd pi-automem-core
npm install
npm test               # offline tests
npm run test:smoke     # live smoke test (requires AutoMem)
npm run test:live      # full round-trip write test (requires AutoMem)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture notes, test descriptions, and release process.

---

## Credits

This package builds on two excellent open-source projects:

- **[pi](https://github.com/earendil-works/pi)** by [Earendil Works](https://github.com/earendil-works) — the extensible AI agent toolkit this package runs on
- **[AutoMem](https://github.com/verygoodplugins/automem)** by [Very Good Plugins](https://github.com/verygoodplugins) — the graph-vector memory service powering recall and storage
- **[mcp-automem](https://github.com/verygoodplugins/mcp-automem)** by [Very Good Plugins](https://github.com/verygoodplugins) — the MCP bridge this extension communicates through

---

## License

MIT — [vaniteav](https://github.com/vaniteav)

---
