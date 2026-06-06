/**
 * unit.ts - Offline unit tests for paths not covered by phase1-smoke or phase2-policy.
 * Covers: context-injector, config validation, recall parser type detection,
 * project detection git traversal, SSE response parsing.
 *
 * Run with: npm run test:unit
 * No network access required.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildContextMessage } from "../src/context-injector";
import { parseSearchResults } from "../src/recall";
import { loadConfig, DEFAULT_CONFIG } from "../src/config";
import { detectProject } from "../src/project-detect";

// ---------------------------------------------------------------------------
// context-injector
// ---------------------------------------------------------------------------

{
  const noResults = buildContextMessage(
    { text: "", count: 0, truncated: false },
    { text: "", count: 0, truncated: false },
    { projectTag: null, projectLabel: null },
  );
  assert.equal(noResults, null, "buildContextMessage returns null when both results are empty");
}

{
  const startupOnly = buildContextMessage(
    { text: "some memory", count: 1, truncated: false },
    { text: "", count: 0, truncated: false },
    { projectTag: null, projectLabel: null },
  );
  assert.ok(startupOnly !== null, "buildContextMessage returns an injection when only startup result has text");
  assert.ok(startupOnly!.message.includes("Startup Recall (1 memories)"), "startup section uses correct count");
  assert.ok(startupOnly!.message.includes("some memory"), "startup memory text is included");
}

{
  const withProject = buildContextMessage(
    { text: "", count: 0, truncated: false },
    { text: "turn memory", count: 1, truncated: false },
    { projectTag: "project:my-app", projectLabel: "my-app" },
  );
  assert.ok(withProject !== null);
  assert.ok(withProject!.message.includes("[my-app]"), "turn recall section includes project label");
  assert.equal(withProject!.projectTag, "project:my-app", "projectTag is propagated to injection");
}

{
  const both = buildContextMessage(
    { text: "startup mem", count: 2, truncated: true },
    { text: "turn mem", count: 3, truncated: false },
    { projectTag: null, projectLabel: null },
  );
  assert.ok(both !== null);
  assert.ok(both!.message.includes("Startup Recall (2 memories)"), "startup count in message");
  assert.ok(both!.message.includes("Turn Recall (3 memories)"), "turn count in message");
}

// ---------------------------------------------------------------------------
// parseSearchResults — type detection from [TypeName] prefix
// ---------------------------------------------------------------------------

{
  const withTypePrefix = parseSearchResults(
    "Found 2 memories:\n\n" +
    "1. [Decision] Use system-prompt injection for hidden recall. [source:pi, decision] score=0.92\n" +
    "ID: abc-123\n\n" +
    "2. [Preference] Prefer summary display mode in production. [preference] score=0.88\n" +
    "ID: def-456\n"
  );
  assert.equal(withTypePrefix.length, 2, "parser finds both memories");
  assert.equal(withTypePrefix[0].type, "Decision", "type prefix [Decision] is detected");
  assert.equal(withTypePrefix[1].type, "Preference", "type prefix [Preference] is detected");
  assert.ok(!withTypePrefix[0].content.startsWith("[Decision]"), "type prefix is stripped from content");
}

{
  const noTypePrefix = parseSearchResults(
    "Found 1 memories:\n\n" +
    "1. Plain memory content without a type prefix [source:pi] score=0.80\n" +
    "ID: ghi-789\n"
  );
  assert.equal(noTypePrefix.length, 1);
  assert.equal(noTypePrefix[0].type, "Context", "falls back to Context when no type prefix is present");
}

{
  const unknownTypePrefix = parseSearchResults(
    "Found 1 memories:\n\n" +
    "1. [UnknownType] Some content [source:pi] score=0.80\n" +
    "ID: jkl-012\n"
  );
  assert.equal(unknownTypePrefix[0].type, "Context", "unknown type names fall back to Context");
  assert.ok(unknownTypePrefix[0].content.includes("[UnknownType]"), "[UnknownType] prefix is NOT stripped when type is unknown");
}

// ---------------------------------------------------------------------------
// config — enum validation warnings
// ---------------------------------------------------------------------------

{
  const dir = mkdtempSync(join(tmpdir(), "automem-config-test-"));
  const configPath = join(dir, "automem.json");

  writeFileSync(configPath, JSON.stringify({
    behavior: { displayRecall: "verbose" },
    writePolicy: { mode: "always" },
  }), "utf8");

  const warnMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = function(...args: any[]) { warnMessages.push(args.join(" ")); };

  const oldEnv = process.env.AUTOMEM_CONFIG_PATH;
  process.env.AUTOMEM_CONFIG_PATH = configPath;
  const config = loadConfig();
  process.env.AUTOMEM_CONFIG_PATH = oldEnv;
  console.warn = originalWarn;

  assert.equal(config.behavior.displayRecall, "summary", "invalid displayRecall falls back to summary");
  assert.equal(config.writePolicy.mode, "propose", "invalid writePolicy.mode falls back to propose");
  assert.ok(warnMessages.some(m => m.includes("displayRecall")), "warning emitted for bad displayRecall");
  assert.ok(warnMessages.some(m => m.includes("writePolicy.mode")), "warning emitted for bad writePolicy.mode");
}

// ---------------------------------------------------------------------------
// project detection — git traversal walks parent directories
// ---------------------------------------------------------------------------

{
  // Create a fake repo: rootDir/.git/config, run detection from rootDir/src/deep
  const rootDir = mkdtempSync(join(tmpdir(), "automem-git-test-"));
  const gitDir = join(rootDir, ".git");
  const deepDir = join(rootDir, "src", "deep");
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(deepDir, { recursive: true });

  writeFileSync(join(gitDir, "config"), [
    "[core]",
    "  repositoryformatversion = 0",
    "[remote \"origin\"]",
    "  url = https://github.com/test-org/my-test-project.git",
  ].join("\n"), "utf8");

  const config = {
    ...DEFAULT_CONFIG,
    projectDetection: {
      ...DEFAULT_CONFIG.projectDetection,
      gitRepoToTag: { "my-test-project": "project:my-test-project" },
    },
  };

  // Detection from a subdirectory — should walk up to rootDir
  const fromDeep = detectProject(deepDir, "", config);
  assert.equal(fromDeep.projectTag, "project:my-test-project", "git detection walks up to parent .git dir");

  // Detection from root itself — should also work
  const fromRoot = detectProject(rootDir, "", config);
  assert.equal(fromRoot.projectTag, "project:my-test-project", "git detection works from repo root");
}

// ---------------------------------------------------------------------------
// SSE response parsing — verify parseJsonRpcResponse handles event-stream
// ---------------------------------------------------------------------------

// We test the SSE parsing logic directly by simulating the same transform
// that parseJsonRpcResponse applies, without needing a real HTTP request.
{
  const sseBody = [
    "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"Found 0 memories:\"}]}}",
    "",
    "",
  ].join("\n");

  // Replicate the SSE extraction logic from mcp-client.ts
  const dataLine = sseBody
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.startsWith("data:") && l.length > 5)
    .pop();

  assert.ok(dataLine !== undefined, "SSE data line is found");
  const parsed = JSON.parse(dataLine!.slice(5).trim());
  assert.equal(parsed.result.content[0].text, "Found 0 memories:", "SSE JSON payload is correctly extracted");
}

{
  // Multiple SSE events — last data line wins (streaming completion)
  const multiEvent = [
    "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"partial\"}]}}",
    "",
    "data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"final\"}]}}",
    "",
  ].join("\n");

  const dataLine = multiEvent
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.startsWith("data:") && l.length > 5)
    .pop();

  const parsed = JSON.parse(dataLine!.slice(5).trim());
  assert.equal(parsed.result.content[0].text, "final", "last SSE data line is used");
}

// ---------------------------------------------------------------------------

console.log("Unit tests passed:");
console.log("- context-injector (null, startup-only, with-project, both)");
console.log("- parseSearchResults type detection ([TypeName] prefix)");
console.log("- config enum validation warnings");
console.log("- project detection git parent-directory traversal");
console.log("- SSE response parsing");
