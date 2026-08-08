# Git daily-squash execution runbook (W8)

Execution + HITL runbook for the git history rewrite: fold `main` (~1820 commits,
~98 active days) into **one commit per Asia/Shanghai calendar day** (~98 commits),
tree-identical at every day boundary. Parent epics: #851 (HITL) · #857 (dry-run
script, landed) · #858 (this runbook).

> **This document is a runbook and checklist only. It does not execute anything.**
> Every command below is run manually by the **owner** after an explicit go/no-go.
> The day-fold history is built by `scripts/git-squash-daily.py`, which **never
> pushes** — all remote mutations in Phases 4–7 are owner actions.

## Status

**NOT EXECUTED.** Blocked on owner go/no-go, PR queue empty, and #829 waves done or
explicitly deferred (#858 AC). Dry-run evidence (2026-08-08, from #851 comment):

```text
ref: origin/main · days: 98 · new commits: 98 · trees identical (exit 0)
```

Dry-run branches produced (local-only, `dry-run/daily-squash-<ts>-<pid>` form):

- `dry-run/daily-squash-1786085045653230000-12528` → `daily squash 2026-08-07 (16 commits)`
- `dry-run/daily-squash-1786087051231951000-24176` → `daily squash 2026-08-07 (16 commits)`
- `dry-run/daily-squash-1786049424` / `-1786049437` / `-1786051170172324000-98193` → 2026-08-06 (67 commits)

## Tooling: `scripts/git-squash-daily.py`

| Fact | Value |
|---|---|
| Flags | `--repo <path>` (default cwd), `--ref <ref>` (default `origin/main`, else `main`) |
| Day boundary | `Asia/Shanghai` (hardcoded, fallback +08:00 if zoneinfo missing) |
| Synthetic commit | tree = that day's last commit tree; parent = previous day's synthetic commit; author/committer env copied from the day's last commit |
| Message | `daily squash YYYY-MM-DD (N commits)` |
| Output branch | local-only `refs/heads/dry-run/daily-squash-<time_ns>-<pid>` |
| Tree assertion | `git diff --quiet --exit-code <ref> <branch>` — exit 0 = identical |
| Exit codes | 0 OK · 1 no commits on ref · 2 trees differ · nonzero on invalid ref |
| Push | **none by design** — no push code path exists |

Run: `python3 scripts/git-squash-daily.py --repo . --ref origin/main`

## Phase 0 — Preconditions (owner)

- [ ] Owner declares **main frozen** (issue comment on #851 + repo announcement): no merges to `main` until rewrite lands
- [ ] PR queue empty (or every open PR explicitly deferred with owner sign-off): `gh pr list --state open`
- [ ] Zero worktrees against `main` on every local clone: `git worktree list` shows none referencing `main`
- [ ] All local clones notified (repo has 2 collaborators: `lifeodyssey` owner, `whisperrrr` — `gh api repos/lifeodyssey/animichi/collaborators`)
- [ ] No in-flight release depends on old SHAs (deploy uses `GITHUB_SHA` of its own run; nothing pins remote SHAs across runs — verified 2026-08-08)
- [ ] Tag policy decided (see Phase 6 — tags are **unprotected** today, none blocked: `gh api repos/lifeodyssey/animichi/tags/protection` → 404)
- [ ] Owner records `OLD_MAIN=$(git rev-parse origin/main)`

## Phase 1 — Backup (mirror + bundle + private archive repo)

AC: "Backup location recorded". Backup is **dual**: an offline `git bundle` file +
a private archive repo holding the full mirror.

1. Full mirror clone (all refs, all tags):
   ```bash
   git clone --mirror https://github.com/lifeodyssey/animichi /tmp/animichi-mirror-$(date +%Y%m%d)
   ```
2. Offline bundle from the mirror (survives even the archive repo being lost):
   ```bash
   git -C /tmp/animichi-mirror-$(date +%Y%m%d) bundle create \
     /tmp/animichi-main-backup-$(date +%Y%m%d).bundle --all
   ```
3. Create the private archive repo (owner, GitHub web or `gh`): name suggestion
   `lifeodyssey/animichi-pre-rewrite`, **Private**, empty (no README). New private
   repos ship with no rulesets, so `git push --mirror` force-writes are allowed to
   the owner/admin by default — if the org later adds rulesets, grant owner bypass
   or disable them for the archive repo.
4. Push the mirror there (mirror push keeps every ref and tag):
   ```bash
   git -C /tmp/animichi-mirror-$(date +%Y%m%d) remote add archive \
     https://github.com/lifeodyssey/animichi-pre-rewrite.git
   git -C /tmp/animichi-mirror-$(date +%Y%m%d) push --mirror archive
   ```
5. **Record the backup location** (repo path + bundle path + date) in a comment on
   #851/#858 and in the "Post-execution note" section below — this is the AC evidence.

## Phase 2 — Re-run dry-run on frozen main

- [ ] `git fetch origin && git checkout origin/main` (fresh worktree against frozen main)
- [ ] `python3 scripts/git-squash-daily.py --repo . --ref origin/main`
- [ ] Expect: `days: 98` · `new commits: 98` · `OK: diff origin/main dry-run/daily-squash-* empty — trees identical` · exit 0
- [ ] Spot-check 3 mid-history days: `git diff <dry-run-branch> origin/main` empty at
      each day boundary (script asserts tips; spot-check at day-tip trees):
      ```bash
      git rev-list --reverse --format='%H %ad' --date=short origin/main | grep -n 2026-0
      ```
- [ ] Note the dry-run branch name (`refs/heads/dry-run/daily-squash-<ts>-<pid>`)

## Phase 3 — Build `main-squashed`

- [ ] Promote the dry-run head to a working branch (script only writes `dry-run/*`):
      ```bash
      git branch main-squashed refs/heads/dry-run/daily-squash-<ts>-<pid>
      ```
- [ ] Independent re-verify before any push:
      ```bash
      git diff --quiet --exit-code origin/main main-squashed && echo TREES-IDENTICAL
      test "$(git rev-list --count main-squashed)" -eq 98 && echo COUNT-98
      ```

## Phase 4 — Publish

The repo ruleset **"protect main"** (id `19974534`, repository-level, active,
targets `~DEFAULT_BRANCH` i.e. `main` only) blocks `non_fast_forward` and
`deletion` on `main`. No org-level rulesets exist (checked 2026-08-08). Two paths:

### 4a — Branch swap (preferred, matches #851; no ruleset touching needed)

The ruleset follows the default branch, and `main-squashed` is unguarded while
`main` is default:

```bash
git push origin main-squashed                 # unguarded branch, normal push
gh repo edit --default-branch main-squashed   # ruleset moves to main-squashed
git push origin main:main-legacy              # keep full old history as a branch
git push origin --delete main                 # deletion now allowed (not default)
git push origin main-squashed:main            # name main is free again
git push origin --delete main-squashed
gh repo edit --default-branch main
```

Variant: skip the last three renames and keep `main-squashed` as the permanent
default branch (one less default flip). Only do this if the owner prefers it.

### 4b — In-place force-with-lease (only if 4a is rejected)

1. Confirm the rule: `gh ruleset view 19974534` → `non_fast_forward` + `deletion`.
2. Temporarily disable the ruleset (PATCH merges; only `enforcement` changes):
   ```bash
   gh api -X PATCH /repos/lifeodyssey/animichi/rulesets/19974534 -f enforcement=inactive
   ```
3. Ensure every clone fetched during freeze, then push **once**:
   ```bash
   git push --force-with-lease origin main-squashed:main
   # or pin the expectation explicitly:
   git push --force-with-lease=refs/remotes/origin/main:$OLD_MAIN origin main-squashed:main
   ```
4. Re-enable **immediately after the push** (do not close the window while off):
   ```bash
   gh api -X PATCH /repos/lifeodyssey/animichi/rulesets/19974534 -f enforcement=active
   ```
5. Verify protection is back: `gh ruleset check main` → `non_fast_forward` applied.

> `gh ruleset` has no edit subcommand — ruleset mutation goes through `gh api`.
> `--force-with-lease` refuses if `refs/remotes/origin/main` is stale or changed,
> which is exactly the safety we want after a freeze.

## Phase 5 — Verify

- [ ] **CI green on the new tip**: watch the `main` CI run to completion; all 32
      `required_status_checks` contexts green (lint/test/build per package, Quality
      invariants, Security suite — see `gh ruleset view 19974534`). CI keys on
      contexts, not SHAs, so nothing needs reconfiguration.
- [ ] **Staging redeploy** via normal promotion (`ci.yml` staging on the new tip),
      then smoke: `/healthz` returns 200.
      > **Caveat**: `/healthz` `git_commit`/`git_branch` are **always `"unknown"`**
      > in every deployed environment (#494 — Dockerfile never `COPY`s `.git`, so
      > `git rev-parse` fails). Do **not** use healthz to confirm the SHA. Confirm
      > the deployed SHA from the workflow itself: `pipeline-web.yml` gates
      > `META_COMMIT_SHA == GITHUB_SHA` at deploy, and
      > `npx wrangler@4.112.0 versions list --env staging` shows the new version.
- [ ] `main-legacy` exists and points at `$OLD_MAIN`
- [ ] `git diff origin/main main-legacy` empty (trees identical by construction)
- [ ] Post-rewrite tip tree == pre-rewrite tip tree (AC #851): `git diff origin/main main-legacy` empty proves it

## Phase 6 — Notify, cleanup, tag policy (owner; GH-4)

- [ ] Notify collaborators (`lifeodyssey`, `whisperrrr`) + any CI cache owners with
      the message template below
- [ ] Delete stale local refs on every clone:
      ```bash
      git fetch origin --prune
      git checkout main && git reset --hard origin/main
      git branch --list 'dry-run/daily-squash-*' | xargs -r git branch -D
      ```
- [ ] Open PRs: their base commits no longer exist in the new history — each must
      be **recreated** (cherry-pick onto new `main`, or reopen with a fresh branch);
      do not rebase blindly (old base is gone)
- [ ] Tag policy (no protected tags): **keep** tags — old commits stay reachable
      through `main-legacy`, so annotated/lightweight tags keep resolving; repoint
      or delete only on explicit owner decision (see `docs/ops/branch-tag-sweep-2026-08-05.md`
      for the inventory discipline: classify, then act)
- [ ] Delete the local dry-run branches after the swap is confirmed

Notification template:

```text
main history rewritten <DATE> (W8 daily squash, #851). Old tip <OLD_SHA>,
new tip <NEW_SHA>. Trees identical (end-of-day state preserved); only SHAs changed.
Action required on every clone: git fetch origin --prune; git checkout main;
git reset --hard origin/main. Open PRs must be recreated onto new main.
Full history is preserved on branch main-legacy (≥30 days) and in
lifeodyssey/animichi-pre-rewrite.
```

## Phase 7 — `main-legacy` retention (≥30 days) then cleanup

- [ ] Keep `main-legacy` **≥30 days** from the rewrite date (AC #858)
- [ ] After 30 days + owner approval, delete:
      ```bash
      gh api -X DELETE /repos/lifeodyssey/animichi/git/refs/heads/main-legacy
      ```
      (`main-legacy` is not the default branch, so the `deletion` rule does not
      apply.) Keep the mirror clone and the `.bundle` file for ≥90 days, then ask
      owner before deleting those too.

## Rollback (if CI is red or anything is wrong)

Same trees ⇒ restore is a ref flip, not content recovery:

- **From `main-legacy`** (fastest): disable ruleset per 4b, then
  `git push --force-with-lease origin main-legacy:main`, re-enable ruleset, flip
  default back if 4a was used.
- **From the archive repo**: `git clone --mirror https://github.com/lifeodyssey/animichi-pre-rewrite.git /tmp/restore && git -C /tmp/restore push --mirror origin`
- **From the bundle file** (last resort): `git bundle verify` then push from the
  restored refs.
- After restore: confirm `git diff origin/main main-legacy` empty, CI green on the
  restored tip, and only then consider deleting `main-squashed`.

Because the daily-fold keeps every day's end-of-day tree, **no content is ever at
risk** — rollback restores byte-identical trees.

## Known costs (accepted before go)

| Cost | Impact | Mitigation |
|---|---|---|
| Old SHAs invalidated | Links/PR comments referencing old SHAs 404; `git blame`/bisect for pre-rewrite commits is gone | `main-legacy` + archive repo keep old history queryable; note the new tip SHA in #851 |
| Codecov/Sonar baseline break | Coverage is keyed on commit SHA; first post-rewrite PRs have no patch baseline; `code_coverage` rule (min 90%, max drop 96) may flag on first runs | Run one merge on new `main` first to seed a baseline; treat first-run gate failures as re-baseline, not regressions |
| CI cache cold miss | Cache keys include SHA/branch; the first CI run after rewrite rebuilds from scratch | Accept one slower run; keep cache action config unchanged |
| Deploy SHA identity | Deploy embeds the *new* SHA in build metadata (`GIT_COMMIT` build arg, `META_COMMIT_SHA` gate); `/healthz` shows `unknown` regardless (#494) | Verify via workflow logs + `wrangler versions list`, not healthz |
| PR hygiene | Open PRs cannot rebase onto the new base; they must be recreated | Listed in Phase 6 before go |

Not a cost: content. Every day's end-of-day tree is preserved exactly; the diff
between old and new `main` is empty.

## Post-execution note (fill during execution)

```text
Rewritten: <DATE>
Old tip SHA: <OLD_MAIN>
New tip SHA: <NEW_SHA>
Backup: <archive repo URL> + <bundle path>
Path taken: swap / force-with-lease
CI on tip: green / red
main-legacy deletion due: <DATE + 30 days>
```

Also post the same one-liner on #851 ("history rewritten DATE; old tip SHA …" — AC).

## Reference

- Issues: #851 (parent HITL) · #857 (dry-run script, merged) · #858 (this) · #829 (waves) · #845 (migration baseline) · #494 (healthz SHA broken)
- Docs: `docs/ops/deployment.md` (deploy/rollback) · `docs/ops/branch-tag-sweep-2026-08-05.md` (ref inventory discipline) · `docs/ops/README.md` (repo scripts index)
- Ruleset: `gh ruleset view 19974534` ("protect main" — active, `~DEFAULT_BRANCH`)
