/**
 * review-fixes.ts - Offline regression tests for issues found in the
 * 2026-06-13 whole-codebase review. No network: global fetch is mocked and
 * HOME/USERPROFILE is pointed at a temp dir holding a fake mcp.json so the real
 * mcp-client code path runs end to end.
 *
 * Run with: npx tsx tests/review-fixes.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Test harness: temp home + mocked fetch
// ---------------------------------------------------------------------------

// Point homedir() at a temp dir with a minimal mcp.json BEFORE importing the
// mcp-client (loadMcpServerConfig reads homedir() per call, so env is enough).
const home = mkdtempSync(join(tmpdir(), "automem-review-"));
mkdirSync(join(home, ".pi", "agent"), { recursive: true });
writeFileSync(
  join(home, ".pi", "agent", "mcp.json"),
  JSON.stringify({ mcpServers: { automem: { url: "http://test.local/mcp", headers: {} } } }),
  "utf8",
);
process.env.USERPROFILE = home;
process.env.HOME = home;
delete process.env.AUTOMEM_MCP_SERVER;
delete process.env.AUTOMEM_CONFIG_PATH;

interface CapturedCall { url: string; tool: string; args: any }
const calls: CapturedCall[] = [];

// handler(tool, args) -> the JSON-RPC `result` object to return
type Handler = (tool: string, args: any) => any;
let handler: Handler = () => ({ content: [{ type: "text", text: "Found 0 memories:" }] });
let fetchDelayMs = 0;

(globalThis as any).fetch = function(url: string, init: any) {
  const body = JSON.parse(init.body);
  const tool = body?.params?.name || body?.method || "";
  const args = body?.params?.arguments || {};
  calls.push({ url: String(url), tool, args });
  const result = handler(tool, args);
  const respond = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  if (fetchDelayMs <= 0) return Promise.resolve(respond());
  // Honor the AbortSignal so a short request timeout cancels the slow response.
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(respond()), fetchDelayMs);
    if (init.signal) {
      init.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    }
  });
};
function setDelay(ms: number) { fetchDelayMs = ms; }

function reset(h: Handler) { calls.length = 0; handler = h; }

(async () => {
// Imports must come after the fetch + env setup above.
const { automemHealth } = await import("../src/mcp-client");
const { turnRecall } = await import("../src/recall");
const { evaluateWritePolicy } = await import("../src/write-policy");
const { registerRelationshipTools } = await import("../src/tools/relationship-tools");
const { DEFAULT_CONFIG } = await import("../src/config");

// ---------------------------------------------------------------------------
// #1 — mcpCall must surface tool-level isError, not report it as healthy
// ---------------------------------------------------------------------------

{
  reset(() => ({ content: [{ type: "text", text: "database unreachable" }], isError: true }));
  const health = await automemHealth();
  assert.equal(
    health.healthy,
    false,
    "automemHealth reports unhealthy when the MCP tool result has isError:true",
  );
}

// ---------------------------------------------------------------------------
// #2 — turn recall must filter by a normalized (lowercased) project tag so it
//      matches the lowercased tags the write path stores
// ---------------------------------------------------------------------------

{
  reset(() => ({ content: [{ type: "text", text: "Found 0 memories:" }] }));
  await turnRecall(
    "do the thing",
    { projectTag: "project:TheCommonplace", projectLabel: "TheCommonplace" },
    DEFAULT_CONFIG,
  );
  const recallCall = calls.find(c => c.tool === "recall_memory");
  assert.ok(recallCall, "turn recall issued a recall_memory call");
  assert.deepEqual(
    recallCall!.args.tags,
    ["project:thecommonplace"],
    "turn recall filters by the lowercased project tag",
  );
}

// ---------------------------------------------------------------------------
// #3 — automem_correct_memory must store the normalized candidate (alwaysTag,
//      collapsed whitespace), not the raw params
// ---------------------------------------------------------------------------

{
  reset((tool) => {
    if (tool === "store_memory") {
      return { content: [{ type: "text", text: "Stored. ID: 550e8400-e29b-41d4-a716-446655440000" }] };
    }
    return { content: [{ type: "text", text: "Linked." }] };
  });

  const tools: Record<string, any> = {};
  registerRelationshipTools({ registerTool(t: any) { tools[t.name] = t; } } as any);

  await tools["automem_correct_memory"].execute(
    "tid",
    {
      memoryId: "old-id",
      correction: "Corrected   the    thing",
      tags: ["MyTag"],
      importance: 0.9,
      approvedByUser: true,
    },
  );

  const storeCall = calls.find(c => c.tool === "store_memory");
  assert.ok(storeCall, "correct_memory issued a store_memory call");
  assert.equal(
    storeCall!.args.content,
    "Corrected the thing",
    "correct_memory stores normalized (whitespace-collapsed) content",
  );
  assert.ok(
    Array.isArray(storeCall!.args.tags) && storeCall!.args.tags.includes("source:pi"),
    "correct_memory stores the normalized tags including alwaysTag source:pi",
  );
}

// ---------------------------------------------------------------------------
// #4 — secret scan must inspect metadata, not just content + tags
// ---------------------------------------------------------------------------

{
  const decision = evaluateWritePolicy(
    {
      content: "A perfectly innocuous decision about caching.",
      type: "Decision",
      tags: [],
      importance: 0.9,
      metadata: { note: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
    },
    DEFAULT_CONFIG,
  );
  assert.equal(decision.action, "block", "a secret hidden in metadata is blocked by write policy");
  assert.ok(
    decision.findings.some(f => f.kind === "github-token"),
    "the metadata secret is reported as a github-token finding",
  );
}

// ---------------------------------------------------------------------------
// #5 — truncated must reflect whether memories were dropped from the budget,
//      not byteLength >= maxBytes (which formatMemoriesForContext never reaches)
// ---------------------------------------------------------------------------

{
  const { startupRecall } = await import("../src/recall");
  const fourMemories =
    "Found 4 memories:\n\n" +
    "1. First memory with a reasonably long body to consume budget [a] score=0.9\nID: id-1\n\n" +
    "2. Second memory with a reasonably long body to consume budget [b] score=0.8\nID: id-2\n\n" +
    "3. Third memory with a reasonably long body to consume budget [c] score=0.7\nID: id-3\n\n" +
    "4. Fourth memory with a reasonably long body to consume budget [d] score=0.6\nID: id-4\n";

  reset(() => ({ content: [{ type: "text", text: fourMemories }] }));
  const small = { ...DEFAULT_CONFIG, startupRecall: { ...DEFAULT_CONFIG.startupRecall, maxBytes: 120 } };
  const truncatedResult = await startupRecall(small);
  assert.equal(truncatedResult.truncated, true, "truncated is true when memories are dropped from the byte budget");

  reset(() => ({ content: [{ type: "text", text: fourMemories }] }));
  const big = { ...DEFAULT_CONFIG, startupRecall: { ...DEFAULT_CONFIG.startupRecall, maxBytes: 100000 } };
  const fullResult = await startupRecall(big);
  assert.equal(fullResult.truncated, false, "truncated is false when every memory fits");
}

// ---------------------------------------------------------------------------
// #7 — git detection must examine all remotes, not just the first one
// ---------------------------------------------------------------------------

{
  const { detectProject } = await import("../src/project-detect");
  const repo = mkdtempSync(join(tmpdir(), "automem-git2-"));
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "config"), [
    "[remote \"origin\"]",
    "  url = https://github.com/someone/a-fork.git",
    "[remote \"upstream\"]",
    "  url = https://github.com/org/target-repo.git",
  ].join("\n"), "utf8");

  const cfg = {
    ...DEFAULT_CONFIG,
    projectDetection: {
      ...DEFAULT_CONFIG.projectDetection,
      gitRepoToTag: { "target-repo": "project:target" },
    },
  };
  const detected = detectProject(repo, "", cfg);
  assert.equal(detected.projectTag, "project:target", "git detection matches a non-first remote's url");
}

// ---------------------------------------------------------------------------
// #8 — config merge must not let a __proto__ key rebind the config's prototype
// ---------------------------------------------------------------------------

{
  const { loadConfig } = await import("../src/config");
  const dir = mkdtempSync(join(tmpdir(), "automem-proto-"));
  const configPath = join(dir, "automem.json");
  writeFileSync(configPath, '{"__proto__":{"polluted":true}}', "utf8");

  const old = process.env.AUTOMEM_CONFIG_PATH;
  process.env.AUTOMEM_CONFIG_PATH = configPath;
  const cfg = loadConfig();
  process.env.AUTOMEM_CONFIG_PATH = old;

  assert.equal(
    Object.getPrototypeOf(cfg),
    Object.prototype,
    "a __proto__ key in config does not rebind the merged object's prototype",
  );
}

// ---------------------------------------------------------------------------
// #9 — turn recall must abort on its own short timeout and return empty,
//      rather than blocking the prompt for the full default MCP timeout
// ---------------------------------------------------------------------------

{
  const twoMemories =
    "Found 2 memories:\n\n" +
    "1. some memory [a] score=0.9\nID: id-x\n\n" +
    "2. another memory [b] score=0.8\nID: id-y\n";
  reset(() => ({ content: [{ type: "text", text: twoMemories }] }));
  setDelay(500);

  const cfg = { ...DEFAULT_CONFIG, turnRecall: { ...DEFAULT_CONFIG.turnRecall, timeoutMs: 50 } };
  const start = Date.now();
  const r = await turnRecall("hello there", { projectTag: null, projectLabel: null }, cfg);
  const elapsed = Date.now() - start;

  assert.equal(r.count, 0, "turn recall returns empty when recall exceeds turnRecall.timeoutMs");
  assert.ok(elapsed < 400, "turn recall returned well before the 500ms response would have resolved");
  setDelay(0);
}

// ---------------------------------------------------------------------------
// Codex round 2 — fixes to the fixes
// ---------------------------------------------------------------------------

// C1 [HIGH] — mcp.json edits must be picked up despite per-server caching
{
  reset(() => ({ content: [{ type: "text", text: '{"memory_count":1}' }] }));
  await automemHealth(); // primes the cache against the original url

  const mcpPath = join(home, ".pi", "agent", "mcp.json");
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { automem: { url: "http://changed.local/mcp", headers: {} } } }), "utf8");
  const future = new Date(Date.now() + 10000);
  utimesSync(mcpPath, future, future); // ensure a distinct mtime

  calls.length = 0;
  await automemHealth();
  assert.equal(
    calls[calls.length - 1].url,
    "http://changed.local/mcp",
    "an in-place mcp.json edit is picked up despite caching",
  );
  // restore for any later url-agnostic tests
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { automem: { url: "http://test.local/mcp", headers: {} } } }), "utf8");
  const later = new Date(Date.now() + 20000);
  utimesSync(mcpPath, later, later);
}

// C2 [HIGH] — a single memory larger than maxBytes is truncated to fit, and flagged
{
  const { startupRecall } = await import("../src/recall");
  const huge = "x".repeat(600);
  const oneHuge = "Found 1 memories:\n\n1. " + huge + " [t] score=0.9\nID: id-h\n";
  reset(() => ({ content: [{ type: "text", text: oneHuge }] }));
  const cfg = { ...DEFAULT_CONFIG, startupRecall: { ...DEFAULT_CONFIG.startupRecall, maxBytes: 100 } };
  const r = await startupRecall(cfg);
  assert.equal(r.truncated, true, "a single oversized memory marks the result truncated");
  assert.ok(Buffer.byteLength(r.text, "utf8") <= 100, "an oversized memory is truncated to the byte budget");
}

// C3 [MED] — startup recall honors startupRecall.timeoutMs
{
  const { startupRecall } = await import("../src/recall");
  reset(() => ({ content: [{ type: "text", text: "Found 1 memories:\n\n1. m [t] score=0.9\nID: id-s\n" }] }));
  setDelay(500);
  const cfg = { ...DEFAULT_CONFIG, startupRecall: { ...DEFAULT_CONFIG.startupRecall, timeoutMs: 50 } };
  const start = Date.now();
  const r = await startupRecall(cfg);
  const elapsed = Date.now() - start;
  assert.equal(r.count, 0, "startup recall returns empty when it exceeds startupRecall.timeoutMs");
  assert.ok(elapsed < 400, "startup recall aborted on its short timeout");
  setDelay(0);
}

// C4 [MED] — automemStore preserves an explicit zero confidence/importance
{
  const { automemStore } = await import("../src/mcp-client");
  reset(() => ({ content: [{ type: "text", text: "Stored." }] }));
  await automemStore("content", "Decision", ["t"], { confidence: 0, importance: 0 });
  const storeCall = calls.find(c => c.tool === "store_memory");
  assert.ok(storeCall, "automemStore issued a store_memory call");
  assert.equal(storeCall!.args.confidence, 0, "explicit zero confidence is preserved, not defaulted");
  assert.equal(storeCall!.args.importance, 0, "explicit zero importance is preserved, not defaulted");
}

// C5 [MED] — tool discovery is re-run when mcp.json changes on disk
{
  const { discoverTools } = await import("../src/mcp-client");
  const mcpPath = join(home, ".pi", "agent", "mcp.json");

  reset((tool) => tool === "tools/list"
    ? { tools: [{ name: "recall_memory" }, { name: "store_memory" }] }
    : { content: [{ type: "text", text: "ok" }] });

  await discoverTools(); // first discovery
  const firstListCalls = calls.filter(c => c.tool === "tools/list").length;

  // repoint the same server name to a different backend
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { automem: { url: "http://repointed.local/mcp", headers: {} } } }), "utf8");
  const future = new Date(Date.now() + 30000);
  utimesSync(mcpPath, future, future);

  await discoverTools(); // should re-discover, not serve the stale cache
  const secondListCalls = calls.filter(c => c.tool === "tools/list").length;

  assert.ok(
    secondListCalls > firstListCalls,
    "discoverTools re-runs after mcp.json changes on disk (stale tool map invalidated)",
  );
}

// C6 [LOW] — a same-mtime rewrite that changes the file size is still detected
{
  const mcpPath = join(home, ".pi", "agent", "mcp.json");
  reset(() => ({ content: [{ type: "text", text: '{"memory_count":1}' }] }));

  const fixed = new Date(Date.now() + 50000);
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { automem: { url: "http://a.local/mcp", headers: {} } } }), "utf8");
  utimesSync(mcpPath, fixed, fixed);
  calls.length = 0;
  await automemHealth(); // primes cache against a.local at mtime `fixed`
  assert.equal(calls[calls.length - 1].url, "http://a.local/mcp", "primed against a.local");

  // rewrite with a longer url but force the SAME mtime tick
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: { automem: { url: "http://a-much-longer-host.local/mcp/endpoint", headers: {} } } }), "utf8");
  utimesSync(mcpPath, fixed, fixed);
  calls.length = 0;
  await automemHealth();
  assert.equal(
    calls[calls.length - 1].url,
    "http://a-much-longer-host.local/mcp/endpoint",
    "a same-mtime rewrite is still detected via file size",
  );
}

console.log("Review-fix regression tests passed:");
console.log("- #1 mcpCall surfaces tool-level isError (health reports unhealthy)");
console.log("- #2 turn recall filters by lowercased project tag");
console.log("- #3 correct_memory stores the normalized candidate");
console.log("- #4 secret scan inspects metadata");
console.log("- #5 truncated reflects dropped memories");
console.log("- #7 git detection examines all remotes");
console.log("- #8 config merge ignores __proto__");
console.log("- #9 turn recall honors a short timeout");
console.log("- C1 mcp.json edits picked up despite cache");
console.log("- C2 oversized single memory truncated + flagged");
console.log("- C3 startup recall honors its timeout");
console.log("- C4 automemStore preserves explicit zero scores");
console.log("- C5 tool discovery re-runs on mcp.json change");
console.log("- C6 same-mtime rewrite detected via file size");
})().catch(e => { console.error(e); process.exit(1); });
