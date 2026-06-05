import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, type MemoryType } from "../config";
import { automemRecall, automemStore, setAutoMemMcpServerName } from "../mcp-client";
import { evaluateWritePolicy, formatCandidate, type MemoryCandidate } from "../write-policy";

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

const CommitParams = Type.Intersect([
  CandidateParams,
  Type.Object({
    approvedByUser: Type.Optional(Type.Boolean({ description: "Set true only after explicit user approval for this exact memory candidate." })),
    dedupeQuery: Type.Optional(Type.String({ description: "Optional query for similar-memory recall before storing. Defaults to content." })),
  }),
]);

export function registerMemoryTools(pi: ExtensionAPI) {
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
      const similar = await recallSimilar(decision.normalized.content, decision.normalized.tags, config).catch(err => "Similar recall failed: " + err);

      return {
        content: [{ type: "text" as const, text: formatProposal(decision.action, decision.reasons, decision.normalized, similar) }],
        details: { action: decision.action, reasons: decision.reasons, findings: decision.findings, candidate: decision.normalized },
        isError: decision.action === "block",
      };
    },
  });

  pi.registerTool({
    name: "automem_commit_memory",
    label: "AutoMem Commit Memory",
    description: "Store a policy-approved durable memory in AutoMem. Blocks secrets and risky categories; asks confirmation unless policy allows safe-auto or approvedByUser is true.",
    promptSnippet: "Use only after automem_propose_memory and explicit approval, unless policy returns safe-auto.",
    parameters: CommitParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: any) {
      const config = loadConfig();
      setAutoMemMcpServerName(config.mcpServerName);
      const candidate = toCandidate(params);
      const decision = evaluateWritePolicy(candidate, config);

      if (decision.action === "block") {
        return {
          content: [{ type: "text" as const, text: "Blocked by AutoMem write policy.\n" + decision.reasons.map(r => "- " + r).join("\n") }],
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

      const dedupeQuery = params.dedupeQuery || decision.normalized.content;
      const similar = await recallSimilar(dedupeQuery, decision.normalized.tags, config).catch(() => "");
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
        details: { result, candidate: decision.normalized, similarPreview: similar.slice(0, 1000) },
      };
    },
  });
}

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

async function recallSimilar(query: string, tags: string[], config: any): Promise<string> {
  if ((config.writePolicy as any).dedupeBeforeWrite === false) return "Dedupe recall disabled.";
  const result = await automemRecall(query, {
    limit: Number((config.writePolicy as any).dedupeLimit || 3),
    tags,
    tagMode: "any",
    contextTypes: ["Decision", "Pattern", "Preference", "Style", "Habit", "Insight", "Context"],
    expandRelations: false,
    expandEntities: false,
  });
  return result.content?.[0]?.text || "No similar memories found.";
}

function formatProposal(action: string, reasons: string[], candidate: MemoryCandidate, similar: string): string {
  return [
    "# AutoMem memory proposal",
    "",
    `Recommended action: ${action}`,
    reasons.length ? "\nReasons:\n" + reasons.map(r => "- " + r).join("\n") : "",
    "",
    "## Candidate",
    formatCandidate(candidate),
    "",
    "## Similar-memory check",
    similar.slice(0, 2000),
  ].filter(Boolean).join("\n");
}
