# Branch updates merge `main` in; `non_fast_forward` and `deletion` protect `main` only; agents and controllers never force-push

> **Status**: accepted 2026-10-09 (ZDEV-51). Amends
> [ADR 0005](0005-repo-force-push-policy.md), whose first version claims a wider ruleset scope
> than the platform carries; that text stands as history under an amendment note, this ADR is
> the standing policy.

The 2026-10-09 API read of the repository's one branch ruleset settles what the platform
enforces. ADR 0005's first version recorded a scope the ruleset does not carry (a `*` ref
pattern the read does not show); the owner's decision the same day adds the
rule the platform leaves open: stacked PRs are retired, and nobody force-pushes — the repository's
own word is what protects a feature branch.

## The read (2026-10-09, `gh api`, key fields)

```json
{
  "name": "protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": ["deletion", "non_fast_forward", "required_linear_history"],
  "allowed_merge_methods": ["squash"],
  "required_status_checks": {"checks": ["PR Verification", "Security"], "strict": true},
  "bypass_actors": [{"actor_id": 25764181, "actor_type": "User", "bypass_mode": "pull_request"}]
}
```

## Decision

- **`non_fast_forward` and `deletion` protect `main` only.** The read's ref condition is
  `~DEFAULT_BRANCH`; the ruleset does not reach a feature branch — the never-rule below is what
  binds one.
- **Agents and controllers never force-push — not to `main`, not to a feature branch, and not with `--force-with-lease`.** Updating a branch is `git merge origin/main` + a normal push, or
  `gh pr update-branch`.
- **No stacked PRs** (owner, 2026-10-09): a story that depends on an in-flight story waits for
  that story's PR to land on `main`, then takes the same merge against the fresh head. One story
  stays one PR (`docs/agents/delivery-flow.md`).
- PRs merge by GitHub **squash** (`allowed_merge_methods = ["squash"]`,
  `required_linear_history`) behind the read's required checks (`PR Verification`, `Security`,
  strict). The owner's approved history-rewrite window (ADR 0005) remains the one sanctioned
  rewrite of `main`, run by the owner alone.

## Why

- The platform's scope is what the API returns, not what a campaign draft aimed at. ADR 0005's
  first version recorded the aim; the 2026-10-09 read settles the fact — and policy that
  misstates the platform sends the next reader to push a way the platform refuses.
- Merge-based updates keep the log linear without history rewrites; a blocked story waits for
  its blocker to land, which is cheaper than a stack that costs a restack per merge.

## Consequences

- A forced update of any kind happens only inside the owner's window; the runbook checklist and
  `main-legacy` retention (`docs/ops/git-daily-squash-runbook.md`) are unchanged.
- The read's one bypass actor is the owner, and `bypass_mode: "pull_request"` means a bypass
  rides an approved PR, not a direct push.
- Feature branches stay outside the ruleset's reach; this ADR's never-rule is the protection
  they have.
