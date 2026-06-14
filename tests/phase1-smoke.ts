import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

import extension from "../src/index";
import { loadConfig } from "../src/config";
import { automemHealth, automemRecall, setAutoMemMcpServerName } from "../src/mcp-client";
import { detectProject } from "../src/project-detect";
import { startupRecall } from "../src/recall";

type DisplayMode = "hidden" | "summary" | "full";
type Handler = (event: any, ctx: any) => Promise<any> | any;

function makeTempConfig(displayRecall: DisplayMode) {
  const base = loadConfig();
  const config = {
    ...base,
    startupRecall: {
      ...base.startupRecall,
      queries: ["pi automem core extension phase 1"],
      tags: [],
      tagMode: "any",
      limit: 1,
      maxBytes: 1200,
      showStatus: false,
    },
    turnRecall: {
      ...base.turnRecall,
      limit: 1,
      maxBytes: 1200,
    },
    projectDetection: {
      ...base.projectDetection,
      folderTags: {
        projects: ["project"],
      },
      gitRepoToTag: {
        "sample-app": "project:sample-app",
      },
    },
    behavior: {
      ...base.behavior,
      displayRecall,
    },
  };

  const dir = mkdtempSync(join(tmpdir(), "automem-phase1-"));
  const path = join(dir, "automem.json");
  writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  return path;
}

async function runExtensionOnce(displayRecall: DisplayMode) {
  const oldConfigPath = process.env.AUTOMEM_CONFIG_PATH;
  process.env.AUTOMEM_CONFIG_PATH = makeTempConfig(displayRecall);

  const handlers: Record<string, Handler[]> = {};
  const pi = {
    on(name: string, handler: Handler) {
      handlers[name] ||= [];
      handlers[name].push(handler);
    },
    registerCommand() {
      // Commands are registered by extension startup; command behavior is covered separately.
    },
    registerTool() {
      // Phase 2 tools are covered by policy tests; ignore in Phase 1 harness.
    },
  };

  extension(pi as any);

  const notifications: Array<{ message: string; level: string }> = [];
  const statuses: Record<string, string> = {};
  const ctx = {
    cwd: "/workspace/projects/sample-app",
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setStatus(key: string, value: string) {
        statuses[key] = value;
      },
      theme: {
        fg(_name: string, value: string) {
          return value;
        },
      },
    },
  };

  try {
    for (const handler of handlers.session_start || []) {
      await handler({}, ctx);
    }

    let result: any;
    for (const handler of handlers.before_agent_start || []) {
      result = await handler({ prompt: "AutoMem Phase 1 smoke test", systemPrompt: "BASE" }, ctx);
    }

    return { result, notifications, statuses };
  } finally {
    if (oldConfigPath === undefined) delete process.env.AUTOMEM_CONFIG_PATH;
    else process.env.AUTOMEM_CONFIG_PATH = oldConfigPath;
  }
}

async function main() {
  const config = loadConfig();
  setAutoMemMcpServerName(config.mcpServerName);

  const health = await automemHealth();
  assert.equal(health.healthy, true, "AutoMem health should be healthy");
  assert.equal(typeof health.memoryCount, "number", "health should include memory count");

  const recall = await automemRecall("pi automem core extension phase 1", { limit: 1 });
  const recallText = recall.content?.[0]?.text || "";
  assert.match(recallText, /Found\s+\d+\s+memories:/i, "manual recall should return AutoMem text");

  const startup = await startupRecall({
    ...config,
    startupRecall: {
      ...config.startupRecall,
      queries: ["pi automem core extension phase 1"],
      tags: [],
      tagMode: "any",
      limit: 1,
      maxBytes: 1200,
    },
  });
  assert.equal(startup.count, 1, "parser should count one numbered AutoMem memory, not line fragments");
  assert.doesNotMatch(startup.text, /\nID:\s/i, "formatted context should not leak raw ID lines");

  const projectConfig = {
    ...config,
    projectDetection: {
      ...config.projectDetection,
      folderTags: { projects: ["project"] },
      gitRepoToTag: { "sample-app": "project:sample-app" },
    },
  };

  const projectFromFolder = detectProject("/workspace/projects", "irrelevant prompt", projectConfig);
  assert.equal(projectFromFolder.projectTag, "project", "folder project detection should be case-insensitive");

  const projectFromPrompt = detectProject("/workspace", "work on sample-app settings", projectConfig);
  assert.equal(projectFromPrompt.projectTag, "project:sample-app", "prompt project detection should work");

  const hidden = await runExtensionOnce("hidden");
  assert.ok(hidden.result?.systemPrompt?.includes("AutoMem"), "hidden mode should inject system prompt context");
  assert.equal(hidden.result?.message, undefined, "hidden mode should not inject a session message");

  const summary = await runExtensionOnce("summary");
  assert.ok(summary.result?.systemPrompt?.includes("AutoMem"), "summary mode should inject system prompt context");
  assert.equal(summary.result?.message, undefined, "summary mode should not inject a session message");
  assert.ok(summary.notifications.some(n => n.message.includes("AutoMem recalled")), "summary mode should notify compactly");

  const full = await runExtensionOnce("full");
  assert.ok(full.result?.message?.content?.includes("AutoMem"), "full mode should inject a visible message");
  assert.equal(full.result?.message?.display, true, "full mode message should be visible");
  assert.equal(full.result?.systemPrompt, undefined, "full mode should not use hidden system prompt injection");

  console.log("Phase 1 smoke tests passed:");
  console.log("- health + manual recall");
  console.log("- AutoMem text parser");
  console.log("- project detection");
  console.log("- hidden / summary / full display modes");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
