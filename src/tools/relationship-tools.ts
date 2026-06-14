import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, type MemoryType } from "../config";
import { automemStore, automemAssociate, setAutoMemMcpServerName } from "../mcp-client";
import { evaluateWritePolicy, type MemoryCandidate } from "../write-policy";

const LinkParams = Type.Object({
  memoryId1: Type.String({ description: "ID of the first memory." }),
  memoryId2: Type.String({ description: "ID of the second memory." }),
  relationship: Type.String({ description: "Relationship type: RELATES_TO, LEADS_TO, OCCURRED_BEFORE, PREFERS_OVER, EXEMPLIFIES, CONTRADICTS, REINFORCES, INVALIDATED_BY, EVOLVED_INTO, DERIVED_FROM, PART_OF" }),
  strength: Type.Optional(Type.Number({ description: "Relationship weight 0–1. Default 0.5." })),
  approvedByUser: Type.Boolean({ description: "Must be true to execute. Prevents accidental linking." }),
});

const CorrectParams = Type.Object({
  memoryId: Type.String({ description: "ID of the memory being corrected." }),
  correction: Type.String({ description: "New correct content to store." }),
  type: Type.Optional(Type.String({ description: "Memory type for the new memory. Default: Context." })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for the new memory." })),
  importance: Type.Optional(Type.Number({ description: "Importance 0–1 for the new memory." })),
  relationship: Type.Optional(Type.String({ description: "EVOLVED_INTO or CONTRADICTS. Default: EVOLVED_INTO." })),
  approvedByUser: Type.Boolean({ description: "Must be true to execute." }),
});

export function registerRelationshipTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "automem_link_memories",
    label: "AutoMem Link Memories",
    description: "Create a typed relationship between two existing AutoMem memories.",
    promptSnippet: "Use after identifying that two memories are related. Requires both memory IDs and the relationship type.",
    parameters: LinkParams,
    async execute(_toolCallId: string, params: any) {
      const config = loadConfig();
      setAutoMemMcpServerName(config.mcpServerName);

      if (!params.approvedByUser) {
        return {
          content: [{ type: "text" as const, text: "Confirmation required before linking memories. Re-run with approvedByUser=true only after explicit user approval.\n\nWould link:\n  " + params.memoryId1 + " → " + params.relationship + " → " + params.memoryId2 }],
          isError: true,
        };
      }

      const strength = typeof params.strength === "number" ? params.strength : 0.5;
      const result = await automemAssociate(params.memoryId1, params.memoryId2, params.relationship, strength);
      const text = result.content?.[0]?.text || "Association created.";
      return {
        content: [{ type: "text" as const, text: "Linked " + params.memoryId1 + " → " + params.relationship + " → " + params.memoryId2 + " (strength: " + strength + ").\n\n" + text }],
        details: { memoryId1: params.memoryId1, memoryId2: params.memoryId2, relationship: params.relationship, strength },
      };
    },
  });

  pi.registerTool({
    name: "automem_correct_memory",
    label: "AutoMem Correct Memory",
    description: "Store a correction to an existing memory and link old → new with a provenance relationship. Preserves history; use automem_update_memory for simple in-place edits.",
    promptSnippet: "Use when a memory was wrong or outdated and you want to preserve history. Stores new content as a separate memory, then links old → EVOLVED_INTO/CONTRADICTS → new.",
    parameters: CorrectParams,
    async execute(_toolCallId: string, params: any) {
      const config = loadConfig();
      setAutoMemMcpServerName(config.mcpServerName);

      const candidate: MemoryCandidate = {
        content: params.correction,
        type: (params.type || "Context") as MemoryType,
        tags: Array.isArray(params.tags) ? params.tags : [],
        importance: params.importance,
      };
      const decision = evaluateWritePolicy(candidate, config);
      if (decision.action === "block") {
        return {
          content: [{ type: "text" as const, text: "Blocked by AutoMem write policy.\n" + decision.reasons.map((r: string) => "- " + r).join("\n") }],
          details: { action: decision.action, reasons: decision.reasons, findings: decision.findings },
          isError: true,
        };
      }

      if (!params.approvedByUser) {
        return {
          content: [{ type: "text" as const, text: "Confirmation required before correcting memory. Re-run with approvedByUser=true only after explicit user approval.\n\nWould correct memory " + params.memoryId + " with:\n  " + params.correction }],
          isError: true,
        };
      }

      const rel = params.relationship === "CONTRADICTS" ? "CONTRADICTS" : "EVOLVED_INTO";
      // Store the normalized candidate so corrections get the same alwaysTag,
      // source, and content normalization as every other write path.
      const storeResult = await automemStore(
        decision.normalized.content,
        decision.normalized.type,
        decision.normalized.tags,
        {
          source: decision.normalized.source,
          importance: decision.normalized.importance,
          confidence: decision.normalized.confidence,
          metadata: decision.normalized.metadata,
        },
      );

      const storeText = storeResult.content?.[0]?.text || "";
      const uuidMatch = storeText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

      if (!uuidMatch) {
        console.warn("[automem] automem_correct_memory: could not extract new memory ID from store response — skipping link");
        return {
          content: [{ type: "text" as const, text: "Stored correction (ID unknown — link not created). Store response: " + storeText.slice(0, 300) }],
          details: { storeText },
        };
      }

      const newId = uuidMatch[0];
      const assocResult = await automemAssociate(params.memoryId, newId, rel, 0.9);
      const assocText = assocResult.content?.[0]?.text || "Association created.";

      return {
        content: [{ type: "text" as const, text: "Stored correction as " + newId + ". Linked " + params.memoryId + " → " + rel + " → " + newId + ".\n\n" + assocText }],
        details: { originalId: params.memoryId, newId, relationship: rel },
      };
    },
  });
}
