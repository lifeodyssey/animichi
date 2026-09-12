# Animichi Orca project setup

This is the project entry point for the backend, Infra and CI/CD delivery workflow.
The operating rules live in [Orca card delivery](../ops/orca-card-delivery.md);
the [coordinator prompt](orca-coordinator-prompt.md) applies them to one card.
Implementation and fix workers must invoke Matt `/implement`. Independent review
workers must invoke Matt `/code-review` and follow the actual installed skill.

## Where to see the configuration

- Orca project settings hold the repository base ref, setup command and nesting limit.
- Orca Tasks -> GitHub -> Projects -> **Animichi Delivery** shows the GitHub cards.
- Orca's orchestration views show native Runs, Tasks, Dispatches and messages.
- Pin this file in the editor, or open it through the project Quick Command
  **Animichi delivery setup**. A portable Quick Command is:

```sh
orca file open docs/agents/orca-project-setup.md --worktree current --json
```

These Markdown files are prompts and operating instructions, not an Orca YAML
configuration format. Moving a card alone does not start an agent.

## Project settings

Use the selected Orca executable to load the installed `orca-cli` and
`orchestration` guides before changing or operating the project.

| Setting | Project value |
|---|---|
| Independent worktree base | `origin/main` |
| Setup command | `pnpm install` |
| Setup policy | Run by default; wait for successful setup before task delivery |
| Nested worker maximum depth | `2` |
| Coordinator | Codex `gpt-5.6-sol` / `medium` |
| Development and every fix | Codex `gpt-5.6-sol` / `max`, invoking Matt `/implement` |
| Independent reviewer | Grok `grok-4.6` / `xhigh`, invoking Matt `/code-review` |
| Review fallback | Codex `gpt-6-astra` / `xhigh` when Grok allowance or identity is unverified |
| Worker presentation | Noninteractive execution without visible Chat or TUI panes |

A fresh reviewer and all its review descendants must differ from every model
that authored the current candidate, including corrections. Effort, account and
CLI differences do not make the same model independent. Dispatch one reviewer
entrypoint; the installed skill owns its child organization.

Resolve the actual installed Matt skill files before dispatch and put their
paths and hashes in the private task brief. Do not substitute a generic method
when the skill cannot be loaded. Publication belongs to the coordinator.

## Task board

