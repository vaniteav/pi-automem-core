/**
 * mcp-client.ts - JSON-RPC client for AutoMem MCP sidecar.
 *
 * Reads connection info from pi's mcp.json (url + auth header).
 * All calls go through the MCP tools/call endpoint.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolveEnvVars } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface McpHealth {
  healthy: boolean;
  memoryCount?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// MCP config reader
// ---------------------------------------------------------------------------

function loadMcpServerConfig(serverName: string): { url: string; auth: string } {
  const mcpJsonPath = resolve(homedir(), ".pi", "agent", "mcp.json");

  if (!existsSync(mcpJsonPath)) {
    throw new Error("mcp.json not found at " + mcpJsonPath);
  }

  const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf8")) as {
    mcpServers?: Record<string, { url: string; headers?: Record<string, string> }>;
  };

  const server = mcpJson.mcpServers ? mcpJson.mcpServers[serverName] : undefined;
  if (!server) {
    const available = mcpJson.mcpServers ? Object.keys(mcpJson.mcpServers).join(", ") : "(none)";
    throw new Error('MCP server "' + serverName + '" not found. Available: ' + available);
  }

  return {
    url: server.url,
    auth: resolveEnvVars(server.headers?.Authorization || ""),
  };
}

// ---------------------------------------------------------------------------
// Response parsing — handles both JSON and text/event-stream (SSE)
// ---------------------------------------------------------------------------

async function parseJsonRpcResponse(resp: Response): Promise<any> {
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) {
    const text = await resp.text();
    // SSE lines are "data: <json>\n"; find the last non-empty data line
    const dataLine = text
      .split("\n")
      .map(function(l: string) { return l.trim(); })
      .filter(function(l: string) { return l.startsWith("data:") && l.length > 5; })
      .pop();
    if (!dataLine) throw new Error("SSE response contained no data lines");
    return JSON.parse(dataLine.slice(5).trim());
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// JSON-RPC client
// ---------------------------------------------------------------------------

let callId = 0;
let configuredServerName = process.env.AUTOMEM_MCP_SERVER || "automem";

export function setAutoMemMcpServerName(serverName: string | undefined): void {
  if (serverName && serverName.trim()) {
    const newName = serverName.trim();
    if (newName !== configuredServerName) {
      discoveredTools = null;
      configuredServerName = newName;
    }
  }
}

function getAutoMemMcpServerName(): string {
  return process.env.AUTOMEM_MCP_SERVER || configuredServerName || "automem";
}

async function mcpCall(tool: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const serverName = getAutoMemMcpServerName();
  const cfg = loadMcpServerConfig(serverName);

  const body = {
    jsonrpc: "2.0",
    id: ++callId,
    method: "tools/call",
    params: { name: tool, arguments: args },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.auth ? { Authorization: cfg.auth } : {}),
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(function() { return ""; });
      throw new Error("MCP HTTP " + resp.status + ": " + text.slice(0, 200));
    }

    const payload = (await parseJsonRpcResponse(resp)) as {
      result?: McpCallResult;
      error?: { code: number; message: string };
    };

    if (payload.error) {
      throw new Error("MCP error: " + payload.error.message);
    }

    return payload.result || { content: [] };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Tool discovery cache
// ---------------------------------------------------------------------------

let discoveredTools: Map<string, string> | null = null;

/**
 * Discover available tools from the MCP server via tools/list.
 * Returns a Map of normalized tool name → actual tool name.
 * Cached after first call.
 */
