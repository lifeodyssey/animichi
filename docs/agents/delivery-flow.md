# Delivery flow — ticket to PR to merge to deployed

The operating runbook is `docs/ops/orca-card-delivery.md`; the coordinator manual is
`.claude/skills/animichi-orca-orchestration/SKILL.md`; the merge rules are
`docs/ops/review-gate.md`. This file holds the owner decisions and the measured mechanics those
documents do not carry, in the order the flow runs. Owner-local hooks enforce the intake rules
below on the owner's machine; like the hookify rules `docs/agents/harness.md` names, they are
absent from a fresh clone and from CI and are never proof that a repository rule is enforced.

## Every new issue goes through `/to-tickets` (owner, 2026-09-23 and 2026-09-24)

An issue body carries `## What to build`, `## Acceptance criteria` and `## Blocked by`. Its
acceptance criteria are test-typed, the ways the change could fail are listed before its tests,
and its blockers are native GitHub `blocked_by` edges (`docs/agents/issue-tracker.md` has the API
call); a prose "Blocked by" line is not enough, because the pre-dispatch check reads the edges.
At the skill's step 4 ("Quiz the user") the advisor, the Fable seat, approves the breakdown; do
not quiz the owner ("拆分方案，你直接advisor fable决定就可以了", 2026-09-24). An incident issue (an
Orca or coordinator failure) uses the same template: the measure goes in `## What to build`, its
verification in `## Acceptance criteria`, then `## Blocked by`, with the problem, the raw-record
source (the session transcript path and time) and the root cause above them.

## Before dispatching a card (2026-09-19: four dispatched, three stale)

1. `gh issue view <n> --json body -q .body` and read the whole body, then the native dependency
   edges (`issue_dependencies_summary.blocked_by`). A "Blocked by" line sat at the end of one body
   and a truncated read cut it off.
2. Check whether the card's artefacts are already on `origin/main`: `git grep` a symbol or file it
   would introduce. Two of the four cards had been delivered by other PRs.
3. Every blocker is closed.

The lanes recognised the stale premises themselves and refused to redo the work; that was luck,
not process.

## Issues split finely; PRs follow the e2e story (owner, 2026-09-15 to 2026-09-24)

Issues may be split finely with `/to-tickets`, and that is welcome. PRs follow the e2e story:
deliver one end-to-end-verifiable story, including every ticket sliced out of it, in one PR,
done when the story's acceptance criteria pass. The body says which on one line: `E2E story:
<the story and the e2e artifact that proves it>`, or `Not one e2e story: <why>`. The second form
is allowed; the reason is what is required ("最好是e2e的，如果不是，要写理由，不是不允许",
2026-09-24), and a mechanism forcing a second merge is one such reason: CD applies Pulumi before
it publishes Workers, so a route cannot name a Worker the same run creates. The owner's earlier
words, in order: "我感觉你 pr 拆分的太小了，大的好几个 issue，能够 e2e 的，作为一个 pr" (2026-09-15);
"记得用 stack pr，还有我之前说的，多个 issue 是一个 story 的就放一个 pr" (2026-09-17); "每个story完成验收
就是一个PR，不然的话，我们CI每次都阻隔太久了" and "你可以详细拆分issue,但是尽量把一个e2e的story写成一个pr"
(2026-09-23). Why: every PR pays a full CI gate, and the ruleset is squash + linear history +
strict up-to-date, so every merge puts every other open PR BEHIND and reruns its CI (O(n²)):
hot-file PRs measured 150–200 minutes each, one PR merged `main` five times, and fine-grained PR
splitting kept the pipeline blocked.

- One brief, one branch, one PR whose body closes each ticket. GitHub's `Closes #a, #b, #c`
  closes only the first number; repeat the keyword before each one.
- A story that depends on another story's in-flight branch is a stacked PR: start from that
  branch head and open with `gh pr create --base <parent-branch>` (or `gh pr edit <n> --base`). No
  third-party stack tools; `gh-stack` has known issues on squash-only repositories. Each layer is
  reviewed and approved on its own; merge from the bottom, by literal number.
- Measured 2026-09-17: after the bottom PR squash-merges, GitHub only repoints the upper PR's base
  to `main`; the branch still carries the old bottom commits and reads DIRTY. Rebase it yourself:
  `git rebase --onto origin/main <old-bottom-head>`, layer by layer, then push with lease. Every
  merge costs one restack of the remaining layers, so keep stacks short and merge fast.
- Never chain a rebase and a dispatch in one command. A rebase that stopped on a conflict still let
  the dispatch fire, and the reviewer received a tree with 21 conflicted files. Require
  `git status --porcelain` empty and `git rebase --show-current-patch` silent first; a conflicted
  restack goes to the writer, hunk by hunk.

## Review before the PR opens (owner, 2026-09-24)

GLM and DeepSeek review each other's work; kimi reviews a candidate that both of them wrote;
GLM or DeepSeek reviews a candidate kimi wrote; no Claude model reviews (owner, 2026-09-24).
A PR opens only after a review seat on a model different from every model that wrote the
candidate has approved its head, and the body carries `Review: APPROVE at <sha>`.

## Review rounds: what does and does not consume one (owner, 2026-09-18)

"我们的 implement->Review 最多三轮，pr comment 只 fix 不 review." The three-round cap is stated in
`docs/agents/tool-routing.md`, `docs/ops/orca-card-delivery.md` and the coordinator skill; the
owner's refinement, the list of post-PR changes that do not spend a round, is in
`docs/ops/orca-card-delivery.md`. The push gates and CI cover those, and the last APPROVE stands
for the head they produce; any other post-PR change needs a fresh review within the budget. Why:
rounds four and up on 2026-09-17 (one card reached round eleven) found
wording ("here", "this file", a commit-body sentence) that the gates already covered; the seat's
value is in the first three rounds. Round-one briefs ask the reviewer to sweep a whole class of
problem in one pass. A failed round three goes to the owner with the must-fix list, never to a
round four.

