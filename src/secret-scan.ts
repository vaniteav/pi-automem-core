export interface SecretFinding {
  kind: string;
  match: string;
}

const SECRET_PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  { kind: "private-key", regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/i },
  { kind: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i },
  { kind: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { kind: "openai-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "secret-assignment", regex: /\b(?:api[_-]?key|token|secret|password|passwd|credential)\b\s*[:=]\s*['\"]?[^\s'\"]{8,}/i },
  { kind: "connection-string", regex: /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s]+/i },
];

export function scanForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match && match[0]) {
      findings.push({ kind: pattern.kind, match: redact(match[0]) });
    }
  }
  return findings;
}

export function hasSecrets(text: string): boolean {
  return scanForSecrets(text).length > 0;
}

function redact(value: string): string {
  if (value.length <= 12) return "[redacted]";
  return value.slice(0, 6) + "…" + value.slice(-4);
}
