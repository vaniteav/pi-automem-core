/**
 * /automem-recall - Manual recall for debugging.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { automemRecall, setAutoMemMcpServerName } from "../mcp-client";
import { loadConfig } from "../config";

export function registerRecallCommand(pi: {
  registerCommand: (name: string, opts: {
    description: string;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  }) => void;
}) {
  pi.registerCommand("automem-recall", {
    description: "Manually query AutoMem: /automem-recall <query>",
    handler: async function(args: string, ctx: ExtensionCommandContext) {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /automem-recall <query>", "warning");
        return;
      }

      const config = loadConfig();
      setAutoMemMcpServerName(config.mcpServerName);

      try {
        const result = await automemRecall(query, {
          limit: config.startupRecall.limit,
          tags: config.startupRecall.tags,
          tagMode: config.startupRecall.tagMode,
        });

        const text = (result.content && result.content[0] && result.content[0].text)
          ? result.content[0].text
          : "(no results)";
        const preview = text.length > 500 ? text.slice(0, 500) + "..." : text;
        ctx.ui.notify('Results for "' + query + '":\n' + preview, "info");
      } catch (err) {
        ctx.ui.notify("Recall failed: " + err, "error");
      }
    },
  });
}