Use [Animichi Delivery, GitHub Project #3](https://github.com/users/lifeodyssey/projects/3).
Retain existing cards, titles and unrelated status options when configuring it.
The delivery-specific Status values are:

```text
Ready for Dev -> In Dev -> Dev Done -> Ready for QA
```

Keep **Dev Done** throughout local review/fixes, regular PR creation, PR feedback
and required checks. Move to **Ready for QA** only after GitHub confirms the squash
merge. Product acceptance testing and owner-facing Ready for Review follow later.
Do not add board columns or rename card titles for internal review steps.

Disable automatic item-closed, PR-merged, PR-linked or item-added transitions that
would bypass those stages. Preserve unrelated project automations. Discover live
project item, field and option IDs through GitHub before changing an item; never
reuse a runtime terminal ID as a GitHub field identifier.

## Start a card

First complete the initial MVP delivery proof using the orchestration configuration
changes. Only after that passes, inventory existing Ready for Dev and open-PR
backend/Infra/CI-CD cards and maximize independent work within dependencies,
ownership and available resources. Preserve every other active worktree.

1. Keep Orca and the long-lived coordinator session running. Use Sol medium for
   the coordinator and load the installed Orca skills.
2. Select the admitted card and read its current scope, readiness, dependencies,
   ownership and any existing PR. Do not create a second PR for an existing outcome.
3. Run the [coordinator prompt](orca-coordinator-prompt.md) for that card. A concise
   instruction to the coordinator already in this checkout is:

```text
Read docs/agents/orca-coordinator-prompt.md and execute it for issue #<NUMBER>.
Use the installed orca-cli and orchestration skills. Start only this card.
```

The coordinator owns the wait/check/reply loop, candidate commits, PR publication,
comment resolution and merge verification. This MVP does not install a scheduled
backlog consumer or restartable service. Headless workers remove the worker UI;
they do not replace the coordinator with an event-only controller.

The [headless launcher commands](../../scripts/orca-headless/README.md) are the
worker entry point. The coordinator supplies the private role spec, existing
workspace, native Run and coordinator handles, and fixed model selection. Each
attempt gets a new private receipt directory; status and accepted cleanup use it.

## Headless compatibility boundary

Orca 1.4.200 has no public headless `worker-start` flag. Selecting Terminal chat
starts an interactive TUI; it does not select a print-mode worker. `orca serve`
hosts the runtime without a desktop window and is not a worker-mode switch.
Do not start a second runtime for the same setup while the desktop host is active.
See [Orca remote servers](https://www.onorca.dev/docs/remote-servers).

The tested local compatibility path uses the installed RuntimeClient's
`terminal.create` with `presentation=background`, then the public `task-create`
and `dispatch --return-preamble` operations. It passes the exact native preamble
into Codex `exec` or Grok `--prompt-file` with file input/output. No installed-app
patch or visible-mode fallback is part of this path.

The runtime parameter is internal and version-specific. Verify compatibility
before mutation and fail closed when it cannot be established. Native Run/Task/
Dispatch and message authority remain in Orca; local files hold private receipts
and transcripts, not a second task database.

Low-level Dispatch creates no supervised process resource. `worker-release` may
return `retained`, `no_owned_resource` and `processAction: none`; that result does
not prove the process was closed. After accepting a bound settlement, verify the
actual agent exit and the exact recorded terminal incarnation before closing only
the launcher's owned terminal. Preserve ambiguous startup/release receipts for
native recovery; never infer exit or launch a replacement from silence.

A complete acceptance receipt must prove actual startup, model/effort, native
messages, completion, process exit and cleanup. UI absence alone is insufficient.
Keep raw prompts, capabilities, local installation paths and session identifiers
out of public issue updates and PR descriptions.

## Model compatibility and allowance

Orca 1.4.200 rejects Astra `max` in its normal launch catalog even when the local
Codex CLI supports it. The owner selected temporary **Astra xhigh** for the MVP.
Do not silently lower other roles' effort or restore max without verifying Orca
compatibility. Track this in [review #1614](https://github.com/lifeodyssey/animichi/issues/1614).

Before Grok admission, verify current remaining allowance, observation time and
actual `grok-4.6` / `xhigh` identity. `grok usage` is historical session usage,
not remaining subscription allowance. A stale cache or unsuccessful refresh
cannot establish availability; use the configured fallback and record why.

General subscription-based selection, a provider pool and low-allowance Matt
`/handoff` are deferred to [enhancement #1619](https://github.com/lifeodyssey/animichi/issues/1619).
They do not expand this MVP into a scheduler or change the review budget.

## Verification and rollout

Track the rollout in [Orca harness #1612](https://github.com/lifeodyssey/animichi/issues/1612)
and its existing `orca harness` issues. Keep configuration, local tests, independent
review, PR feedback and confirmed merge as separate evidence boundaries.
A successful configuration probe alone does not prove the full MVP.

The [PR feedback inventory](../../scripts/orca/README.md) reads top-level comments,
submitted reviews, threads and replies. It never grants merge approval; required
checks and the actual [review gate](../ops/review-gate.md) remain mandatory.
When every PR review bot explicitly reports exhausted allowance, no further bot
review is awaited. Record the quota notices as non-actionable; existing findings,
the independent Matt review and required CI still must pass before squash merge.

Pin the configuration revision and verify its files exist in each new worktree.
If the candidate uses an earlier revision, use the pinned coordinator checkout's
tools without copying unrelated working-tree changes into the candidate.