export async function discoverTools(): Promise<Map<string, string>> {
  if (discoveredTools) return discoveredTools;

  const serverName = getAutoMemMcpServerName();
  const cfg = loadMcpServerConfig(serverName);

  const body = {
    jsonrpc: "2.0",
    id: ++callId,
    method: "tools/list",
    params: {},
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.auth ? { Authorization: cfg.auth } : {}),
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error("MCP tools/list HTTP " + resp.status);
    }

    const payload = (await parseJsonRpcResponse(resp)) as {
      result?: { tools?: Array<{ name: string }> };
      error?: { code: number; message: string };
    };

    if (payload.error) {
      throw new Error("MCP tools/list error: " + payload.error.message);
    }

    const tools = payload.result?.tools || [];
    const map = new Map<string, string>();
    for (const t of tools) {
      map.set(t.name.toLowerCase(), t.name);
      // Also index without automem_ prefix for fuzzy matching
      if (t.name.toLowerCase().startsWith("automem_")) {
        map.set(t.name.toLowerCase().replace("automem_", ""), t.name);
      }
      // Also index with automem_ prefix for reverse lookups
      map.set("automem_" + t.name.toLowerCase(), t.name);
    }

    discoveredTools = map;
    console.log("[automem] discovered tools: " + Array.from(map.values()).join(", "));
    return map;
  } catch (err) {
    console.warn("[automem] tools/list failed, using default tool names: " + err);
    // Fallback: use actual server tool names (no automem_ prefix)
    discoveredTools = new Map<string, string>([
      ["recall_memory", "recall_memory"],
      ["automem_recall_memory", "recall_memory"],
      ["check_database_health", "check_database_health"],
      ["automem_check_database_health", "check_database_health"],
      ["store_memory", "store_memory"],
      ["automem_store_memory", "store_memory"],
      ["associate_memories", "associate_memories"],
      ["automem_associate_memories", "associate_memories"],
      ["update_memory", "update_memory"],
      ["automem_update_memory", "update_memory"],
      ["delete_memory", "delete_memory"],
      ["automem_delete_memory", "delete_memory"],
    ]);
    return discoveredTools;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve a logical tool name to the actual server tool name.
 * e.g. "recall_memory" → the actual server tool name discovered from tools/list.
 */
export function resolveToolName(logicalName: string): string {
  if (!discoveredTools) return logicalName;
  const key = logicalName.toLowerCase();
  return discoveredTools.get(key) || logicalName;
}

// ---------------------------------------------------------------------------
// AutoMem-specific wrappers
// ---------------------------------------------------------------------------

export async function automemRecall(
  query: string,
  options?: {
    limit?: number;
    tags?: string[];
    tagMode?: "any" | "all";
    contextTypes?: string[];
    expandRelations?: boolean;
    expandEntities?: boolean;
  },
): Promise<McpCallResult> {
  const args: Record<string, unknown> = {
    query,
    limit: options && options.limit ? options.limit : 8,
    tags: options && options.tags ? options.tags : [],
    tag_mode: options && options.tagMode ? options.tagMode : "any",
    expand_relations: options ? !!options.expandRelations : false,
    expand_entities: options ? !!options.expandEntities : false,
  };

  if (options && options.contextTypes && options.contextTypes.length > 0) {
    args.context_types = options.contextTypes;
  }

  return mcpCall(resolveToolName("recall_memory"), args);
}

export async function automemHealth(): Promise<McpHealth> {
  try {
    const result = await mcpCall(resolveToolName("check_database_health"), {});
    const text = result.content && result.content[0] ? result.content[0].text : undefined;
    if (text) {
      try {
        const parsed = JSON.parse(text);
        const count = parsed.memory_count !== undefined
          ? parsed.memory_count
          : (parsed.count !== undefined ? parsed.count : parsed.memories);
        return {
          healthy: true,
          memoryCount: typeof count === "number" ? count : undefined,
        };
      } catch (_e) {
        return { healthy: true };
      }
    }
    return { healthy: true };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

export async function automemStore(
  content: string,
  type: string,
  tags: string[],
  options?: {
    source?: string;
    confidence?: number;
    importance?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<McpCallResult> {
  const meta: Record<string, unknown> = {};
  if (options && options.source) meta.source = options.source;
  if (options && options.metadata) Object.assign(meta, options.metadata);

  return mcpCall(resolveToolName("store_memory"), {
    content,
    type,
    tags,
    confidence: options && options.confidence ? options.confidence : 0.8,
    importance: options && options.importance ? options.importance : 0.5,
    metadata: Object.keys(meta).length > 0 ? meta : undefined,
  });
}

export async function automemAssociate(
  memory1Id: string,
  memory2Id: string,
  relationship: string,
  strength: number = 0.5,
): Promise<McpCallResult> {
  return mcpCall(resolveToolName("associate_memories"), {
    memory1_id: memory1Id,
    memory2_id: memory2Id,
    type: relationship,
    strength,
  });
}

export async function automemUpdate(
  memoryId: string,
  updates: {
    content?: string;
    type?: string;
    tags?: string[];
    importance?: number;
    confidence?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<McpCallResult> {
  const args: Record<string, unknown> = { memory_id: memoryId };
  if (updates.content !== undefined) args.content = updates.content;
  if (updates.type !== undefined) args.type = updates.type;
  if (updates.tags !== undefined) args.tags = updates.tags;
  if (updates.importance !== undefined) args.importance = updates.importance;
  if (updates.confidence !== undefined) args.confidence = updates.confidence;
  if (updates.metadata !== undefined) args.metadata = updates.metadata;
  return mcpCall(resolveToolName("update_memory"), args);
}

export async function automemDelete(memoryId: string): Promise<McpCallResult> {
  return mcpCall(resolveToolName("delete_memory"), {
    memory_id: memoryId,
  });
}
