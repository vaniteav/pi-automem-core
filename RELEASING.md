# Releasing

How to cut a release of `pi-automem-bridge`. This package is published to npm
and installed into pi via `pi install npm:pi-automem-bridge`.

## Principles

- **Notifications are pull + opt-in, by design.** The package never phones home,
  prints update notices, or runs network calls on load — that is an anti-pattern
  for a library/extension. Users learn about updates through SemVer, the
  changelog, and GitHub Releases (Watch → Releases, or the `releases.atom` feed),
  not through code baked into the package.
- **SemVer.** Patch = backward-compatible fixes; minor = backward-compatible
  features; major = breaking changes.
- **Tests never ship to npm.** They live in the repo (so the suite is runnable
  from a clone) but are excluded from the published tarball by the `files`
  allowlist in `package.json`. Always confirm with `npm pack --dry-run`.

## Steps

1. **Green check.** On a clean working tree:
   ```bash
   npm test            # unit + phase2-policy + review-fixes (offline)
   ```
   (Optional, needs a live AutoMem instance: `npm run test:smoke`, `npm run test:live`.)

2. **Bump the version** in `package.json` per SemVer, then sync the lockfile:
   ```bash
   npm install --package-lock-only
   ```

3. **Update `CHANGELOG.md`.** Add a new dated section at the top using the
   Keep a Changelog headings in order: `Added`, `Changed`, `Deprecated`,
   `Removed`, `Fixed`, `Security` (include only the ones that apply).

4. **Commit** the version bump + changelog:
   ```bash
   git commit -am "Release vX.Y.Z"
   ```

5. **Merge to `main`.** Prefer a merge that preserves the released commit
   (`--no-ff` or fast-forward) so the tag below lands on a commit that stays on
   `main`. If you squash-merge, create the tag on the squashed commit instead.

6. **Verify the tarball** is source-only (no tests, no internal docs):
   ```bash
   npm pack --dry-run
   ```

7. **Tag the released commit** (annotated):
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```

8. **Publish to npm:**
   ```bash
   npm publish
   ```
   (Requires `npm login` as the publishing account. Never use `--ignore-scripts`
   bypasses or commit npm tokens.)

9. **Push with the tag:**
   ```bash
   git push origin main --follow-tags
   ```

10. **Cut a GitHub Release** from the new tag and paste that version's
    `CHANGELOG.md` section as the release notes. This is what actually notifies
    watchers (email/web) and populates the `releases.atom` feed.

## Notes

- The README's npm-version and downloads badges reflect the published version
  automatically — no action needed.
- Downstream consumers who list this package in a scanned `package.json` may get
  Dependabot/Renovate PRs automatically once the new version is on npm; pi-managed
  installs generally will not, which is why the GitHub Release matters.
