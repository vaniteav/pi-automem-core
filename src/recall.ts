/**
 * recall.ts - Startup and turn-level recall logic.
 *
 * Queries AutoMem, formats results, and enforces byte budgets.
 */

import { automemRecall } from "./mcp-client";
import type { AutoMemConfig } from "./config";
import type { ProjectDetection } from "./project-detect";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export interface FormattedMemory {
  id: string;
  type: string;
  content: string;
  tags: string[];
  score?: number;
}

export function parseSearchResults(text: string): FormattedMemory[] {
  if (!text || !text.trim()) return [];

  // Try JSON array first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(function(item: any) {
        return {
          id: item.id || item.memory_id || "",
          type: item.type || item.memory_type || "Context",
          content: item.content || item.text || "",
          tags: Array.isArray(item.tags) ? item.tags : [],
          score: item.score !== undefined ? item.score : (item.similarity !== undefined ? item.similarity : undefined),
        };
      });
    }
  } catch (_e) {
    // Not JSON array
  }

  // AutoMem MCP returns human-readable text like:
  // Found 2 memories:
  //
  // 1. Memory content [tag1, tag2] score=0.812
  // ID: uuid
  if (/^Found\s+\d+\s+memories:/i.test(text.trim())) {
    const memories: FormattedMemory[] = [];
    const lines = text.split("\n");
    let current: string[] = [];

    function flushCurrent() {
      if (current.length === 0) return;
      const raw = current.join("\n").trim();
      if (!raw) return;

      const idMatch = raw.match(/(?:^|\n)ID:\s*([^\s]+)/i);
      const scoreMatch = raw.match(/\bscore=([0-9.]+)/i);
      const firstLine = raw.split("\n")[0] || raw;
      const content = firstLine
        .replace(/^\d+\.\s*/, "")
        .replace(/\s+score=[0-9.]+\s*$/i, "")
        .trim();
      const tagMatch = content.match(/\[([^\]]+)\]\s*$/);
      const tags = tagMatch
        ? tagMatch[1].split(",").map(function(t: string) { return t.trim(); }).filter(Boolean)
        : [];
      const cleanContent = tagMatch ? content.slice(0, tagMatch.index).trim() : content;

      // AutoMem's human-readable format doesn't reliably include type info.
      // Some versions prefix content with [TypeName]; detect it if present.
      const KNOWN_TYPES = new Set(["Decision", "Pattern", "Preference", "Style", "Habit", "Insight", "Context"]);
      const typePrefix = cleanContent.match(/^\[([A-Za-z]+)\]\s*/);
      const detectedType = (typePrefix && KNOWN_TYPES.has(typePrefix[1])) ? typePrefix[1] : "Context";
      const finalContent = (typePrefix && KNOWN_TYPES.has(typePrefix[1]))
        ? cleanContent.slice(typePrefix[0].length)
        : cleanContent;

      memories.push({
        id: idMatch ? idMatch[1] : "",
        type: detectedType,
        content: finalContent,
        tags,
        score: scoreMatch ? Number(scoreMatch[1]) : undefined,
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\d+\.\s+/.test(line.trim())) {
        flushCurrent();
        current = [line.trim()];
      } else if (current.length > 0) {
        current.push(line.trim());
      }
    }
    flushCurrent();

    return memories;
  }

  // Try newline-delimited JSON; fall back to one memory per nonempty line.
  const lines = text.split("\n").filter(function(l: string) { return l.trim().length > 0; });
  const memories: FormattedMemory[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const item = JSON.parse(lines[i]);
      memories.push({
        id: item.id || item.memory_id || "",
        type: item.type || item.memory_type || "Context",
        content: item.content || item.text || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        score: item.score !== undefined ? item.score : (item.similarity !== undefined ? item.similarity : undefined),
      });
    } catch (_e) {
      if (lines[i].trim()) {
        memories.push({
          id: "",
          type: "Context",
          content: lines[i].trim(),
          tags: [],
        });
      }
    }
  }

  return memories;
}

