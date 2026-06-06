# AutoMem Behavioral Guidelines

AutoMem is pi's long-term semantic memory, available automatically in this session.

## What's already done for you

- **Startup recall** ran at session start — relevant memories about preferences, environment, and operating style are already loaded.
- **Turn-level recall** runs before every agent turn — memories related to the current project and prompt are automatically injected.
- The `/automem-status` command shows health and memory count.
- The `/automem-recall <query>` command does manual recall for debugging.

## Recall behavior

- Startup recall runs at session start and turn-level recall runs before each agent turn.
- Use `/automem-recall <query>` for manual recall/debugging.
- If AutoMem is unreachable, pi works normally — the footer status indicator shows "AutoMem (offline)".

## Write behavior

- Do **not** write raw session transcripts, long summaries, or incidental chatter.
- Use `automem_propose_memory` first for durable candidates. It validates type/tags/importance, scans for secrets, and checks for similar memories.
- Use `automem_commit_memory` only after explicit user approval, unless the category is in the safe-auto list (technical-decision, agent-pattern, bug-fix, tooling-lesson) — those auto-write by default.
- Good memory candidates are compact, intentional, and useful across sessions: decisions, preferences, repeated patterns, key insights, durable bug-fix lessons, and important project context.

## Memory types

AutoMem uses 7 typed memories: Decision, Pattern, Preference, Style, Habit, Insight, Context.

## Relationship types

The 11 relationship types are: RELATES_TO, LEADS_TO, OCCURRED_BEFORE, PREFERS_OVER, EXEMPLIFIES, CONTRADICTS, REINFORCES, INVALIDATED_BY, EVOLVED_INTO, DERIVED_FROM, PART_OF.

## What NOT to do

- Never store secrets, API keys, credentials, or raw conversation transcripts in AutoMem.
- Never store unverified guesses as facts.
- If AutoMem content conflicts with live files or known current state, trust live state first.
