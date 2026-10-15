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
   PR head. Produced by `pr-verification.yml`. The intended ruleset is written down in
   `docs/iterations/s0v2/ruleset-target.json` (the two contexts and thread resolution only); no
   test reads it since `test_ci_contract_ruleset_migration*.rb` was deleted in 7c17b6023. There is
   no merge queue.
3. **The merge hook (owner-local)** — `~/.claude/hooks/check-pr-comments.sh`, which zdev's merge
   handler also runs before its REST merge (gate G7). It checks one command form, a standalone
   `gh pr merge <number> -R owner/name …`, and refuses every other command that would merge: a
   REST or GraphQL merge, `--auto`, `--admin`, a chain, a variable or a branch as the target. Its
   checker, `~/.claude/hooks/pr_feedback_status.py`, blocks until every review thread is resolved;
   every resolved thread has a reply from our side after its first comment; and every bot that
   took part (recognised by its GitHub account type, never by name) has seen the head: a bot that
   submitted reviews needs a review whose commit is the head, a bot that only comments needs a
   comment or an edit after the push. A bot that declined after the push (a review limit or
   budget), or one still silent 20 minutes after the push, lets the merge pass with a warning naming
   it. A pull request with no bot activity must be at least 20 minutes old, and unthreaded bot
   findings (summary sections) need a newer maintainer comment containing `findings triaged`. Any
   error, timeout or crash blocks.
4. **Bots.** On 2026-10-04 the reviewing bots are `coderabbitai`, `sourcery-ai` and
   `chatgpt-codex-connector`, with `codecov` reporting coverage; qodo and SonarCloud last commented in
   August 2026 (#900 and #1164). The checker reads the account type, so a newly installed bot is
   covered without an edit here.

## What was removed, and why it is safe

The retired machinery required an LLM-generated trusted review status before
any merge. That coupled every merge to a shared model-quota pool: when the
pool emptied, every open PR red-lit at the same instant with no local remedy.
The discipline it encoded (Standards∥Spec review, mutation red→green proof,
fresh-head binding) lives on as **workflow discipline** — `docs/workflow.md`
stage 5, run by whoever implements the change — not as a merge-blocking
status. The hook fails closed; the ruleset and the required checks hold only for an actor that
cannot bypass them, which today is none of ours (next section).

## Where these layers do not hold (2026-10-04 inventory)

- The owner account is the only bypass actor of the `protect main` ruleset, in mode `always`
  (ruleset 19974534), and every local actor (interactive sessions, the tick, zdev, the pi lanes)
  runs `gh` and `git` as that account. For them the required checks and thread resolution inform
  rather than block: the rule-suites API lists 22 bypasses on `main` between 2026-09-05 and
  2026-09-20, none since. An agent identity without bypass is an open owner decision.
- The merge hook binds Claude Code sessions and zdev's merge handler only; a pi or kimi lane, or a
  person at a terminal, runs `gh pr merge` without it.
- CD is dispatched for every push to `main` without reading the pull request's CI verdict; whether
  CD should wait for it is an open owner decision.

## Reviewer rules (discipline, unenforced by CI)

- Review the candidate diff against the ticket brief (`origin/main...HEAD`).
- Mutation probes remain the only valid green-light proof for behavioural
  claims: break the code (red), restore it, rerun (green), quote all three.
- One ticket outcome per PR; review findings are folded into the same PR.
- Merge only when every bot that left a comment or finding is resolved (line-level threads and
  top-level comments both), the last APPROVE from a review seat covers the current head, and every
  CI check is green — not "no required check is red". A bot that left nothing does not block.
