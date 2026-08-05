---
name: use-codex
description: >
  How to use OpenAI Codex in this repo under current policy — Codex is the spec
  adversarial-review seat (dual-seat with Fable, model gpt-5.6-sol at effort xhigh)
  and the visual-capable inspection fallback. Raw `codex exec` remains forbidden for
  code. Read before any Codex dispatch.
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Using Codex from Claude Code (current policy)

## Codex's role in this repo

Code-writing is Policy-C'd to opencode (see `use-opencode`). Codex has exactly two jobs:

1. **Spec adversarial review** — the dual-seat seat B: `/codex:adversarial-review` with
   `gpt-5.6-sol` at effort `xhigh`. Seat A is Fable. Findings → planner revises →
   re-review → owner sign-off. A spec without both seats signed off is not executable.
2. **Visual-capable inspection fallback** — inspection work that needs eyes
   (screenshot judgment) which text-only executors cannot do.

Raw code-writing via the CLI is still forbidden: `codex exec --sandbox workspace-write`
is blocked by the `block-codex-exec-codewrite` hook, and `guard-codex.sh` blocks
concurrent or looped invocations.

## The one rule that has never changed

Never run the raw `codex` CLI concurrently or in a loop. Two raw processes fight over
the same Codex websocket → `403`/`429` **connection contention** (not a resettable rate
limit), each one still burns quota, and retrying makes it worse. Route everything
through the managed plugin — it serialises over one app-server connection.

## Dispatch recipe

- Review: `/codex:adversarial-review` (pass the spec, model + effort).
- Manage: `/codex:status`, `/codex:result`, `/codex:cancel`.
- The forwarder returns before Codex finishes — arm a `Monitor` keyed on the job log
  going quiet; the report lives at
  `~/.claude/plugins/data/codex-openai-codex/state/*/jobs/<task-id>.log`.
  Ask for findings incrementally; never trust the wrapper's return value.

## Sandbox facts

- No network: `git fetch/push`, `gh`, `pnpm install`, `uv sync` all hang or fail.
  Build the environment and verify every gate yourself BEFORE dispatching.
- `gh` is unavailable → export PR/thread context to a file in the working directory.
- Brief must include: "if anything is missing, STOP and report — do not install, do
  not reach the network."

## Commits

Codex's sandbox refuses most `.git` writes (`Operation not permitted`); occasionally it
commits anyway. When the job stops: `git -C <target> log --oneline -3` **and**
`git -C <target> status --short`; commit anything uncommitted yourself immediately.
Then run every gate yourself — a "gates pass" claim is not evidence.

## The brief must contain

- Working directory, plus `pwd` / `git rev-parse --abbrev-ref HEAD` /
  `git rev-parse --short HEAD` echoed back in the report. Give the full SHA, never a
  truncated commit message — a truncated message is a trap you set for yourself.
- Every gate command in full, with `uv run` / `pnpm run` prefixes, each one run by you
  first. In this repo bare `uv run mypy` fails — the sanctioned invocation is
  `make typecheck` (file list in `Makefile`).
- Baseline numbers measured in *this* directory, never copied from a sibling clone.
- The house rules: no suppressions, 1-10-50, no `any`. State explicitly that a
  suggestion which can only be satisfied by silencing a rule is not to be actioned.
- What "done" looks like as a file when the deliverable is analysis — the report can
  be lost, so the findings must land on disk.

## Do not

- `codex exec` for code (hook-blocked).
- Dispatch into a directory another agent is editing — two writers in one tree produce
  silent conflicts.
- Dispatch into a long-lived worktree. Delete and recreate, or clone fresh — stale
  brokers are the ones that fail to start.
