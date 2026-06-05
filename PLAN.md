# pi-automem-core plan

## Vision

`pi-automem-core` makes long-term semantic memory automatic for pi users through an AutoMem-compatible MCP server.

The extension is generic: user preferences, recall queries, tags, project mappings, and source-of-truth rules all live in local configuration rather than extension code.

## Design principles

1. **Generic core, user-owned config** — No user-specific logic or local paths in package code.
2. **MCP transport** — Reuse the user's existing `~/.pi/agent/mcp.json` entry instead of duplicating API URL/token management.
3. **Bounded recall** — Keep memory context compact and configurable.
4. **Graceful degradation** — If memory is unavailable, pi continues normally.
5. **Privacy by default** — No bundled secrets, no bundled personal config, no automatic writes in Phase 1.
6. **Phased delivery** — Recall first, then carefully add write features with secret scanning and explicit policy.

## Package structure

```text
pi-automem-core/
├── README.md
├── CHANGELOG.md
├── LICENSE
├── package.json
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── mcp-client.ts
│   ├── recall.ts
│   ├── context-injector.ts
│   ├── project-detect.ts
│   └── commands/
│       ├── status.ts
│       └── recall.ts
├── prompts/
│   └── automem-guidelines.md
├── skills/
│   └── SKILL.md
├── examples/
│   ├── config.minimal.json
│   └── config.advanced.json
└── tests/
    └── phase1-smoke.ts
```

## Phase 1 — Recall-only core

Status: complete and covered by `npm run test:phase1`.

Features:

- Config loader for `~/.pi/agent/automem.json`
- MCP JSON-RPC client using pi MCP config
- MCP tool discovery and tool-name normalization
- Startup recall
- Turn-level recall
- Hidden/summary/full display modes
- Project detection from folder, git metadata, and prompt text
- `/automem-status`
- `/automem-recall <query>`
- Graceful failure when AutoMem is unavailable

Exit criteria:

- pi can start with the extension enabled
- health checks work
- recall context is injected without chat clutter in hidden mode
- no direct write tools are exposed in Phase 1 prompts/skills
- smoke test passes against a configured AutoMem MCP server

## Phase 2 — Curated writes

Planned features:

- Optional memory-write tool
- Configurable write policy
- Secret/credential scanning
- Confirm-first categories
- Blocked categories
- Clear audit trail for writes

Phase 2 must not auto-write sensitive or ambiguous content.

## Phase 3 — Relationships and consolidation

Planned features:

- Relationship creation helpers
- Correction/counterexample handling
- Optional source-of-truth metadata
- Better project/topic recall tuning

## Phase 4 — Package polish and distribution

Planned features:

- npm publish
- GitHub release tags
- package-gallery metadata
- public documentation examples
- optional preview image/video

## Public-release checklist

- [ ] No personal names, local paths, hostnames, private project names, or secrets in package files
- [ ] `npm run test:phase1` passes
- [ ] `npm pack --dry-run` contains only intended files
- [ ] README includes install, config, commands, security notes, and troubleshooting
- [ ] License and changelog present
- [ ] Package includes `pi-package` keyword
