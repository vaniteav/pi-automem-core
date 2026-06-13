import type { AutoMemConfig, MemoryType } from "./config";
import { scanForSecrets, type SecretFinding } from "./secret-scan";

export type WriteMode = "off" | "propose" | "safe-auto" | "confirm-all";
export type WriteAction = "block" | "propose" | "confirm" | "auto";

export interface MemoryCandidate {
  content: string;
  type: MemoryType;
  tags: string[];
  importance: number;
  confidence?: number;
  source?: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyDecision {
  action: WriteAction;
  reasons: string[];
  findings: SecretFinding[];
  normalized: MemoryCandidate;
}

const VALID_TYPES = new Set(["Decision", "Pattern", "Preference", "Style", "Habit", "Insight", "Context"]);

export function normalizeCandidate(input: MemoryCandidate, config: AutoMemConfig): MemoryCandidate {
  const tags = Array.from(new Set([
    ...(config.writePolicy.alwaysTag || []),
    ...(input.tags || []),
  ].map(t => String(t).trim().toLowerCase()).filter(Boolean)));

  return {
    content: String(input.content || "").replace(/\s+/g, " ").trim(),
    type: input.type,
    tags,
    importance: clampNumber(input.importance, 0, 1, defaultImportanceForType(input.type)),
    confidence: clampNumber(input.confidence, 0, 1, 0.9),
    source: input.source || config.writePolicy.defaultSource || "pi-session",
    category: (input.category || inferCategory(input.type, tags)).toLowerCase(),
    metadata: input.metadata,
  };
}

export function evaluateWritePolicy(input: MemoryCandidate, config: AutoMemConfig): PolicyDecision {
  const normalized = normalizeCandidate(input, config);
  const reasons: string[] = [];
  // Scan content, tags, AND metadata — metadata is model-supplied (Type.Any)
  // and is stored verbatim, so a secret placed there must not bypass the scan.
  let metadataText = "";
  if (normalized.metadata) {
    try { metadataText = "\n" + JSON.stringify(normalized.metadata); } catch (_e) { /* unserializable */ }
  }
  const findings = scanForSecrets(normalized.content + "\n" + normalized.tags.join("\n") + metadataText);
  const mode = ((config.writePolicy as any).mode || "propose") as WriteMode;
  const preferredMax = config.behavior.preferredContentLength || 500;
  const hardMax = config.behavior.maxContentLength || 2000;
  const minImportance = Number((config.writePolicy as any).minImportanceToWrite ?? 0.7);

  if (mode === "off") reasons.push("write policy mode is off");
  if (!normalized.content) reasons.push("content is empty");
  if (!VALID_TYPES.has(normalized.type)) reasons.push("invalid memory type");
  if (normalized.content.length > hardMax) reasons.push("content exceeds hard length limit");
  if (findings.length > 0) reasons.push("secret/privacy scanner found blocked content");
  if (normalized.importance < minImportance) reasons.push("importance is below configured write threshold");
  if (isBlockedCategory(normalized, config)) reasons.push("category is blocked by write policy");

  if (reasons.length > 0) {
    return { action: "block", reasons, findings, normalized };
  }

  if (normalized.content.length > preferredMax) {
    reasons.push("content exceeds preferred embedding length; consider shortening before commit");
  }

  if (mode === "confirm-all") {
    return { action: "confirm", reasons: ["write policy requires confirmation for all memories", ...reasons], findings, normalized };
  }

  if (isConfirmCategory(normalized, config)) {
    return { action: "confirm", reasons: ["category requires user confirmation", ...reasons], findings, normalized };
  }

  if (mode === "safe-auto" && isAutoCategory(normalized, config)) {
    return { action: "auto", reasons: ["category is eligible for safe automatic write", ...reasons], findings, normalized };
  }

  return { action: "propose", reasons: ["candidate should be proposed for approval before storing", ...reasons], findings, normalized };
}

export function formatCandidate(candidate: MemoryCandidate): string {
  return (
    "Content: " + candidate.content + "\n" +
    "Type: " + candidate.type + "\n" +
    "Importance: " + candidate.importance + "\n" +
    "Tags: " + (candidate.tags.join(", ") || "(none)") + "\n" +
    "Category: " + (candidate.category || "(inferred)")
  );
}

function isBlockedCategory(candidate: MemoryCandidate, config: AutoMemConfig): boolean {
  const blocked = new Set((config.writePolicy.blockedCategories || []).map(c => c.toLowerCase()));
  return blocked.has(candidate.category || "") || candidate.tags.some(t => blocked.has(t));
}

function isConfirmCategory(candidate: MemoryCandidate, config: AutoMemConfig): boolean {
  const confirm = new Set((config.writePolicy.confirmCategories || []).map(c => c.toLowerCase()));
  return confirm.has(candidate.category || "") || candidate.tags.some(t => confirm.has(t));
}

function isAutoCategory(candidate: MemoryCandidate, config: AutoMemConfig): boolean {
  const auto = new Set((config.writePolicy.autoWriteCategories || []).map(c => c.toLowerCase()));
  return auto.has(candidate.category || "") || auto.has(candidate.type.toLowerCase()) || candidate.tags.some(t => auto.has(t));
}

function inferCategory(type: MemoryType, tags: string[]): string {
  if (tags.includes("preference")) return "preference";
  if (tags.includes("decision")) return "technical-decision";
  if (tags.includes("bug-fix")) return "bug-fix";
  if (tags.includes("pattern")) return "agent-pattern";
  if (tags.includes("private") || tags.includes("personal")) return "private";
  switch (type) {
    case "Decision": return "technical-decision";
    case "Preference": return "preference";
    case "Pattern": return "agent-pattern";
    case "Insight": return "tooling-lesson";
    default: return "context";
  }
}

function defaultImportanceForType(type: MemoryType): number {
  switch (type) {
    case "Decision": return 0.9;
    case "Preference": return 0.85;
    case "Pattern": return 0.8;
    case "Insight": return 0.8;
    case "Style": return 0.7;
    case "Habit": return 0.65;
    case "Context": return 0.6;
    default: return 0.5;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
