import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, type MemoryType } from "../config";
import { automemRecall, automemStore, automemUpdate, setAutoMemMcpServerName } from "../mcp-client";
import { evaluateWritePolicy, formatCandidate, type MemoryCandidate } from "../write-policy";
import { parseSearchResults } from "../recall";

// ---------------------------------------------------------------------------
// Shared parameter schemas (plain Type.Object — no Type.Intersect)
// ---------------------------------------------------------------------------

const CandidateParams = Type.Object({
  content: Type.String({ description: "Compact memory text. Target 150-300 chars; hard max from config, default 2000." }),
  type: Type.String({ description: "Memory type: Decision, Pattern, Preference, Style, Habit, Insight, or Context" }),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags such as source:pi, project:<slug>, preference, decision" })),
  importance: Type.Optional(Type.Number({ description: "Importance 0-1. Use 0.85+ for durable decisions/preferences/corrections." })),
  confidence: Type.Optional(Type.Number({ description: "Classification confidence 0-1. Default 0.9." })),
  category: Type.Optional(Type.String({ description: "Write-policy category, e.g. technical-decision, agent-pattern, bug-fix, private" })),
  source: Type.Optional(Type.String({ description: "Memory source label. Default from config." })),
  metadata: Type.Optional(Type.Any({ description: "Optional JSON metadata" })),
});

const CommitParams = Type.Object({
  content: Type.String({ description: "Compact memory text. Target 150-300 chars; hard max from config, default 2000." }),
  type: Type.String({ description: "Memory type: Decision, Pattern, Preference, Style, Habit, Insight, or Context" }),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags such as source:pi, project:<slug>, preference, decision" })),
  importance: Type.Optional(Type.Number({ description: "Importance 0-1. Use 0.85+ for durable decisions/preferences/corrections." })),
  confidence: Type.Optional(Type.Number({ description: "Classification confidence 0-1. Default 0.9." })),
  category: Type.Optional(Type.String({ description: "Write-policy category, e.g. technical-decision, agent-pattern, bug-fix, private" })),
  source: Type.Optional(Type.String({ description: "Memory source label. Default from config." })),
  metadata: Type.Optional(Type.Any({ description: "Optional JSON metadata" })),
  approvedByUser: Type.Optional(Type.Boolean({ description: "Set true only after explicit user approval for this exact memory candidate." })),
  dedupeQuery: Type.Optional(Type.String({ description: "Optional query for similar-memory recall before storing. Defaults to content." })),
  updateMemoryId: Type.Optional(Type.String({ description: "If set, update this existing memory instead of storing a new one. Use when dedupe found a close match." })),
});

