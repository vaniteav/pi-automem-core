# Releasing

How to cut a release of `pi-automem-bridge` **in order, with nothing caught after ship.**

The hard-won lesson: a checklist you have to *remember* gets done out of order and
things slip through both before and after publish. So the critical checks are
**enforced by a gate** (`scripts/preflight.mjs`), wired into `prepublishOnly` —
**`npm publish` physically cannot run unless every gate passes.** Follow the
order below; the gate is the backstop, not a substitute for it.

## What the gate enforces (automatic, on every `npm publish`)

`npm run preflight` (and `prepublishOnly`) blocks the release unless ALL pass:

1. **Working tree is clean** — no uncommitted changes.
2. **HEAD commit email is privacy-safe** — a GitHub noreply, never a personal email.
3. **CHANGELOG has a `## <version>` entry** matching `package.json`.
4. **README updated since the last release** — npm shows the *published* README,
   so behavior changes must ship an updated README in the same publish, not
   after. (Override `ALLOW_STALE_README=1` only when a release genuinely needs no
   README change.)
5. **Version is not already published** — forces a bump.
6. **Tarball is src-only** — no `tests/`, `scripts/`, `RELEASING.md`, `docs/`, etc.
7. **No secrets / PII in any shipped file** — scans the actual tarball contents
   (personal email, real name/username, real paths, Railway/AutoMem-prod URLs,
   hostnames, API keys, tokens, private keys, literal bearer tokens).
8. **Offline test suite is green.**

Run it manually any time: `npm run preflight`.

## Release steps (in order)

1. **Branch + implement** the change. Commit per logical unit. Confirm your git
   email is a noreply (`git config user.email` → `…@users.noreply.github.com`).

2. **External review BEFORE the costly step.** Run a fresh Codex review over the
   whole branch (`/codex:rescue`, `--fresh --wait`). Fix findings TDD and
   re-review to APPROVE. This is the layer that catches the cross-file and
   "regression I introduced while fixing" classes — it belongs *before* tag and
   publish, not after.

3. **Bump the version** in `package.json` per SemVer (patch = fixes, minor =
   features, major = breaking), then `npm install --package-lock-only`.

4. **Update `CHANGELOG.md` AND `README.md` together.** Changelog: new dated
   section at the top using Keep a Changelog headings in order (`Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` — only the ones that
   apply). README: reflect any new/changed config, tools, commands, or behavior
   **before** publishing — npm displays the published version's README.

5. **Commit** the bump + changelog (`Release vX.Y.Z`).

6. **Dry-run the gate:** `npm run preflight`. Fix anything it flags. Do not
   proceed until it prints "Preflight passed."

7. **Merge to `main`** with `--no-ff` (or fast-forward) so the released commit —
   and the tag below — stays on `main`. If you squash-merge, tag the squashed
   commit.

8. **Tag the released commit:** `git tag -a vX.Y.Z -m "vX.Y.Z"`.

9. **Publish:** `npm publish`. The gate runs automatically via `prepublishOnly`;
   if it fails, the publish aborts — fix and retry. (Requires `npm login`. Never
   use `--ignore-scripts` to bypass the gate.)

10. **Push with the tag:** `git push origin main --follow-tags`.

11. **Cut a GitHub Release** from the new tag; paste that version's `CHANGELOG.md`
    section as the notes. This is the channel that actively notifies watchers
    (Watch → Releases) and the `releases.atom` feed.

12. **Post-ship verify:** `npm view pi-automem-bridge version` shows the new
    version; the GitHub Release page exists; `gh release view vX.Y.Z`.

## Notes

- **Tests never ship to npm.** They're tracked in the repo (runnable from a
  clone) but excluded from the tarball by the `files` allowlist — the gate
  re-verifies this every publish.
- **Notifications are pull + opt-in by design.** The package never phones home or
  prints update notices (an anti-pattern for a library). Users update via
  `pi update` (or `pi update npm:pi-automem-bridge`) and learn about releases
  through SemVer, the changelog, and the GitHub Release.
- **The README's npm copy only refreshes on the next publish.** A README edit is
  live on GitHub immediately on push, but npm shows the README from the last
  published version.
- **Email privacy:** all commits use the GitHub noreply
  (`273684110+vaniteav@users.noreply.github.com`); the gate fails the release if
  HEAD exposes a personal email. To stop leaks at the source, enable GitHub
  Settings → Emails → "Keep my email addresses private" + "Block command line
  pushes that expose my email."
