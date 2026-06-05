/**
 * config.ts - Config loading, defaults, validation, and env-var resolution.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryType =
  | "Decision"
  | "Pattern"
  | "Preference"
  | "Style"
  | "Habit"
  | "Insight"
  | "Context";

export type RelationshipType =
  | "RELATES_TO"
  | "LEADS_TO"
  | "OCCURRED_BEFORE"
  | "PREFERS_OVER"
  | "EXEMPLIFIES"
  | "CONTRADICTS"
  | "REINFORCES"
  | "INVALIDATED_BY"
  | "EVOLVED_INTO"
  | "DERIVED_FROM"
  | "PART_OF";

export interface AutoMemConfig {
  mcpServerName: string;
  startupRecall: {
    enabled: boolean;
    queries: string[];
    tags: string[];
    tagMode: "any" | "all";
    limit: number;
    maxBytes: number;
    showStatus: boolean;
  };
  turnRecall: {
    enabled: boolean;
    limit: number;
    maxBytes: number;
    contextTypes: MemoryType[];
    expandRelations: boolean;
    expandEntities: boolean;
  };
  projectDetection: {
    enabled: boolean;
    tagPrefix: string;
    folderTags: Record<string, string[]>;
    gitRepoToTag: Record<string, string>;
  };
  writePolicy: {
    autoWriteCategories: string[];
    confirmCategories: string[];
    blockedCategories: string[];
    defaultSource: string;
    machineTag: boolean;
    alwaysTag: string[];
  };
  vault: {
    canonical: boolean;
    vaultPath?: string;
    importTag?: string;
  };
  behavior: {
    injectSystemPrompt: boolean;
    displayRecall: "full" | "summary" | "hidden";
    maxContentLength: number;
    preferredContentLength: number;
  };
  viewer: {
    enabled: boolean;
    mode: "standalone" | "embedded";
    port: number;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: AutoMemConfig = {
  mcpServerName: "automem",
  startupRecall: {
    enabled: true,
    queries: ["user preferences working style environment"],
    tags: [],
    tagMode: "any",
    limit: 8,
    maxBytes: 6000,
    showStatus: true,
  },
  turnRecall: {
    enabled: true,
    limit: 6,
    maxBytes: 4000,
    contextTypes: ["Preference", "Decision", "Pattern", "Insight", "Context"],
    expandRelations: true,
    expandEntities: true,
  },
  projectDetection: {
    enabled: true,
    tagPrefix: "project:",
    folderTags: {},
    gitRepoToTag: {},
  },
  writePolicy: {
    autoWriteCategories: ["decision", "pattern", "insight", "context"],
    confirmCategories: ["career", "personal", "financial"],
    blockedCategories: ["secret", "credential", "api-key"],
    defaultSource: "pi-session",
    machineTag: true,
    alwaysTag: ["source:pi"],
  },
  vault: {
    canonical: false,
  },
  behavior: {
    injectSystemPrompt: true,
    displayRecall: "summary",
    maxContentLength: 2000,
    preferredContentLength: 500,
  },
  viewer: {
    enabled: false,
    mode: "standalone",
    port: 3000,
  },
};

// ---------------------------------------------------------------------------
// Config path resolution
// ---------------------------------------------------------------------------

export function resolveConfigPath(): string {
  const envPath = process.env.AUTOMEM_CONFIG_PATH;
  if (envPath) return resolve(envPath);
  return resolve(homedir(), ".pi", "agent", "automem.json");
}

// ---------------------------------------------------------------------------
// Env-var interpolation
// ---------------------------------------------------------------------------

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, function(_match: string, name: string) {
    const v = process.env[name];
    if (v === undefined) {
      console.warn('[automem] env var "' + name + '" referenced in config but not set');
      return "";
    }
    return v;
  });
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

function deepMerge(base: any, override: any): any {
  const result = Object.assign({}, base);
  const keys = Object.keys(override);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const bVal = (base as any)[key];
    const oVal = override[key];
    if (
      oVal !== undefined &&
      typeof oVal === "object" &&
      oVal !== null &&
      !Array.isArray(oVal) &&
      typeof bVal === "object" &&
      bVal !== null &&
      !Array.isArray(bVal)
    ) {
      (result as any)[key] = deepMerge(bVal, oVal);
    } else if (oVal !== undefined) {
      (result as any)[key] = oVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Load + validate
// ---------------------------------------------------------------------------

export function loadConfig(): AutoMemConfig {
  const configPath = resolveConfigPath();

  if (!existsSync(configPath)) {
    console.log("[automem] no config at " + configPath + ", using defaults");
    return DEFAULT_CONFIG;
  }

  let raw: any;
  try {
    const text = readFileSync(configPath, "utf8");
    raw = JSON.parse(text);
  } catch (err) {
    console.error("[automem] failed to read/parse config: " + err);
    return DEFAULT_CONFIG;
  }

  if (typeof raw !== "object" || raw === null) {
    console.error("[automem] config root must be an object, using defaults");
    return DEFAULT_CONFIG;
  }

  const config = deepMerge(DEFAULT_CONFIG, raw) as AutoMemConfig;

  if (config.startupRecall.limit < 1 || config.startupRecall.limit > 20) {
    console.warn("[automem] startupRecall.limit out of range (1-20), clamping to 8");
    config.startupRecall.limit = 8;
  }
  if (config.turnRecall.limit < 1 || config.turnRecall.limit > 20) {
    console.warn("[automem] turnRecall.limit out of range (1-20), clamping to 6");
    config.turnRecall.limit = 6;
  }

  return config;
}
