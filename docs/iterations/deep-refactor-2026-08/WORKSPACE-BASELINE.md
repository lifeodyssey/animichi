# Working-copy baseline — 2026-08-10

This is a time-stamped operational snapshot for the deep-refactor spec. It is not a substitute for Git: refresh it before implementation or cleanup. No secret values are recorded here.

## Authoritative base

Both active clones were fetched explicitly on 2026-08-10. The current remote base is `origin/main` at `b94c30ab`. Planning changes are isolated in `/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/deep-refactor-spec` on `codex/deep-refactor-spec`; it started clean from that base and now contains only this planning diff. Neither existing `main` checkout is the source for the spec and ADR changes.

## Clone and directory map

| Path | Role | Branch / HEAD | State at capture | Authority |
|---|---|---|---|---|
| `/Users/lumimamini/Documents/Seichijunrei-agent` | Daily clone root | `main` at `1bcd5906`, three commits behind fetched `origin/main` | Clean | Do not implement here until deliberately updated |
| `/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/deep-refactor-spec` | Isolated planning worktree | `codex/deep-refactor-spec` from `b94c30ab` | Dirty only with the current planning/doc diff | Current planning/doc worktree |
| `/Users/lumimamini/work/animichi` | Previous campaign clone root | `main` at `1bcd5906`, three commits behind fetched `origin/main` | Dirty: three tracked workflow edits and one untracked 2026-08-09 handoff | Preserve; never use the whole checkout as a source tree |
| `/Users/lumimamini/work/animichi-wts` | Parent directory for campaign worktrees | 35 registered auxiliary worktrees | Every auxiliary worktree clean | Post-merge evidence; not a new implementation base |
| `/Users/lumimamini/animichi-work` | Old July clone | `main` at `02cd7fa0` | Root and two registered worktrees clean but obsolete | Abandoned; not a source of current code |
| `/Users/lumimamini/Documents/Seichijunrei-agent-worktrees` | Unused directory | — | Empty | Not registered Git worktrees |

Across the three clones there are 41 registered worktrees after creating the planning worktree: 36 in the campaign clone, two in the daily clone, and three in the abandoned clone. Before this planning diff, forty were clean and only the campaign root was dirty. At publication time, the planning worktree is the second dirty checkout by design; all other worktrees remain clean, and none are locked or prunable. The two active `main` checkouts are missing `c2e01507`, `3f91e33c`, and `b94c30ab`.

## Campaign worktree audit

The campaign clone contains its root plus 35 auxiliary worktrees. The net change from thirty-four auxiliaries is already represented in `origin/main`, either by direct patch equivalence or by the corresponding squash-merge aggregate. Their worktrees are clean and hold no deeper hidden Agent Turn implementation.

The sole worktree-level patch not represented in `origin/main` is:

| Worktree | Branch / commit | Difference from `origin/main` | Preservation rule |
|---|---|---|---|
| `/Users/lumimamini/work/animichi-wts/fix-secrets` | `fix/root-secrets-upload` at `f72e779b` | One commit ahead; workflow-only root secrets upload fix | Preserve until the later CI/CD campaign explicitly absorbs or rejects it |

The three tracked workflow edits in `/Users/lumimamini/work/animichi` have the same stable patch id as `f72e779b`. The untracked handoff is a planning artifact, not source code. Therefore the dirty root contains no unique uncommitted source patch, but it must still not be reset or deleted automatically.

The other 34 clean campaign worktrees are:

`agent-dsn`, `ci-pr`, `docs-closeout`, `feat-832`, `fix-494`, `fix-826b`, `fix-adopt`, `fix-export2`, `fix-instance-basic`, `goal-closeout`, `goal-w2w6`, `goal-w45`, `hook-routing`, `hooks`, `mig-rebuild`, `p2-edge`, `p3-ws`, `p4-bindings`, `p4-ci`, `p4-secrets`, `p5-meta`, `p6-prod`, `p8-debts`, `rm-sourcery`, `squash-doc`, `w0-rem`, `w1-reorg`, `w4-p1`, `w4-p2`, `w4-p3`, `w4-p4`, `w5-move`, `w6-847`, and `w8-858`.

## Branch interpretation

The daily clone has 209 local branch refs after creating the planning branch; the campaign clone has 68; the abandoned clone has three. Many historical branches were squash-merged, so `git branch --no-merged` is not evidence that their patches are missing. Cleanup must compare aggregate patch identity or target-tree content before deleting refs.

Targeted source audits found no alternate, deeper implementation to recover: all local `HandleUserMessage` variants are the same shallow implementation, and PlanItinerary variants differ only by the completed vocabulary rename. The deep refactor must be built from the current base rather than cherry-picking a hidden branch.

This targeted conclusion is not permission for bulk branch deletion. Sixteen pre-rewrite branches in the daily clone still produce patch-id-unique salvage signals, and the abandoned clone's two auxiliary branches share two historical candidate commits (`d284bedc` and `ed69c010`). History rewriting and squash merges make those signals inconclusive; a separate cleanup ticket must inspect their target trees before deleting them.

## Operating rules

1. Start every implementation ticket from refreshed `origin/main` in a dedicated worktree.
2. Never modify, reset, or delete the dirty campaign root as part of code refactoring.
3. Preserve `fix/root-secrets-upload` until CI/CD work begins; code-level tickets must not absorb it accidentally.
4. Treat the abandoned clone and its two worktrees as non-authoritative, but preserve them until a separate cleanup ticket resolves the recorded salvage candidates.
5. Re-run the clone/worktree/patch audit before any cleanup, history rewrite, or branch deletion.
