import assert from "node:assert/strict";

import { registerMemoryTools } from "../src/tools/memory-tools";
import { automemDelete, automemRecall } from "../src/mcp-client";

function extractMemoryId(text: string): string | null {
  // Try JSON block first
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.memory_id || parsed.id || parsed.memoryId || null;
    } catch {
      // fall through
    }
  }
  // Fallback: UUID pattern after a known key
  const idMatch = text.match(/(?:memory_id|memoryId|id)["':\s]+([0-9a-fA-F-]{36})/i);
  return idMatch ? idMatch[1] : null;
}

async function main() {
  const tools: Record<string, any> = {};
  registerMemoryTools({
    registerTool(tool: any) {
      tools[tool.name] = tool;
    },
  } as any);

  assert.ok(tools.automem_propose_memory, "automem_propose_memory should be registered");
  assert.ok(tools.automem_commit_memory, "automem_commit_memory should be registered");
  assert.ok(tools.automem_update_memory, "automem_update_memory should be registered");

  const unique = "pi-automem-core live write cleanup " + Date.now();
  const content = `Temporary AutoMem live write test. ${unique}. This verifies commit and cleanup paths for the pi extension.`;

  // ── 1. Initial commit ────────────────────────────────────────────────────
  const commit = await tools.automem_commit_memory.execute("test", {
    content,
    type: "Context",
    tags: ["source:pi", "test:pi-automem-core", "cleanup-required"],
    importance: 0.75,
    category: "tooling-lesson",
    approvedByUser: true,
    dedupeQuery: "",          // skip dedupe for initial store
    metadata: { test_run: true, cleanup_required: true },
  });

  assert.ok(commit.content?.[0]?.text, "commit should return a tool response");
  assert.doesNotMatch(commit.content[0].text, /DUPLICATE_DETECTED/, "first commit should not detect a duplicate");
  assert.doesNotMatch(commit.content[0].text, /Blocked/, "first commit should not be blocked");

  // Recall the memory and get its ID
  let memoryId: string | null = null;
  try {
    const recall = await automemRecall(unique, { limit: 3, tags: ["test:pi-automem-core"], tagMode: "any" });
    const recallText = recall.content?.[0]?.text || "";
    assert.match(recallText, /Temporary AutoMem live write test/i, "stored memory should be recallable");
    memoryId = extractMemoryId(recallText);
    assert.ok(memoryId, "recall response should include memory ID for update/delete");

    // ── 2. Dedupe detection ─────────────────────────────────────────────────
    // Store same content again with dedupe enabled — should surface DUPLICATE_DETECTED
    const dedupeCommit = await tools.automem_commit_memory.execute("test", {
      content,
      type: "Context",
      tags: ["source:pi", "test:pi-automem-core"],
      importance: 0.75,
      category: "tooling-lesson",
      approvedByUser: true,
      dedupeQuery: unique,    // trigger dedupe against the memory we just stored
    });

    assert.match(
      dedupeCommit.content?.[0]?.text || "",
      /DUPLICATE_DETECTED/,
      "second commit with same content should return DUPLICATE_DETECTED",
    );
    assert.ok(dedupeCommit.details?.existingMemoryId, "DUPLICATE_DETECTED response should include existing memory ID");

    // ── 3. Update via commit updateMemoryId ─────────────────────────────────
    const updatedContent = content + " [updated]";
    const updateViaCommit = await tools.automem_commit_memory.execute("test", {
      content: updatedContent,
      type: "Context",
      tags: ["source:pi", "test:pi-automem-core", "cleanup-required"],
      importance: 0.75,
      category: "tooling-lesson",
      approvedByUser: true,
      updateMemoryId: memoryId,
    });

    assert.match(
      updateViaCommit.content?.[0]?.text || "",
      /Updated existing AutoMem memory/,
      "commit with updateMemoryId should confirm update, not a new store",
    );

    // ── 4. Update via standalone automem_update_memory ──────────────────────
    const directUpdate = await tools.automem_update_memory.execute("test", {
      memoryId,
      content: content + " [direct-update]",
      approvedByUser: true,
    });

    assert.match(
      directUpdate.content?.[0]?.text || "",
      /Updated AutoMem memory/,
      "automem_update_memory should confirm update",
    );

  } finally {
    // ── 5. Cleanup ────────────────────────────────────────────────────────
    if (memoryId) await automemDelete(memoryId);
  }

  const afterDelete = await automemRecall(unique, { limit: 3, tags: ["test:pi-automem-core"], tagMode: "any" });
  const afterText = afterDelete.content?.[0]?.text || "";
  assert.doesNotMatch(afterText, /Temporary AutoMem live write test/i, "memory should be gone after delete");

  console.log("Phase 2 live write test passed:");
  console.log("- committed memory (dedupe skipped)");
  console.log("- DUPLICATE_DETECTED on second commit with same content");
  console.log("- update via automem_commit_memory + updateMemoryId");
  console.log("- update via automem_update_memory directly");
  console.log("- cleanup: deleted test memory");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
