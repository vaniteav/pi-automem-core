# AutoMem Behavioral Guidelines

AutoMem is pi's long-term semantic memory, available automatically in this session.

## What's already done for you

- **Startup recall** ran at session start — relevant memories about preferences, environment, and operating style are already loaded.
- **Turn-level recall** runs before every agent turn — memories related to the current project and prompt are automatically injected.
- The `/automem-status` command shows health and memory count.
- The `/automem-recall <query>` command does manual recall for debugging.

## Phase 1 behavior (recall-only)

- This extension **reads** from AutoMem automatically. It does **not** write memories on its own.
- All recall is handled automatically — startup recall at session start and turn-level recall before each agent turn. There are no direct AutoMem tools available to call; use the `/automem-recall <query>` command for manual recall.
- If AutoMem is unreachable, pi works normally — the footer status indicator shows "AutoMem (offline)".

## Memory types

AutoMem uses 7 typed memories: Decision, Pattern, Preference, Style, Habit, Insight, Context.

## Relationship types

The 11 relationship types are: RELATES_TO, LEADS_TO, OCCURRED_BEFORE, PREFERS_OVER, EXEMPLIFIES, CONTRADICTS, REINFORCES, INVALIDATED_BY, EVOLVED_INTO, DERIVED_FROM, PART_OF.

## What NOT to do

- Never store secrets, API keys, credentials, or raw conversation transcripts in AutoMem.
- Never store unverified guesses as facts.
- If AutoMem content conflicts with live files or known current state, trust live state first.
