# Review gate — what actually enforces merge quality

Supersedes the retired Review Gate machinery (issue #1008's status + trusted
LLM review seat + verdict/marker artifacts, removed 2026-08-31). The goal —
**nothing merges with unresolved review feedback** — is now enforced by the
thinnest layers that can actually hold it:

## What blocks a merge (all native, no quota dependency)

1. **Unresolved review threads** — the `protect main` ruleset sets
   `required_review_thread_resolution: true`. Every inline review comment must
   be resolved before GitHub allows the squash merge. This is the owner's core
   requirement and it is one checkbox on GitHub's side, not custom code.
2. **Required CI** — `PR Verification` and `Security` must be green on the
   merge ref. Produced by `pr-verification.yml`; the merge-group trigger keeps
   the queue fed. The contract is pinned by `docs/iterations/s0v2/ruleset-target.json`
   (schema as code) and checked by `test_ci_contract_ruleset_migration*.rb`.
3. **Two-way comment discipline (local hook)** — `~/.claude/hooks/check-pr-comments.sh`
   blocks any `gh pr merge`: it requires zero unresolved threads **and** every
   top-level bot finding (qodo / SonarCloud) acknowledged by the human. It also
   refuses merges in the first minutes of a PR's life before bots have spoken.
   This is the layer that catches what threads cannot: aggregate bot summaries.
4. **Bot findings should be inline.** qodo and SonarCloud are configured to
   comment as review comments (threads) wherever possible, so rule 1 covers
   them natively and rule 3 is the backstop for top-level summaries only.

## What was removed, and why it is safe

The retired machinery required an LLM-generated trusted review status before
any merge. That coupled every merge to a shared model-quota pool: when the
pool emptied, every open PR red-lit at the same instant with no local remedy.
The discipline it encoded (Standards∥Spec review, mutation red→green proof,
fresh-head binding) lives on as **workflow discipline** — `docs/workflow.md`
stage 5, run by whoever implements the change — not as a merge-blocking
status. Fail-closed posture for the remaining layers is unchanged: the hook
fails closed, the ruleset fails closed, CI is never bypassed.

## Reviewer rules (discipline, unenforced by CI)

- Review the candidate diff against the ticket brief (`origin/main...HEAD`).
- Mutation probes remain the only valid green-light proof for behavioural
  claims: break the code (red), restore it, rerun (green), quote all three.
- One ticket outcome per PR; review findings are folded into the same PR.
