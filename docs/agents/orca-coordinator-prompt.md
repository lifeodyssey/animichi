# Orca MVP coordinator prompt

Paste the following into a fresh Codex coordinator session in Orca. Recommended
coordinator model: `gpt-6-astra`, effort `medium`. Replace the issue placeholder
with the admitted card. This is a prompt template, not an Orca configuration schema
or an unattended scheduler. The operating authority is
[Orca card delivery](../ops/orca-card-delivery.md).

```text
Use the installed orca-cli and orchestration skills. Coordinate GitHub issue
<ISSUE_NUMBER> in lifeodyssey/animichi from Ready for Dev through verified squash
merge. Read AGENTS.md and docs/ops/orca-card-delivery.md before dispatch.

Use Codex CLI for every worker. Fix the developer/fixer to gpt-5.6-sol with max
effort and all independent reviewers to gpt-6-astra with max effort. Require
Matt /implement in developer/fixer prompts and Matt /code-review in reviewer
prompts. Verify the effective model on launch, including reviewer descendants.
For Astra max on Orca 1.4.200, follow the verified custom-terminal launch in
docs/agents/orca-project-setup.md; check real session identity before worker-start
adopts its terminal. Keep supervised ownership and the nesting limit.
Do not perform provider switching or quota-based selection in this MVP.

Admit exactly one existing backend, Infra, or CI/CD card. Freeze its requirement
revision, acceptance criteria, dependency inputs, base SHA, gates and ownership.
If the card lacks ready inputs, report the missing input instead of inventing it.
Use an isolated worktree; preserve all other active and dirty worktrees.

Before the first worker launch, verify the review skill's required child topology
fits Orca's configured nesting limit and that required skills are discoverable.
Use Orca Run/Task/Dispatch for every supervised attempt and its recovery protocol.
Use one coordinator session with the standard check/wait/reply loop until the
card merges or needs owner intervention. No scheduled admission or short-session
controller in this MVP. Permit one candidate writer and one heavy gate suite.
Verify nesting depth supports coordinator -> reviewer -> review-axis workers.
Do not confuse a completed worker task with candidate approval.

Read the selected GitHub Project mapping from docs/agents/orca-project-setup.md.
Keep the business title stable. Move Ready for Dev -> In Dev -> Dev Done; hold
Dev Done throughout review/fix, PR creation, and PR comments. Record progress and
report links in the issue's comments. After confirmed merge, set Ready for QA.
Never create a new board column or rename the card for an internal execution step.

Follow the contract's sequence: implement and gates -> freeze candidate ->
independent review -> fix/re-review when needed -> regular, non-draft PR -> address every actionable
PR comment and required check -> squash merge at the approved head -> read back
mergedAt and merge SHA. Enforce at most three automatic review rounds per card.
The coordinator owns semantic candidate commits and GitHub publication; reviewers
return findings and do not modify the candidate. No candidate edits during review.

Read and paginate inline threads, review submissions and top-level comments.
Use ruby scripts/orca/pr-feedback.rb --repo lifeodyssey/animichi --pr <PR_NUMBER>
for the feedback inventory, and query live required CI separately. While waiting
for PR feedback/checks, wait up to 60 seconds between observations and continue
supervising. Errors or partial reads are not zero findings or merge permission.
Address each actionable finding with evidence and preserve its history. Code
changes invalidate prior approval. Apply docs/ops/review-gate.md and its actual
comment guard; do not bypass checks or count a queued merge as merged delivery.

Consume Orca inbox deliveries, handle worker questions, and settle resource
ownership before acknowledgement. Unknown liveness must not create a second
writer. Report actual blockers, evidence paths and the current card stage.
Stop successfully only when GitHub confirms the merge and workers are accounted
for. Product API/E2E/Computer Use acceptance and PO review belong to the later
phase. Existing card tests and required CI remain mandatory.
```

No pilot card is selected by this template. Replace the placeholder only after
the owner chooses the card; check current ownership, existing PRs, and readiness.
