# Repository force-push policy: all branches protected, owner-authorized rewrites only

The skeleton-refactor campaign force-pushed feature branches continuously (`rebase + push --force-with-lease`), and the history-rewrite wave (restructure W6 + GOAL W8) will force-push `main`. The GitHub ruleset `protect main` already blocks force-push on the default branch; feature branches were unprotected.

## Decision

- The `non_fast_forward` and `deletion` rules extend to **all branches** (ruleset pattern `*`), with **bypass actors = owner only** (`lifeodyssey`).
- Daily workflow no longer uses local force-push: updating a feature branch against `main` is `git merge origin/main` + a normal push; PRs merge via GitHub rebase-merge (linear history is already enforced by `required_linear_history`).
- A rewrite (W8 daily-squash, restructure W6 binary strip, or any forced update) is executed only inside the approved **history-rewrite window**: freeze declaration → double backup (git bundle + private archive repo) → rewrite → force-push as owner bypass → CI green + staging re-deploy evidence → `main-legacy` retained ≥30 days. The runbook is `docs/ops/git-daily-squash-runbook.md`.
- `--no-verify` pushes are not technically blockable server-side; CI remains the terminal gate (it runs the same checks the local hooks run), and the policy is documented here and in the runbook.

## Why

- Force-push races and rebase churn cost real time during the campaign; a protected-by-default posture is the industry baseline.
- The rewrite window needs a single, documented, auditable exception path instead of ad-hoc force-pushes.

## Consequences

- All future branch updates use merge (or `gh pr update-branch`); `git push --force-with-lease` is only valid with explicit owner approval (recorded in the runbook checklist).
- The ruleset gains bypass actors; org-level rulesets are not required.
- Hooks: pre-push continues to run local gates; CI (`required_status_checks`) is unchanged.
