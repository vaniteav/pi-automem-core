# Changelog

## 0.1.0

- Initial recall-only MVP.
- Added startup recall and turn-level recall through AutoMem MCP.
- Added hidden, summary, and full recall display modes.
- Added `/automem-status` and `/automem-recall` commands.
- Added project detection and Phase 1 smoke test.
- Added policy-gated write tools: `automem_propose_memory` and `automem_commit_memory`.
- Added secret scanning, write policy evaluation, dedupe recall, and Phase 2 policy tests.
- Added live write/recall/delete smoke test for verifying write functionality without polluting memory.
