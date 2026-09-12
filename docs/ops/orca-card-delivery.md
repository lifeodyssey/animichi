# Orca card delivery: Ready for Dev to merged PR

Owner decisions: 2026-09-12. Scope: backend, Infra, and CI/CD cards that are already
Ready for Dev. This is the operating contract for an Orca coordinator; it is not
an implemented background scheduler or evidence that a card has run.

Planning and dependencies are tracked in [Orca harness #1612](https://github.com/lifeodyssey/animichi/issues/1612)
and its sub-issues, all labelled `orca harness`. Those issues track harness work.
Business cards retain their existing GitHub Issues and Project membership.

## Scope and completion

Phase 1 accepts an existing card, implements it, completes independent Matt code
review, opens one PR, addresses all PR feedback, and verifies that the PR merged.
Planning, specification approval, and card decomposition happen before this flow.

The complete intended sequence is:

```text
Ready for Dev -> In Dev: /implement and local gates -> Dev Done
  -> independent review using Matt code-review -> fix and re-review if needed
  -> create a regular PR -> address all PR feedback + required CI + fresh review
  -> squash merge -> verify GitHub merge record
  -> Ready for QA -> [later] API/E2E/Computer Use acceptance testing -> PO review
```

API/E2E/Computer Use acceptance testing is phase 2 and is deferred. Existing tests
and required CI still run in phase 1; deferral does not permit disabling checks.
Owner-facing Ready for Review means ready for the PO, not a developer's self-report
or an automated code-review result. Phase 1 ends at MERGED, before that PO review.
Existing main-branch CD may run after merge; its status is separate from this
phase's outcome. No local deployment or production-approval automation is added.

The GitHub Project Status stays **Dev Done** throughout local review, fixes, PR
creation, and PR feedback. These are execution steps, not additional board columns.
After GitHub confirms the merge, move the card to **Ready for QA**. Do not let an
issue-closed or PR-merged automation mark it product-complete before QA/PO review.
Keep issue titles about the outcome. Use issue comments for progress/report links
and PR comments for post-publication feedback. A workspace's short Orca comment
may mirror the latest progress; it is not a threaded review record.

## Current workers and future pool

The current execution choice supersedes the OpenCode-only Policy C requirement
for development in this flow: use Codex, model `gpt-5.6-sol`, effort `max`.

| Role | Current launch | Ownership |
|---|---|---|
| Developer / fixer | Fresh Codex Sol max session | Use `/implement` in the assigned worktree; leave Git publication to the coordinator |
| Reviewer | Fresh Codex Astra max session | Use Matt `/code-review` as required in the prompt; return findings and evidence |
| Coordinator | Codex Astra medium (recommended) | Admission, dispatch, evidence, candidate commits, PR feedback, merge, and recovery |

The reviewer's effective model must differ from the models that wrote the current
candidate, including fixes. A new session, CLI, account, or reasoning effort does
not make the same model independent. Record effective provider/model identities;
unknown identity or an unverified alias cannot satisfy this gate. The MVP uses
only Codex CLI: developer/fixer `gpt-5.6-sol` / `max`, reviewer `gpt-6-astra` /
`max`. All review descendants must preserve the same model-independence rule.
The coordinator recommendation is `gpt-6-astra` / `medium`, in its own session.
These are fixed role assignments; provider switching and quota routing are deferred.

Reviewers receive the frozen inputs and candidate diff, not the developer's
conversation. Each fix and review uses a new session. Reviewers return findings;
developer/fixer workers own candidate edits so review independence remains clear.

Future requirement, recorded but not implemented: maintain a configurable worker
pool including Codex, Grok, ZCode, DeepSeek-backed workers, Kimi Code, Pi, and
OpenCode. CLI and model/provider are separate dimensions; DeepSeek does not imply
a particular CLI. A pool entry must declare CLI, model, effort, role/Profile,
configuration version, execution host, availability, concurrency, and capabilities.
The owner's full model/role matrix is recorded in [worker pool #1617](https://github.com/lifeodyssey/animichi/issues/1617).
Allowance-based selection and low-allowance Matt `/handoff` live only in
[enhancement #1619](https://github.com/lifeodyssey/animichi/issues/1619); neither blocks the MVP.
Selection must respect role compatibility, resource limits, and authorization;
record the effective selection and never silently fall back to another provider.

Profiles must eventually control actual instructions, skills, MCP, tools, and
configuration exposure. A role prompt, fresh session, or worktree alone does not
prove that isolation. CLI compatibility and isolation require separate validation.

## Admission and frozen inputs

Accept a specific GitHub card in `lifeodyssey/animichi`. Record the source field
or label that supplied Ready for Dev; do not assume a display column, assignment,
or the older `ready-for-agent` label supplies equivalent authorization.

Before dispatch, freeze:

- Card ID, requirement revision, spec contents, ACs and test types.
- Exact repository/worktree, resolved base SHA, allowed edits and exclusions.
- Dependency completion criteria and immutable input commit/artifact references.
- CLI/Profile configuration, gate commands, output paths, and resource ownership.
- Review-round count, existing PR identity if any, and permitted delivery actions.

Missing spec or ACs blocks admission. Matt's generic no-spec fallback is not a
passing review in this delivery flow. Scope decisions return to the PO rather
than being implemented as incidental fixes.

Use a separate worktree for each implementation card. Independent cards use the
resolved main baseline; dependent code must explicitly name its accepted input.
A dependency requiring merge is not satisfied by Dev Done or local review success.
Preserve existing dirty worktrees and inspect them before adopting any work.

## Orca objects and launch contract

Load `orca-cli` and `orchestration` from the selected Orca executable before use.
Load the relevant bundled reference for placement, recovery, or custom launches.

- A Run is the durable namespace and coordinator inbox, not an automatic scheduler.
- A Task is a specific development, review-axis, or correction assignment.
- A Dispatch identifies one authoritative attempt at that Task.
- The business card and its review verdict remain distinct from Task settlement.

An accepted `worker_done` settles the Task/Dispatch automatically. A reviewer may
successfully finish an inspection that found defects: record those findings as a
failed candidate review, not as a successful delivery. Conversely, process exit,
TUI idle, or a successful command receipt never proves review acceptance.

Use Orca workers for this flow, not an unrelated native subagent system or
parallel raw Codex CLIs. The review prompt must account for the installed skill's
worker topology and Orca's nesting limit before dispatch; do not bypass that limit.

The following is a launch template, not a runnable card or an Orca YAML schema:

```text
orca orchestration worker-start --task <task-id> --run <run-id> \
  --worktree <exact-worktree-selector> --agent codex \
  --model gpt-5.6-sol --effort max --json
```

Verify the model/effort from launch receipts or the reused terminal's live session.
For Astra max on Orca 1.4.200, use the [startup recipe](../agents/orca-project-setup.md#astra-max-launch-on-orca-14200); do not silently change the model or effort.
New worktrees must finish setup before prompt delivery. Existing worktrees need
an explicit environment preflight because `worker-start` does not rerun setup.

MVP capacity: one admitted card, one candidate writer, and one heavy gate suite at
a time. Independent review axes may run together against a stable candidate.
The intended depth is two: coordinator -> reviewer -> review-axis workers.
Verify the actual nesting setting before launch; this is separate from capacity.

Use one coordinator session and the standard Orca supervised waiting loop for
the whole card. Short-lived coordinators, webhook wakeups, and scheduled admission
are deferred. Repeated empty waits are checkpoints; inspect worker liveness as
the installed skill requires. A live session does not mean continuous inference.

## Development, gates, and candidate

Require Matt `/implement` directly in every developer/fixer prompt. Its review
step must be routed to the independent, different-model reviewer. The coordinator
owns candidate commits and publication under this flow's assigned responsibilities.
Keep skill methods in the installed skills rather than reproducing them here.

Developer/fixer workers may edit only their assigned card. They return actual
file changes and evidence, not commit, push, PR, or merge actions. The coordinator
checks the result and owns publication of the semantic card outcome.

Follow the root `make check` before/after requirement and the affected-package
commands in [local gates](local-gates.md). Additionally select the card's explicit
checks: backend behavior/integration tests, Infra typecheck/topology/program-load,
or CI/CD actionlint, shell behavior, and workflow contracts. Pre-push alone does
not prove that CI's contracts lane has executed. Missing evidence blocks.

After gates pass, create a local candidate commit before review. Follow existing
commit hygiene: amend an unpushed semantic commit for related fixes; keep fixes
in the same PR after publication. Never commit merely because a worker stopped.
Record the complete base SHA, candidate SHA, diff, and gate evidence. No candidate
source edits may run while reviewers inspect it. Mutation probes use an isolated
copy, preserve restoration evidence, and never race against the reviewed tree.

## Review policy and the three-round limit

Require the installed Matt `code-review` skill directly in the review prompt.
The skill owns the review method and report format; do not duplicate either in
project documentation. This section defines only the project orchestration policy.

Every finding retains its source report, candidate SHA, evidence, proposed correction,
and disposition. Valid findings must be fixed and verified. A disputed heuristic
requires a reasoned disposition confirmed by the reviewer; unresolved disagreement
goes to the PO. Do not manufacture zero findings by deleting or relabelling them.

Count round 1 as the initial review, with at most two further complete reviews
on corrected candidates. Every correction reruns affected gates and review
against the new candidate, including evidence that prior findings closed.
All required reports must pass on the current SHA, with the behavioral mutation proof
required by [review discipline](review-gate.md).

At most three automatic review rounds are allowed per card; opening a PR does
not reset the counter. Post-PR code fixes also invalidate the old review and need
a fresh review within that budget. If the third round fails, or later changes would
need a fourth, preserve all evidence and return the card to HUMAN. Do not create
another Run/card to evade the limit. Infrastructure/dispatch failures are recorded
as attempt failures, not fabricated review verdicts; Orca's own retry limit also
applies independently.

Create a regular, non-draft PR only after all local findings are resolved on the
current candidate. Pre-PR reviews produce local reports and Orca messages.

## PR feedback and merge

Keep one complete card/Story outcome in one PR. Search for an existing PR before
creation or recovery. All gate repairs and review corrections stay in that PR.

Read and paginate every feedback surface: inline review threads and replies,
review submissions, and top-level issue comments from humans and bots. Re-read
after every push and before merge. For each actionable item, record its source
ID/URL, disposition, fixing commit or supporting evidence, and acknowledgement.
Non-actionable status comments need classification, not meaningless replies.

Use the [read-only feedback tool](../../scripts/orca/README.md) for the complete
comment inventory. The coordinator calls it while supervising the PR and waits
up to 60 seconds between observations; no webhook receiver or daemon is required.
Tool failure is unavailable evidence, never zero findings. CI/checks are queried
separately. Top-level comments lack a universal resolved flag: inspect their
findings and replies. A successful inventory is not a merge approval.

Fix true findings, rerun checks, and obtain fresh local review after code changes.
Respond with the actual resolution; resolve inline threads only after their issue
is addressed. Account for top-level bot findings too. Preserve the comments and
audit history; "resolve all comments" never means deleting comments or posting a
blanket acknowledgement without inspecting each finding.

[Review gate](review-gate.md) remains the single source for merge requirements.
Re-query the live checks/rules and satisfy required CI, thread resolution,
maintainer acknowledgement, patch coverage, and any required GitHub approvals.
The owner-local comment hook is not automatically installed in a Codex/Orca tool
path. Explicitly run it with the actual planned merge command supplied as
`tool_input.command` JSON and capture its exit status. An empty-input invocation
does no checking. If the hook is unavailable or rejects, stop and diagnose it;
never infer that Codex inherited Claude's hook enforcement.

Use the exact reviewed PR head when requesting squash merge:

```text
gh pr merge <number> --repo lifeodyssey/animichi --squash \
  --match-head-commit <approved-head-sha>
```

No administrator bypass, unresolved feedback, stale-head approval, or suppressed
required check is allowed. Merge-queue admission/auto-merge registration is not
MERGED: continue observing until GitHub reports `mergedAt` and the merge commit.
If newer commits or feedback arrive, return to the corresponding check before
another merge attempt. Keep the candidate SHA, final comment inventory, required
check results, PR URL, merge SHA, and merge timestamp in the completion record.

## Messages, recovery, and evidence

Use `check`/`reply` for worker questions and Dispatch-addressed messages for
follow-ups. Workers check mail at natural checkpoints and before `worker_done`;
send it once using the actual injected lifecycle IDs and explicit outcome.
After settlement, release each worker unless the user asked to retain it.
Process every delivery and its resource decisions before acknowledgement.

Lost mutation receipts require `request-show` and exact `--retry-request`
recovery. Unknown or unreachable workers remain unverifiable; do not dispatch a
replacement writer from silence. Follow Orca's recovery receipt and positive
process evidence. A different runtime, new Task, or visible idle pane does not
erase an outstanding writer or a failed review.

Keep frozen briefs, role configuration, round reports, gate logs, mutation
evidence, comment dispositions, and merge receipts in the card's local evidence
directory, outside the repo root. These records supplement Orca's authoritative
Run/Task/Dispatch data; they do not replace it with a competing lifecycle database.
No claim of unattended scheduling, enforced Profile isolation, or crash recovery
is accepted until that behavior has been exercised in a real scoped pilot.

## Task brief template

Start with the [project setup entry](../agents/orca-project-setup.md) and
[coordinator prompt](../agents/orca-coordinator-prompt.md). Tasks -> GitHub ->
Projects displays business data; Agent Dashboard shows agent activity. Neither
worker settlement nor an agent's Done indicator advances the business card.

```text
Card / requirement revision / Run:
Role / review round / CLI-Profile version / effective provider and model:
Target: exact worktree, base SHA, candidate SHA when reviewing, owned paths.
Change: the concrete result and permitted edits.
Constraints: fixed ACs, exclusions, dependency artifacts, repo rules, no publication.
Ownership: permitted edits/report path; other workers and their boundaries.
Observable acceptance: exact checks, expected evidence, report location and format.
Inputs: frozen spec, relevant guides, diff command, commit list, prior findings.
Completion: follow the injected Orca lifecycle contract; report actual outcomes.
Follow-ups: process and acknowledge each inbox delivery, then check until empty;
an unacknowledged FIFO delivery hides later guidance. Do this before worker_done.
```

Append the appropriate role instruction to each task prompt:

```text
Developer/fixer: Use the installed Matt /implement skill for this card or fix brief.
Route its review step to the coordinator's separate, different-model reviewer;
do not substitute self-review. Return changes and evidence for the coordinator's
candidate commit. The coordinator owns commit, push, PR, and squash merge actions.

Reviewer: Use the installed Matt /code-review skill on the frozen spec/base/head.
Your effective model must differ from every model that wrote this candidate.
Report actual findings and evidence without editing the candidate. Report a model
identity mismatch or unavailable required skill as blocked, never as approval.
```
