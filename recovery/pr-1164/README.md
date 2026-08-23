# PR #1164 recovery snapshot

Captured before importing or rebasing any visual-restore work.

- Source worktree: `/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/design-restore`
- Source branch: `design/restore-round-2`
- Remote relationship: local `070f3548c1e3581c7fb1fd557cca951a6efc38c3`; remote `origin/design/restore-round-2` at `106ef672e6ce8637e648d6c47e7018608d9c9f1a`
- Source branch is two local commits ahead of its remote; commit subjects are recorded in `local-commits.txt`.
- Source worktree had dirty tracked changes and untracked files recorded in `design-status.txt`, `dirty-tracked-status.txt`, and `untracked-paths.txt`.
- Root worktree had four unrelated-but-required dirty browser contracts: `e2e/web-a11y-axe.spec.ts`, `e2e/web-a11y-keyboard.spec.ts`, `e2e/web-runtime-config.spec.ts`, and `e2e/web-state-ownership.spec.ts`; their status and patch are in the parent recovery directory.
- Restorable tracked patch: `design-dirty-tracked.patch`.
- Restorable root E2E patch: `../root-e2e-four.patch`.
- Restorable copies of all untracked source/docs files: `untracked-snapshot/` with SHA-256 inventory in `untracked-sha256.txt`.
- Patch SHA-256 inventory: `patch-sha256.txt`.

No reset, clean, rebase, or source-worktree mutation was performed while taking this snapshot.

## Verification evidence

- Mutation probe (`apps/web/src/features/config/use-theme.ts`): inverted the
  hydration-adoption return guard; focused theme tests went red (4 failures in
  8 tests). Restored the guard with `apply_patch`; the same two test files went
  green (2 files, 8 tests).
- Browser screenshots in `screenshots/` cover Chat day (`390x844`), Chat
  settings/night (`1440x945` full-page), plus the real anime empty and
  route-detail empty journeys (`1280x900` each). The latter two are refreshed
  after the browser harness switched to TanStack's history state shape and
  waited for `.anime-empty` / `.route-panel`, so they are current target-surface
  evidence rather than the earlier SSR loader-error captures.

The #1179 recovery gates are recorded here so AC1/AC4 are reviewable from the
branch without relying on a local terminal:

| Gate | Command/result |
| --- | --- |
| Web typecheck | `apps/web`: `pnpm run typecheck` — pass |
| Web oxlint | `apps/web`: `pnpm run lint:oxlint` — pass |
| Web unit | Node 24: `pnpm exec vitest run --config vitest.config.ts --coverage --maxWorkers=1` — 269 files / 2,302 tests passed; 98.68/95.83/98.77/99.63 coverage |
| Web integration | Node 24: `pnpm exec vitest run --config vitest.integration.config.ts --maxWorkers=1` — 5 files / 22 tests passed |
| Browser axe + state | Chromium: `web-a11y-axe.spec.ts web-a11y-states.spec.ts` — 12 passed; zero serious/critical axe findings |
| Chat query + auth | Chromium: `web-hero-query.spec.ts web-neon-login.spec.ts` — 3 passed, 1 credential-gated skip |
| Select mutation | Changed Escape `dropdown.close(true)` to `dropdown.close()` — 1/19 Select tests red; restored — 19/19 green |

Current visual artifacts: [anime empty](screenshots/anime-empty-1280x900.png),
[route-detail empty](screenshots/route-detail-empty-1280x900.png), [Chat day](screenshots/chat-day-390x844.png),
and [Chat settings/night](screenshots/chat-settings-night-1440x900.png).

## Scope boundary: Shiori

Shiori is not a reachable browser surface in this recovery slice. The route tree
contains no Shiori route, and neither `/chat` nor the route-detail route imports a
Shiori component. The feature is currently covered only by unit tests under
`apps/web/tests/unit/shiori/`. This is explicitly outside PR #1164's
visual-restore surface; adding a synthetic URL or test-only mount here would not
prove a production journey. A future Shiori route ticket must add the production
entry point before it receives a browser journey.

Evidence captured with the branch:

```text
rg -n "ShioriGenerator|ShioriCard" apps/web/src/routes apps/web/src/features/chat apps/web/src/features/route-detail
# no matches
rg --files apps/web/src/routes | sort
# no shiori route
```
