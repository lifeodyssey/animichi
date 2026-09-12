# Orca MVP coordinator prompt

Paste the following into a fresh Codex coordinator session in Orca. Recommended
coordinator model: `gpt-5.6-sol`, effort `medium`. Replace the issue placeholder
with the admitted card. This is a prompt template, not an Orca configuration schema
or an unattended scheduler. Use the
[headless launcher](../../scripts/orca-headless/README.md) for worker execution.
The operating authority is
[Orca card delivery](../ops/orca-card-delivery.md).

```text
Use the installed orca-cli and orchestration skills. Coordinate GitHub issue
<ISSUE_NUMBER> in lifeodyssey/animichi from Ready for Dev through verified squash
merge. Read AGENTS.md and docs/ops/orca-card-delivery.md before dispatch.
The owner requires headless execution without visible TUI or Chat worker panes.
Validate that execution path before admitting a card; do not launch visible
workers or silently replace Orca Run/Task/Dispatch with another supervisor.
If this runtime cannot provide it, report the capability gap before dispatch.

Use Codex gpt-5.6-sol / max for developers and fixers; the coordinator is
Codex gpt-5.6-sol / medium. Prefer Grok CLI grok-4.6 / xhigh for independent
review when its current allowance and effective model/effort are verified.
When allowance is insufficient/unknown or launch compatibility is unverified,
use Codex gpt-6-astra / xhigh and record the reason. Do not silently lower effort.
Every development or fix prompt MUST invoke and follow Matt /implement, including
local-review fixes, PR-comment fixes and CI repairs. Every review or re-review
prompt MUST invoke and follow Matt /code-review. Read the actual installed skill;
mentioning its name without following it is not sufficient. Resolve the actual
installed /implement and /code-review files, read them, and pin their paths and
hashes in the private job brief before launching workers in a new worktree.
Do not publish local installation paths, capabilities or raw session receipts.
Review descendants must differ from all candidate author models.
Follow the model compatibility notes in docs/agents/orca-project-setup.md.
General worker-pool routing and low-allowance handoff remain enhancement #1619.

Admit exactly one existing backend, Infra, or CI/CD card. Freeze its requirement
revision, acceptance criteria, dependency inputs, base SHA, gates and ownership.
If the card lacks ready inputs, report the missing input instead of inventing it.
Use an isolated worktree; preserve all other active and dirty worktrees.
Pin the workflow configuration and launcher revision used by this coordinator,
including absolute input paths and hashes in the private task brief. Verify the
files exist in each new worktree; use the pinned coordinator checkout's tools
when the candidate does not contain that revision.

Before the first worker launch, verify the review skill's required child topology
fits Orca's configured nesting limit and that required skills are discoverable.
Use Orca Run/Task/Dispatch for every supervised attempt and its recovery protocol.
Launch workers with scripts/orca-headless/orca-headless.rb start, supplying the
exact workspace, role spec and model selection. Preserve its private receipts.
At every supervision checkpoint run the launcher's status command and compare
model-process exit with native Task settlement; cached-live native liveness does
not override a recorded exit. A progress-only final response can exit 0 before
bound worker_done. If any process exits with its Task unsettled, use native Orca
recovery instead of waiting again on cached liveness or inventing completion.
Preserve completed child reports plus failed-attempt and native Run-takeover
evidence without claiming parent Task success. Use cleanup only
as documented, with the accepted worker_done message ID.
Use one coordinator session with the standard check/wait/reply loop until the
card merges or needs owner intervention. No scheduled admission or short-session
controller in this MVP. Permit one candidate writer and one heavy gate suite.
Dispatch one independent reviewer with Matt /code-review in its prompt; let the
installed skill organize its children. Verify its depth requirements at launch.
Do not confuse a completed worker task with candidate approval.
Every headless role prompt must state that its final response ends its process.
Require bounded native check/wait calls until its obligations settle, followed by
exactly one bound worker_done; do not add a process restart loop or scheduler.

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

Read and paginate inline threads, review submissions and top-level comments. Set
PR_NUMBER to the actual PR number and CARD_EVIDENCE_DIR to this card's existing
private evidence directory outside the repository. For every complete read, set
OBSERVATION to a new sequence-plus-stage name such as 02-after-push, and run:
ruby scripts/orca/pr-feedback.rb --repo lifeodyssey/animichi --pr "$PR_NUMBER" \
  --output "$CARD_EVIDENCE_DIR/pr-feedback-$OBSERVATION.json"
The helper writes successful output atomically. Never reuse an observation name
or overwrite an earlier inventory. Query live required CI separately. While
waiting for feedback/checks, wait up to 60 seconds between observations and keep
supervising. A nonzero exit, missing output, or output without complete: true is
unavailable or partial evidence, never zero findings or merge permission.
Address each actionable finding with evidence and preserve its history. Code
changes invalidate prior approval. Apply docs/ops/review-gate.md and its actual
comment guard; do not bypass checks or count a queued merge as merged delivery.
If all PR review bots explicitly report exhausted allowance, classify those
notices as non-actionable and proceed without waiting for further bot reviews.
Preserve existing substantive findings, Matt review and required CI obligations.

Consume Orca inbox deliveries, handle worker questions, and settle resource
ownership before acknowledgement. Unknown liveness must not create a second
writer. Report actual blockers, evidence paths and the current card stage.
Stop successfully only when GitHub confirms the merge and workers are accounted
for. Product API/E2E/Computer Use acceptance and PO review belong to the later
phase. Existing card tests and required CI remain mandatory.
```

This template does not select a card. Substitute only an admitted card within the
owner's authorized scope; check current ownership, existing PRs, and readiness.
