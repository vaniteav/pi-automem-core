#!/usr/bin/env node
/**
 * preflight.mjs — the release gate.
 *
 * Runs every pre-ship check in one place, in order, and FAILS THE PUBLISH if
 * any gate fails. Wired into `prepublishOnly`, so `npm publish` cannot proceed
 * unless every check passes. This is the enforcement that replaces "remember to
 * check X" — the toolchain blocks a bad release instead of us catching it after.
 *
 * Run manually any time:  npm run preflight
 * Runs automatically on:   npm publish  (via prepublishOnly)
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();

let failed = 0;
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.error("  ✗ " + m); failed++; };

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

// Patterns that must NEVER appear in shipped files. The tarball is src-only, so
// test fixtures (synthetic sk-/ghp- strings live in tests/, which don't ship)
// won't false-positive here — we scan exactly what goes public.
const SECRET_PII = [
  { kind: "personal email", re: /[a-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|proton(mail)?|icloud)\.[a-z]+/i },
  { kind: "real name / handle leak", re: /janiceftw|\bjanice\b/i },
  { kind: "windows username path", re: /\bjanic\b|C:\\Users/i },
  { kind: "unix home path", re: /\/home\/[a-z]|\/Users\/[a-z]/i },
  { kind: "private infra (railway/automem prod)", re: /railway\.app|mcp-automem-production/i },
  { kind: "hostname", re: /BATTLESTATION/ },
  { kind: "openai key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: "github token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { kind: "aws key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "literal bearer token", re: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
];

console.log("\nPreflight gate for " + pkg.name + "@" + pkg.version + "\n");

// 1. Clean working tree -------------------------------------------------------
try {
  const dirty = sh("git status --porcelain");
  if (dirty) fail("working tree is dirty — commit or stash before releasing:\n" + dirty);
  else pass("working tree clean");
} catch { fail("could not run git status"); }

// 2. HEAD commit does not expose a personal email -----------------------------
try {
  const emails = sh("git log -1 --format=%ce%n%ae").split("\n");
  const leak = emails.find((e) => /@(gmail|outlook|hotmail|yahoo|proton|icloud)/i.test(e));
  if (leak) fail("HEAD commit exposes a personal email (" + leak + ") — use the GitHub noreply");
  else pass("HEAD commit email is privacy-safe (" + emails.join(", ") + ")");
} catch { fail("could not read HEAD commit email"); }

// 3. CHANGELOG has an entry for this version ----------------------------------
try {
  const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
  if (!new RegExp("^##\\s*" + pkg.version.replace(/\./g, "\\."), "m").test(changelog))
    fail("CHANGELOG.md has no '## " + pkg.version + "' section");
  else pass("CHANGELOG.md documents " + pkg.version);
} catch { fail("could not read CHANGELOG.md"); }

// 4. Version is not already published -----------------------------------------
try {
  const published = sh("npm view " + pkg.name + " version");
  if (published === pkg.version) fail("version " + pkg.version + " is already published — bump it");
  else pass("version " + pkg.version + " is new (published latest: " + published + ")");
} catch { console.log("  ~ skipped published-version check (npm view unavailable / offline)"); }

// 5. Tarball excludes tests + internal docs -----------------------------------
let tarballFiles = [];
try {
  const out = JSON.parse(sh("npm pack --dry-run --json"));
  tarballFiles = (out[0]?.files || []).map((f) => f.path);
  const forbidden = tarballFiles.filter((p) =>
    /^tests\//.test(p) || /^(RELEASING|PLAN|CONTRIBUTING)\.md$/.test(p) || /^docs\//.test(p) || /^scripts\//.test(p),
  );
  if (forbidden.length) fail("tarball includes files that should not ship: " + forbidden.join(", "));
  else pass("tarball is clean (" + tarballFiles.length + " files, src-only)");
} catch (e) { fail("could not compute tarball contents: " + e.message); }

// 6. No secrets / PII in any shipped file -------------------------------------
try {
  const textFiles = tarballFiles.filter((p) => !/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$/i.test(p));
  const hits = [];
  for (const rel of textFiles) {
    const abs = resolve(root, rel);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, "utf8");
    for (const { kind, re } of SECRET_PII) {
      const m = content.match(re);
      if (m) hits.push(rel + ": " + kind + " (" + m[0].slice(0, 40) + ")");
    }
  }
  if (hits.length) fail("secret/PII scan found issues in shipped files:\n    " + hits.join("\n    "));
  else pass("no secrets / PII in shipped files (" + textFiles.length + " scanned)");
} catch (e) { fail("secret/PII scan errored: " + e.message); }

// 7. Tests pass ---------------------------------------------------------------
try {
  execSync("npm test", { cwd: root, stdio: "pipe" });
  pass("offline test suite green");
} catch { fail("npm test failed — fix before releasing"); }

// Verdict ---------------------------------------------------------------------
if (failed) {
  console.error("\nPREFLIGHT FAILED — " + failed + " gate(s) blocking release.\n");
  process.exit(1);
}
console.log("\nPreflight passed. Safe to publish.\n");
