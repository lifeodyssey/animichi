# Animichi delivery in Orca

This is the visible entry point for the reusable project workflow. The operating
authority is [Orca card delivery](../ops/orca-card-delivery.md). This setup does
not admit a business card or start a scheduled automation.

## Where to see the configuration

| Orca location | Configuration |
|---|---|
| Settings -> Orchestration | Installed skill and nested worker depth |
| Settings -> Projects -> Seichijunrei-agent | Main baseline and worktree setup |
| Settings -> Quick Commands | Project workflow document entry |
| Tasks -> GitHub -> Projects | The selected GitHub Project, its fields and cards |
| Workspace editor | This pinned setup page, operating contract and coordinator prompt |
| Agent Dashboard / agent tabs | Running agents; activity is separate from card status |

Orca has no single form containing our complete delivery policy. Roles and gates
live in the tracked instructions; runtime launch receipts verify their effective
settings. GitHub owns business status. Orca Tasks renders that data using its own
project UI; it does not reproduce every GitHub Board layout.

## Project setup

- Repository: `lifeodyssey/animichi`.
- Local checkout: `/Users/lumimamini/Documents/Seichijunrei-agent`.
- Orca repo ID: `bc0ab6a2-c6c8-430b-a985-a2ae29fda868`.
- Saved base ref: `origin/main`; resolve its SHA at admission.
- Saved setup: `pnpm install`, run by default, wait for setup before the agent.
- Saved nesting depth: `2`, supporting the independent review worker's children.
- Capacity: one business card, one candidate writer, one heavy gate suite.
- GitHub Project: [Animichi Delivery, #3](https://github.com/users/lifeodyssey/projects/3).
- No pilot selected; no scheduling, webhook or short-session controller configured.

New worktrees still require the card's environment preflight;
`pnpm install` alone does not prove Python, database, Infra, or integration readiness.

Project ID: `PVT_kwHOAYkhVc4BcrlP`. Status field ID:
`PVTSSF_lAHOAYkhVc4BcrlPzhXSklI`.

| MVP status | Option ID |
|---|---|
| Ready for Dev | `e81ea81f` |
| In Dev | `5fe0f7ba` |
| Dev Done | `1af4ddd8` |
| Ready for QA | `668998e0` |

The former Frontend Rebuild project retains its 90 existing cards and all five
legacy status options with their original IDs. Legacy `Ready` does not admit a
card to this MVP. Update the Project item field, not the issue title.

Verified Project workflows: `Item closed`, `Pull request merged`,
`Pull request linked to issue`, `Item added to project`, and `Auto-close issue`
are disabled. Existing `Auto-add sub-issues to project` remains enabled. The
coordinator owns MVP status transitions and must recheck these settings at admission.

The project-scoped Quick Command **Animichi delivery setup** opens this page in
Orca's editor. It is a terminal command: run it from a shell terminal. The same
file is pinned in the workspace tab bar and available through Explorer -> docs -> agents.

## Roles and start

The [coordinator prompt](orca-coordinator-prompt.md) contains the reusable launch
instructions. Open a Codex coordinator in Orca with `gpt-6-astra` / `medium`, paste
that prompt, and replace its issue placeholder after a card is selected.

The coordinator dispatches developers/fixers as `gpt-5.6-sol` / `max` and reviewers
as `gpt-6-astra` / `max`. All workers use Codex. Prompts require installed Matt
`/implement` or `/code-review` as appropriate; their methods stay in those skills.
Orca's standard Run/Task/Dispatch and waiting loop supervise the card through merge.

## Astra max launch on Orca 1.4.200

This version rejects `worker-start --agent codex --model gpt-6-astra --effort max`
before creating a worker, although Codex itself supports it. Keep the requested
model/effort using Orca's documented custom-terminal path:

```text
orca terminal create --worktree <exact-worktree> --title <review-title> \
  --command 'codex --model gpt-6-astra -c model_reasoning_effort="max"' --json
orca terminal wait --terminal <returned-handle> --for tui-idle --timeout-ms 60000 --json
orca terminal read --terminal <returned-handle> --json
orca orchestration worker-start --task <task-id> --run <run-id> \
  --worktree <exact-worktree> --terminal <returned-handle> --json
```

Require `wait.satisfied: true` before injecting a task. Verify the actual Codex
startup/session reports `gpt-6-astra max` and retain that evidence. A reused
terminal's launch fields are null; they do not prove model identity. Require the
worker-start receipt to show `ready` and an observed turn start. Use this path for
review descendants too, within the same nesting budget. Do not use unsupervised
`dispatch --inject`.

An adopted terminal has an authoritative supervised Dispatch, but Orca records
its process resource as external. After accepted `worker_done`, call
`worker-release`; `retained / external_terminal` performs no process cleanup.
If the coordinator created that terminal solely for this attempt and no user
has taken it over, close its exact handle with `orca terminal close`. Preserve
pre-existing user terminals. Record both the settlement and actual close receipt.

## Status and review records

```text
Ready for Dev -> In Dev -> Dev Done -> Ready for QA
                           |
                           +-- local review <-> fixes (maximum three reviews)
                           +-- create regular PR
                           +-- resolve PR feedback and pass required checks
                           +-- squash merge, then verify the merge record
```

Local review reports and Orca messages exist before PR creation. Issue comments
can link progress and evidence. After creation, feedback remains in PR comments
and threads, with fixing commits and replies. The [feedback tool](../../scripts/orca/README.md)
reads these records; it does not decide that a PR can merge.

QA/acceptance starts after merge. Ready for Review continues to mean ready for
the owner after the later testing stage. Product completion is not automated here.

## Configuration receipt

Verified on 2026-09-12: Orca 1.4.200 saved and reloaded nesting depth 2, project
base `origin/main`, setup run-by-default and wait-for-setup. The project-scoped
Quick Command is saved. GitHub Project #3 is renamed; its 90 pre-existing item
statuses were compared before and after the four new options were added.
The eight existing `orca harness` issues #1612–#1619 are also in this Project as
Backlog items (98 items total); none has been admitted as the business pilot.

The configuration-only Orca Run is `run_038f8eebf84b`; its helper implementation
worker's launch receipt confirms Codex `gpt-5.6-sol` / `max`. Business admission,
the independent review/fix loop and squash merge remain for the selected pilot.

The feedback helper passes 13 offline tests / 51 assertions and real read-only
GitHub captures. The custom-terminal path above has started the independent
Astra max review workers with supervised Orca Dispatches. Round 1 found two
naming-rule violations, one pagination defect and one duplication heuristic;
the Sol fixer owns their correction. The HEAD-guard mutation produced red/green
evidence. This does not prove the business-card review/merge loop.

Before/after `make check` passed: 2,051 unit tests, 246 integration tests and 20
existing integration skips; unit coverage 91.61%. Configuration files and the
helper are local working-tree changes, not a merged configuration PR.
