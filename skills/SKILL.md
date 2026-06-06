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
- `automem_link_memories` — Create a typed relationship between two existing memories
- `automem_correct_memory` — Store a correction and link old → new with provenance (EVOLVED_INTO/CONTRADICTS)

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

Default mode is safe-auto for the four low-risk categories (technical-decision, agent-pattern, bug-fix, tooling-lesson); all other writes require explicit approval. Store only compact durable knowledge: decisions, preferences, patterns, insights, and important context. Never store secrets, credentials, raw transcripts, or incidental chatter.

Use `automem_propose_memory` before committing. Use `automem_commit_memory` only after explicit user approval unless config enables safe-auto for the exact low-risk category.

If AutoMem is down, pi works normally with a warning.
