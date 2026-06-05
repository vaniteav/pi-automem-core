---
name: automem-core
description: Long-term semantic memory for pi via AutoMem MCP. Provides startup recall, turn-level recall, project detection, and memory health status. Use when the session starts, when recalling context, or when checking AutoMem health.
---

# AutoMem Core Extension

Long-term semantic memory for pi via AutoMem MCP.

## Commands

- `/automem-status` — Show AutoMem health, memory count, and config summary
- `/automem-recall <query>` — Manually query AutoMem (debugging)
- `automem_propose_memory` — Validate/preview a durable memory candidate without writing
- `automem_commit_memory` — Store a policy-approved memory after confirmation or safe-auto policy

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

## Write policy

Default mode is propose-first. Store only compact durable knowledge: decisions, preferences, patterns, insights, durable bug-fix lessons, and important context. Never store secrets, credentials, raw transcripts, or incidental chatter.

Use `automem_propose_memory` before committing. Use `automem_commit_memory` only after explicit user approval unless config enables safe-auto for the exact low-risk category.

If AutoMem is down, pi works normally with a warning.