const UpdateParams = Type.Object({
  memoryId: Type.String({ description: "ID of the existing AutoMem memory to update." }),
  content: Type.Optional(Type.String({ description: "New memory content to replace the existing content." })),
  type: Type.Optional(Type.String({ description: "Updated memory type: Decision, Pattern, Preference, Style, Habit, Insight, or Context" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Updated tags (replaces existing tags on the memory)." })),
  importance: Type.Optional(Type.Number({ description: "Updated importance 0-1." })),
  confidence: Type.Optional(Type.Number({ description: "Updated confidence 0-1." })),
  metadata: Type.Optional(Type.Any({ description: "Updated metadata (merged with existing)." })),
  approvedByUser: Type.Optional(Type.Boolean({ description: "Set true only after explicit user approval." })),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMemoryTools(pi: ExtensionAPI) {
  // ── automem_propose_memory ──────────────────────────────────────────────
  pi.registerTool({
    name: "automem_propose_memory",
    label: "AutoMem Propose Memory",
    description: "Validate and preview a durable memory candidate without writing it. Runs policy, secret scan, and similar-memory recall.",
    promptSnippet: "Use before storing durable memories. It does not write; it proposes and checks relevance/safety.",
    parameters: CandidateParams,
    async execute(_toolCallId, params) {
      const config = loadConfig();
      setAutoMemMcpServerName(config.mcpServerName);
      const candidate = toCandidate(params);
      const decision = evaluateWritePolicy(candidate, config);
      const { text: similarText, matches: similarMatches } = await recallSimilarWithMatches(
        decision.normalized.content,
        decision.normalized.tags,
        config,
      ).catch(() => ({ text: "Similar recall failed.", matches: [] }));

      return {
        content: [{ type: "text" as const, text: formatProposal(decision.action, decision.reasons, decision.normalized, similarText, similarMatches) }],
        details: { action: decision.action, reasons: decision.reasons, findings: decision.findings, candidate: decision.normalized, similarMatches },
        isError: decision.action === "block",
      };
    },
  });

  // ── automem_commit_memory ───────────────────────────────────────────────
  pi.registerTool({
    name: "automem_commit_memory",
    label: "AutoMem Commit Memory",
    description: "Store a policy-approved durable memory in AutoMem. If dedupe finds a close match, returns DUPLICATE_DETECTED with the matching memory ID — use updateMemoryId to update instead of creating a duplicate.",
    promptSnippet: "Use only after automem_propose_memory and explicit approval, unless policy returns safe-auto. If DUPLICATE_DETECTED, consider calling again with updateMemoryId instead.",
    parameters: CommitParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: any) {
      const config = loadConfig();
      setAutoMemMcpServerName(config.mcpServerName);
      const candidate = toCandidate(params);
      const decision = evaluateWritePolicy(candidate, config);

      if (decision.action === "block") {
        return {
          content: [{ type: "text" as const, text: "Blocked by AutoMem write policy.\n" + decision.reasons.map((r: string) => "- " + r).join("\n") }],
          details: { action: decision.action, reasons: decision.reasons, findings: decision.findings },
          isError: true,
        };
      }

      const needsConfirmation = decision.action !== "auto";
      if (needsConfirmation && !params.approvedByUser) {
        if (ctx && ctx.ui && typeof ctx.ui.confirm === "function") {
          const ok = await ctx.ui.confirm("Store AutoMem memory?", formatCandidate(decision.normalized));
          if (!ok) {
            return { content: [{ type: "text" as const, text: "AutoMem memory write cancelled." }], details: { cancelled: true } };
          }
        } else {
          return {
            content: [{ type: "text" as const, text: "Confirmation required before storing this memory. Re-run with approvedByUser=true only after explicit user approval." }],
            details: { action: decision.action, reasons: decision.reasons, candidate: decision.normalized },
            isError: true,
          };
        }
      }

      // ── UPDATE path ──────────────────────────────────────────────────────
      if (params.updateMemoryId) {
        const result = await automemUpdate(params.updateMemoryId, {
          content: decision.normalized.content,
          type: decision.normalized.type,
          tags: decision.normalized.tags,
          importance: decision.normalized.importance,
          confidence: decision.normalized.confidence,
          metadata: { ...(decision.normalized.metadata || {}), write_policy_action: decision.action, updated_via: "automem_commit_memory" },
        });
        const text = result.content?.[0]?.text || "Memory updated.";
        return {
          content: [{ type: "text" as const, text: "Updated existing AutoMem memory " + params.updateMemoryId + ".\n\n" + text }],
          details: { updated: true, memoryId: params.updateMemoryId, candidate: decision.normalized },
        };
      }

      // ── DEDUPE CHECK ─────────────────────────────────────────────────────
      // Skip dedupe if dedupeQuery is explicitly set to empty string
      const skipDedupe = typeof params.dedupeQuery === "string" && params.dedupeQuery.trim() === "";
      const dedupeQuery = skipDedupe ? null : (params.dedupeQuery || decision.normalized.content);
      const { text: similarText, matches: similarMatches } = dedupeQuery
        ? await recallSimilarWithMatches(dedupeQuery, decision.normalized.tags, config).catch(() => ({ text: "", matches: [] }))
        : { text: "", matches: [] };

      // Surface a duplicate warning if a close match exists
      if (!skipDedupe && similarMatches.length > 0 && similarMatches[0].id) {
        const top = similarMatches[0];
        return {
          content: [{
            type: "text" as const,
            text: [
              "DUPLICATE_DETECTED — a similar memory already exists.",
              "",
              "Existing memory (ID: " + top.id + "):",
              "  " + top.content,
              "",
              "Your candidate:",
              "  " + decision.normalized.content,
              "",
              "Options:",
              "  1. Update the existing memory: call automem_commit_memory again with updateMemoryId=\"" + top.id + "\"",
              "  2. Store anyway (new memory): call automem_commit_memory with dedupeQuery=\"\" to skip dedupe",
              "  3. Cancel: do nothing if this is not worth storing separately",
            ].join("\n"),
          }],
          details: { duplicateDetected: true, existingMemoryId: top.id, existingContent: top.content, candidate: decision.normalized, allSimilar: similarMatches },
          isError: false,
        };
      }

      // ── STORE path ───────────────────────────────────────────────────────
      const result = await automemStore(
        decision.normalized.content,
        decision.normalized.type,
        decision.normalized.tags,
        {
          source: decision.normalized.source,
          confidence: decision.normalized.confidence,
          importance: decision.normalized.importance,
          metadata: { ...(decision.normalized.metadata || {}), write_policy_action: decision.action },
        },
      );
      const text = result.content?.[0]?.text || "Memory stored.";

      return {
        content: [{ type: "text" as const, text: "Stored AutoMem memory.\n\n" + text }],
        details: { result, candidate: decision.normalized, similarPreview: similarText.slice(0, 500) },
      };
    },
  });

  // ── automem_update_memory ───────────────────────────────────────────────
  pi.registerTool({
    name: "automem_update_memory",
    label: "AutoMem Update Memory",
    description: "Update an existing AutoMem memory by ID. Use when dedupe found a close match and the existing memory needs correction or enrichment rather than a new duplicate being stored.",
    promptSnippet: "Use after automem_commit_memory returns DUPLICATE_DETECTED, or when correcting a known memory. Requires the existing memory ID.",
    parameters: UpdateParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: any) {
      if (!params.memoryId) {
        return {
          content: [{ type: "text" as const, text: "memoryId is required for automem_update_memory." }],
          isError: true,
        };
      }

      if (!params.approvedByUser) {
        if (ctx && ctx.ui && typeof ctx.ui.confirm === "function") {
          const preview = [
            "Memory ID: " + params.memoryId,
            params.content ? "New content: " + params.content : null,
            params.type ? "Type: " + params.type : null,
            params.tags ? "Tags: " + params.tags.join(", ") : null,
          ].filter(Boolean).join("\n");
          const ok = await ctx.ui.confirm("Update AutoMem memory?", preview);
          if (!ok) {
            return { content: [{ type: "text" as const, text: "AutoMem memory update cancelled." }], details: { cancelled: true } };
          }
        } else {
          return {
            content: [{ type: "text" as const, text: "Confirmation required before updating this memory. Re-run with approvedByUser=true only after explicit user approval." }],
            isError: true,
          };
        }
      }

      const result = await automemUpdate(params.memoryId, {
        content: params.content,
        type: params.type,
        tags: Array.isArray(params.tags) ? params.tags : undefined,
        importance: params.importance,
        confidence: params.confidence,
        metadata: params.metadata ? { ...params.metadata, updated_via: "automem_update_memory" } : { updated_via: "automem_update_memory" },
      });

      const text = result.content?.[0]?.text || "Memory updated.";
      return {
        content: [{ type: "text" as const, text: "Updated AutoMem memory " + params.memoryId + ".\n\n" + text }],
        details: { result, memoryId: params.memoryId },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCandidate(params: any): MemoryCandidate {
  return {
    content: params.content,
    type: params.type as MemoryType,
    tags: Array.isArray(params.tags) ? params.tags : [],
    importance: params.importance,
    confidence: params.confidence,
    source: params.source,
    category: params.category,
    metadata: params.metadata,
  };
}

interface SimilarResult {
  text: string;
  matches: Array<{ id: string; content: string; score?: number }>;
}

async function recallSimilarWithMatches(query: string, tags: string[], config: any): Promise<SimilarResult> {
  if (config.writePolicy.dedupeBeforeWrite === false) {
    return { text: "Dedupe recall disabled.", matches: [] };
  }
  const result = await automemRecall(query, {
    limit: Number((config.writePolicy as any).dedupeLimit || 3),
    tags,
    tagMode: "any",
    contextTypes: ["Decision", "Pattern", "Preference", "Style", "Habit", "Insight", "Context"],
    expandRelations: false,
    expandEntities: false,
  }, config.turnRecall?.timeoutMs);
  const text = result.content?.[0]?.text || "No similar memories found.";
  const parsed = parseSearchResults(text);
  const matches = parsed
    .filter(m => m.id)
    .map(m => ({ id: m.id, content: m.content, score: m.score }));
  return { text, matches };
}

function formatProposal(
  action: string,
  reasons: string[],
  candidate: MemoryCandidate,
  similarText: string,
  similarMatches: Array<{ id: string; content: string; score?: number }>,
): string {
  const dupeWarning = similarMatches.length > 0 && similarMatches[0].id
    ? "\n⚠️  Possible duplicate detected (ID: " + similarMatches[0].id + "):\n  " + similarMatches[0].content
    : "";

  return [
    "# AutoMem memory proposal",
    "",
    "Recommended action: " + action,
    reasons.length ? "\nReasons:\n" + reasons.map((r: string) => "- " + r).join("\n") : "",
    dupeWarning,
    "",
    "## Candidate",
    formatCandidate(candidate),
    "",
    "## Similar-memory check",
    similarText.slice(0, 2000),
  ].filter(Boolean).join("\n");
}
