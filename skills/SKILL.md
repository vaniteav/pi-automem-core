---
name: automem-core
description: Long-term semantic memory for pi via AutoMem MCP. Provides startup recall, turn-level recall, project detection, and memory health status. Use when the session starts, when recalling context, or when checking AutoMem health.
---

# AutoMem Core Extension

Long-term semantic memory for pi via AutoMem MCP.

## Commands

- `/automem-status` — Show AutoMem health, memory count, and config summary
- `/automem-recall <query>` — Manually query AutoMem (debugging)

## Config

Config lives at `~/.pi/agent/automem.json`. See the README for the full schema.

Key settings:
- `startupRecall.enabled` — Run recall at session start (default: true)
- `startupRecall.queries` — Queries to run at startup
- `turnRecall.enabled` — Run recall before each agent turn (default: true)
- `projectDetection.enabled` — Auto-detect project from git/cwd (default: true)

## Status indicator

The footer shows:
- `● AutoMem (42)` — healthy, 42 memories
- `● AutoMem (offline)` — unreachable

## Phase 1 limitations

- Recall only — no automatic writes
- No direct AutoMem tools are available to the model; use `/automem-recall <query>` for manual recall
- If AutoMem is down, pi works normally with a warning
