# Orca card delivery: Ready for Dev to merged PR

Owner decisions: 2026-09-12 and 2026-09-13. Scope: backend, Infra, and CI/CD cards that are already
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
This flow supersedes OpenCode-only Policy C: use Codex `gpt-5.6-sol` / `max` for development.

| Role | Current launch | Ownership |
|---|---|---|
| Developer / fixer | Fresh Codex Sol max session | Use `/implement` in the assigned worktree; leave Git publication to the coordinator |
| Reviewer | Fresh Grok 4.6 xhigh; fallback Codex Astra xhigh | Use Matt `/code-review` as required in the prompt; return findings and evidence |
| Coordinator | Codex Sol medium | Admission, dispatch, evidence, candidate commits, PR feedback, merge, and recovery |

The reviewer's effective model must differ from the models that wrote the current
candidate, including fixes. A new session, CLI, account, or reasoning effort does
not make the same model independent. Record effective provider/model identities;
unknown identity or an unverified alias cannot satisfy this gate. Development and
fixes use Codex `gpt-5.6-sol` / `max`; the coordinator uses `gpt-5.6-sol` / `medium`.
Prefer Grok CLI `grok-4.6` / `xhigh` for review when current allowance is verified;
otherwise use Codex `gpt-6-astra` / `xhigh` and record why. Review descendants must
preserve model independence. Verify Grok model/effort and supervised launch before
admission; an installed CLI or historical usage does not prove available quota.

Reviewers receive frozen inputs and diff, not developer conversations. Each fix
and review uses a fresh session; reviewers return findings and fixers own edits.

Future requirement, recorded but not implemented: maintain a configurable worker
pool including Codex, Grok, ZCode, DeepSeek-backed workers, Kimi Code, Pi, and
OpenCode. CLI and model/provider are separate dimensions; DeepSeek does not imply
a particular CLI. A pool entry must declare CLI, model, effort, role/Profile,
configuration version, execution host, availability, concurrency, and capabilities.
The owner's full model/role matrix is recorded in [worker pool #1617](https://github.com/lifeodyssey/animichi/issues/1617).
General quota routing and low-allowance Matt `/handoff` remain in
[enhancement #1619](https://github.com/lifeodyssey/animichi/issues/1619). The Grok-first
review preference above is a narrow owner override, not a completed worker pool.
Selection must respect role compatibility, resource limits, and authorization;
record the effective selection and never silently fall back to another provider.

Future Profiles must control skills, MCP, tools and configuration exposure; a
fresh session alone does not prove isolation. Validate each CLI separately.

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

An accepted `worker_done` settles the Task/Dispatch automatically. A reviewer may successfully finish an inspection that found defects;
record them as a failed candidate review. Process exit, TUI idle, or a successful command receipt never proves approval.
At every supervision checkpoint, run launcher `status` and compare model-process exit with native Task settlement.
A progress-only final response can exit 0 before `worker_done` while native liveness remains cached live. An exited
process with an unsettled Task requires native Orca recovery, not more cached-liveness waiting or invented completion.
Preserve completed child reports plus failed-attempt and native Run-takeover evidence without claiming parent Task success.

Use Orca workers, not unrelated native subagents or parallel raw Codex CLIs; respect installed skill topology and Orca's nesting limit.

Use the [headless launcher](../../scripts/orca-headless/README.md) with the exact workspace, coordinator, Run,
private role-spec file and a new private attempt directory. Fixed roles do not schedule cards or select models; follow documented start/status/accepted-cleanup and never use interactive `worker-start` as fallback.

Verify model/effort from receipts or the reused terminal's live session. Astra uses `xhigh` on Orca 1.4.200; see
the [compatibility note](../agents/orca-project-setup.md#model-compatibility-and-allowance). New worktrees need
setup; existing ones need a preflight because `worker-start` does not rerun it.

MVP verification uses one pilot candidate writer and one heavy gate suite at a time. After it passes, inventory Ready for
Dev and open-PR backend/Infra/CI cards, then maximize independent work within verified dependencies, ownership and resources.
Keep one writer per candidate; dispatch one Matt `/code-review` reviewer per frozen candidate; its skill owns child concurrency within the nesting limit.

Use one coordinator and the standard supervised waiting loop for the whole card. Require headless workers with no visible TUI/Chat panes; verify
before admission. Short-session controllers remain deferred. A final response ends a headless process, so each
role prompt must require bounded native `check`/wait until obligations settle, then one bound `worker_done`;
no restart loop or scheduler. Empty waits require liveness inspection, not duplicate workers or inferred failure.

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
creation or recovery; keep every gate repair and review correction in that PR.

Read and paginate every feedback surface: inline threads and replies, review submissions,
and top-level human and bot comments. Re-read after every push and before merge. Record
each actionable item's source ID/URL, disposition, fixing commit or evidence, and
acknowledgement. Classify non-actionable statuses instead of posting meaningless replies. If all PR review bots explicitly report
exhausted allowance, do not wait for them; quota notices are non-actionable. Existing
substantive findings, Matt review and required CI still apply.

For every complete inventory, set `PR_NUMBER` to the actual PR number,
`CARD_EVIDENCE_DIR` to the card's existing private evidence directory outside the
repository, and `OBSERVATION` to a new sequence-plus-stage name such as `02-after-push`:

```sh
ruby scripts/orca/pr-feedback.rb --repo lifeodyssey/animichi --pr "$PR_NUMBER" \
  --output "$CARD_EVIDENCE_DIR/pr-feedback-$OBSERVATION.json"
```

The [read-only feedback tool](../../scripts/orca/README.md) writes successful output
atomically. Never reuse an observation name or overwrite an earlier inventory. A nonzero
exit, missing output, or output whose `complete` is not `true` is unavailable or partial
evidence, never zero findings or merge permission. Query required CI/checks separately.
Wait up to 60 seconds between observations; no webhook receiver or daemon is required.
Top-level comments lack a universal resolved flag: inspect findings and replies. A successful inventory is not merge approval.

Fix true findings, rerun checks, and obtain fresh local review after code changes. Respond
with the actual resolution; resolve inline threads only after their issue is addressed.
Account for top-level bot findings and preserve the audit history; resolving all comments
never means deleting them or posting a blanket acknowledgement without inspection.

[Review gate](review-gate.md) remains the single source for merge requirements. Re-query
live rules and satisfy required CI, thread resolution, maintainer acknowledgement, patch
coverage, and required GitHub approvals. The owner-local comment hook is not automatically
installed in a Codex/Orca path. Run it with the actual planned merge command supplied as
`tool_input.command` JSON and capture its exit status; empty input does no checking. If the
hook is unavailable or rejects, stop and diagnose it; never infer that Codex inherited Claude's hook enforcement.

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
Developer/fixer: Invoke and follow Matt /implement for development AND every fix,
including local-review findings, PR comments and CI repairs. Read the actual skill.
Route its review step to the coordinator's separate, different-model reviewer;
do not substitute self-review. Return changes and evidence for the coordinator's
candidate commit. The coordinator owns commit, push, PR, and squash merge actions.

Reviewer: Invoke and follow Matt /code-review for every review and re-review.
Read the actual skill; provide frozen spec/base/head and let it organize its work.
Your effective model must differ from every model that wrote this candidate.
Report actual findings and evidence without editing the candidate. Report a model
identity mismatch or unavailable required skill as blocked, never as approval.
```
