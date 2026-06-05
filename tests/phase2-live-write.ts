import assert from "node:assert/strict";

import { registerMemoryTools } from "../src/tools/memory-tools";
import { automemDelete, automemRecall } from "../src/mcp-client";

function extractMemoryId(text: string): string | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.memory_id || parsed.id || parsed.memoryId || null;
    } catch {
      // fall through
    }
  }
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

  const unique = "pi-automem-core live write cleanup " + Date.now();
  const content = `Temporary AutoMem live write test. ${unique}. This verifies commit and cleanup paths for the pi extension.`;

  const commit = await tools.automem_commit_memory.execute("test", {
    content,
    type: "Context",
    tags: ["source:pi", "test:pi-automem-core", "cleanup-required"],
    importance: 0.75,
    category: "tooling-lesson",
    approvedByUser: true,
    dedupeQuery: unique,
    metadata: { test_run: true, cleanup_required: true },
  });

  assert.ok(commit.content?.[0]?.text, "commit should return a tool response");

  let memoryId: string | null = null;
  try {
    const recall = await automemRecall(unique, { limit: 3, tags: ["test:pi-automem-core"], tagMode: "any" });
    const recallText = recall.content?.[0]?.text || "";
    assert.match(recallText, /Temporary AutoMem live write test/i, "temporary memory should be recallable before cleanup");
    memoryId = extractMemoryId(recallText);
    assert.ok(memoryId, "recall should include memory ID for cleanup");
  } finally {
    if (memoryId) await automemDelete(memoryId);
  }

  const afterDelete = await automemRecall(unique, { limit: 3, tags: ["test:pi-automem-core"], tagMode: "any" });
  const afterText = afterDelete.content?.[0]?.text || "";
  assert.doesNotMatch(afterText, /Temporary AutoMem live write test/i, "temporary memory should be deleted after cleanup");

  console.log("Phase 2 live write test passed:");
  console.log("- committed temporary memory through automem_commit_memory");
  console.log("- recalled it by unique text/tag");
  console.log("- deleted it successfully");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
