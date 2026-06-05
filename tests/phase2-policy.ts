import assert from "node:assert/strict";

import { DEFAULT_CONFIG, type AutoMemConfig } from "../src/config";
import { scanForSecrets } from "../src/secret-scan";
import { evaluateWritePolicy } from "../src/write-policy";
import { registerMemoryTools } from "../src/tools/memory-tools";

function testConfig(overrides: Partial<AutoMemConfig> = {}): AutoMemConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    writePolicy: {
      ...DEFAULT_CONFIG.writePolicy,
      ...(overrides.writePolicy || {}),
    },
    behavior: {
      ...DEFAULT_CONFIG.behavior,
      ...(overrides.behavior || {}),
    },
  };
}

const durableDecision = {
  content: "Hidden recall uses system-prompt injection. Message injection can leak into API transcripts. This prevents chat clutter while preserving model context.",
  type: "Decision" as const,
  tags: ["project:memory-extension", "decision"],
  importance: 0.9,
  category: "technical-decision",
};

const proposed = evaluateWritePolicy(durableDecision, testConfig());
assert.equal(proposed.action, "propose", "default mode should propose rather than auto-write");
assert.ok(proposed.normalized.tags.includes("source:pi"), "default source tag should be added");

const safeAuto = evaluateWritePolicy(durableDecision, testConfig({ writePolicy: { ...DEFAULT_CONFIG.writePolicy, mode: "safe-auto" } }));
assert.equal(safeAuto.action, "auto", "safe-auto mode should allow configured low-risk categories");

const confirmPrivate = evaluateWritePolicy({
  ...durableDecision,
  category: "private",
  tags: ["private"],
}, testConfig({ writePolicy: { ...DEFAULT_CONFIG.writePolicy, mode: "safe-auto" } }));
assert.equal(confirmPrivate.action, "confirm", "private category should require confirmation even in safe-auto mode");

const blockedLowImportance = evaluateWritePolicy({
  ...durableDecision,
  importance: 0.2,
}, testConfig());
assert.equal(blockedLowImportance.action, "block", "low-importance candidates should be blocked");

const secretFindings = scanForSecrets("Use Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");
assert.ok(secretFindings.length > 0, "bearer token should be detected");

const blockedSecret = evaluateWritePolicy({
  ...durableDecision,
  content: "Store API key: sk-abcdefghijklmnopqrstuvwxyz1234567890",
}, testConfig());
assert.equal(blockedSecret.action, "block", "secret-like content should be blocked");
assert.ok(blockedSecret.findings.length > 0, "blocked secret should include findings");

const registered: string[] = [];
registerMemoryTools({
  registerTool(tool: any) {
    registered.push(tool.name);
  },
} as any);
assert.deepEqual(registered.sort(), ["automem_commit_memory", "automem_propose_memory"], "Phase 2 tools should register");

console.log("Phase 2 policy tests passed:");
console.log("- propose by default");
console.log("- safe-auto only for configured low-risk categories");
console.log("- confirmation for private categories");
console.log("- low-importance and secrets blocked");
console.log("- write tools register");