function formatMemoriesForContext(memories: FormattedMemory[], maxBytes: number): string {
  const lines: string[] = [];
  let bytes = 0;

  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    const tagStr = mem.tags.length > 0 ? " (" + mem.tags.join(", ") + ")" : "";
    const entry = "[" + mem.type + "] " + mem.content + tagStr;
    const entryBytes = Buffer.byteLength(entry, "utf8") + 1;

    if (bytes + entryBytes > maxBytes && lines.length > 0) {
      break;
    }

    lines.push(entry);
    bytes += entryBytes;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Startup recall
// ---------------------------------------------------------------------------

export interface RecallResult {
  text: string;
  count: number;
  truncated: boolean;
}

export async function startupRecall(config: AutoMemConfig): Promise<RecallResult> {
  if (!config.startupRecall.enabled) {
    return { text: "", count: 0, truncated: false };
  }

  const allMemories: FormattedMemory[] = [];
  const seenIds = new Set<string>();

  for (let q = 0; q < config.startupRecall.queries.length; q++) {
    const query = config.startupRecall.queries[q];
    try {
      const result = await automemRecall(query, {
        limit: config.startupRecall.limit,
        tags: config.startupRecall.tags,
        tagMode: config.startupRecall.tagMode,
      });

      const text = result.content && result.content[0] ? result.content[0].text || "" : "";
      const memories = parseSearchResults(text);
      for (let i = 0; i < memories.length; i++) {
        const mem = memories[i];
        if (mem.id && !seenIds.has(mem.id)) {
          seenIds.add(mem.id);
          allMemories.push(mem);
        } else if (!mem.id) {
          const key = mem.content.slice(0, 80);
          if (!seenIds.has(key)) {
            seenIds.add(key);
            allMemories.push(mem);
          }
        }
      }
    } catch (err) {
      console.warn('[automem] startup recall query failed: "' + query + '" - ' + err);
    }
  }

  const maxBytes = config.startupRecall.maxBytes;
  const text = formatMemoriesForContext(allMemories, maxBytes);
  const truncated = Buffer.byteLength(text, "utf8") >= maxBytes && allMemories.length > 0;

  return { text, count: allMemories.length, truncated };
}

// ---------------------------------------------------------------------------
// Turn-level recall
// ---------------------------------------------------------------------------

export async function turnRecall(
  prompt: string,
  project: ProjectDetection,
  config: AutoMemConfig,
): Promise<RecallResult> {
  if (!config.turnRecall.enabled) {
    return { text: "", count: 0, truncated: false };
  }

  const query = project.projectLabel
    ? prompt + " " + project.projectLabel
    : prompt;

  const tags: string[] = [];
  if (project.projectTag) {
    tags.push(project.projectTag);
  }

  const recallConfig = (project.projectTag && config.projectOverrides && config.projectOverrides[project.projectTag])
    ? { ...config.turnRecall, ...config.projectOverrides[project.projectTag] }
    : config.turnRecall;

  try {
    const result = await automemRecall(query, {
      limit: recallConfig.limit,
      tags: tags.length > 0 ? tags : undefined,
      tagMode: "any",
      contextTypes: recallConfig.contextTypes as unknown as string[],
      expandRelations: recallConfig.expandRelations,
      expandEntities: recallConfig.expandEntities,
    });

    const text = result.content && result.content[0] ? result.content[0].text || "" : "";
    const memories = parseSearchResults(text);
    const formatted = formatMemoriesForContext(memories, recallConfig.maxBytes);
    const truncated = Buffer.byteLength(formatted, "utf8") >= recallConfig.maxBytes && memories.length > 0;

    return { text: formatted, count: memories.length, truncated };
  } catch (err) {
    console.warn("[automem] turn recall failed: " + err);
    return { text: "", count: 0, truncated: false };
  }
}