## PR mechanics measured on this repository

- Thread replies: reply inside the thread before resolving: "Fixed in <sha>" plus the mechanism,
  or the reason for declining, or "identified, owned by #<n>" for a follow-up card
  (`docs/ops/orca-card-delivery.md` states the policy). The GraphQL pair is
  `addPullRequestReviewThreadReply` then `resolveReviewThread`, in that order, per thread. After a
  batch, read back `comments.nodes[].author.login` and `isResolved`: a script that swallowed
  GraphQL errors once logged "replied+resolved" for a thread it had silently resolved and another
  it had not touched (2026-09-08).
- A bot comment can carry several findings under severity badges; read past the first one, and
  verify each finding independently before acting on it or dismissing it.
- Poll threads before dispatching a CodeQL rerun; otherwise the loop reruns CodeQL against
  unhandled threads. Only a `neutral` CodeQL conclusion needs the rerun.
- The merge hook named in Checks before a PR merges below matches a merge-shaped string
  anywhere in a command. The merge command is its own literal line, with no variables, and
  a heredoc that quotes one is written with a file tool instead.
- Generating text that contains backticks: a quoted heredoc (`<<'EOF'`) or a Python string. An
  unquoted heredoc executed the backticks as commands and pasted source into three PR comments
  (2026-09-06). `cat` the script before running it.
- commitlint: a body line of the form `word: value` turns the rest into a footer, and footer lines
  are capped at 100 characters; a wide markdown table in a commit body failed `CI / commits`
  twice.
- With several PRs open, merge the most-refreshed one first (the one repeatedly updated to `main`);
  every merge re-queues the rest.

## Checks before a PR merges (single source)

The **single source** for merge quality is `docs/ops/review-gate.md`: the native
`required_review_thread_resolution` (line-level threads must be resolved before a merge) plus the
two required checks `PR Verification`/`Security` plus the global hook
`~/.claude/hooks/check-pr-comments.sh` (before `gh pr merge` it enforces the two-way comment
discipline: threads at zero + each qodo/Sonar top-level finding acknowledged by a human; it also
rejects the jump-ahead merge made before the bots have spoken). Retired since 2026-08-31: the
Review Gate aggregate status, the LLM trusted-review seat and the verdict/marker artifacts — they
coupled every merge to a shared model quota; when the quota emptied, every PR went red at once
with no local way out. Review discipline (Standards∥Spec, mutation red-green proof, fresh-head)
stays as a process requirement of `docs/workflow.md` stage 5 and is no longer a merge-blocking
status.

## Merged is not deployed; deployed is not serving (2026-08-25, three times in one day)

1. Tests green ≠ artefact runs: a Worker that answered 500 on every request passed unit,
   integration, typecheck, lint and coverage; nothing had started the build output.
2. Merged ≠ deployed: "CD has started" while a stage job had failed and staging was down for an
   hour; the PR page showed nothing.
3. CD green ≠ something deployed: a run with zero artefacts and every stage skipped is the same
   green as a run that deployed five units.

After a merge, check three things: the CD run's `conclusion`, its artefact count
(`gh api …/runs/<id>/artifacts`), and whether the `stage` job ran or was skipped
(`…/runs/<id>/jobs`). A fix is live only when the origin answers (`curl` status and a content
marker); write that into the AC and say "not inferred from the CD colour". Report "unverified"
rather than "should be fine". `wrangler deploy` returns before the new version serves: a
`/migrate` call three seconds after the migrator deploy once hit the old bundle and reported
success with an unchanged head (#1332), so the migration step now polls the migrator's schema
identity before it posts and re-polls on a 409 (`scripts/delivery/migrate-through-worker.sh`).

## The production approval (owner, 2026-09-23)

A pending production approval is left alone; do not propose rejecting it. The 2026-09-01 rule ("a
waiting approval blocks staging") came from a single CD-wide concurrency group; `cd.yml` now uses
`cd-staging` and `cd-production` groups, and staging deployed normally while a production run
waited for two weeks. Residual: a waiting job still holds its own group, so the next production
job queues behind it; when approving the first production migration, check the run number and
artefact so an old snapshot is not the one approved. Judging "does it block the queue" starts with
the current `concurrency` blocks in `cd.yml` and `gh run list --workflow cd.yml`. When CD reaches
the production gate, say so loudly with the run URL: the owner asked for the highlight after
approving unprompted on 2026-06-30 (`docs/ops/deployment.md` describes the gate).

## Workflow incidents are issues, not PRs (owner, 2026-09-16)

"这种和工作流本身有关的，不需要提 pr，只需要提 issue，记录问题本身和解决方案". An Orca or coordinator
incident is opened through `/to-tickets` like any issue (the template is in the first section);
the raw record is the session transcript, and coordinator logs are corroboration. Bulk reading
goes to a sub-agent (sonnet for research, fable for synthesis); scan for secrets before posting
(`docs/agents/infra-and-secrets.md`).

## Dispatching sub-agents (2026-09-19)

Seven forks were given one shared output directory; three of them re-read the dispatcher's plan
as their own task, redid all 157 cards and overwrote their siblings' verdicts. A fork inherits the
full context, plan included. Every fork gets a private output path and a prompt that names the
sibling roles and says what is not its job. Also: `a && b && c` stops silently at the first
non-zero exit, and `grep` with no match is non-zero, so a "not found" conclusion is rerun on its own
before it is reported.
