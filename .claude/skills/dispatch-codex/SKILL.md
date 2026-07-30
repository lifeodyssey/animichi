# Dispatching Codex

Invoke before handing any coding task to Codex. Everything here was learned the
expensive way on 2026-07-30: **17 dispatches, zero that delivered end-to-end**,
until the causes below were found. None of them was Codex being bad at code.

## The one that explains most of the failures

**Give Codex a `git clone`, never a linked worktree.**

A linked worktree keeps its git metadata in the *parent* repo's
`.git/worktrees/<name>/`, which is outside Codex's writable root. Reads work, so
`git status` and `git diff` succeed and everything looks fine — then every
`git add` dies with:

```
fatal: Unable to create '.../.git/worktrees/<name>/index.lock': Operation not permitted
```

This is why "Codex never commits its work" looked like a discipline problem for
a whole day. It was never able to.

```bash
git clone --local --no-hardlinks -q . <dest>
cd <dest> && git remote set-url origin <github url> && git fetch -q origin main
git reset --hard origin/main && git checkout -b <branch>
```

Two traps in that recipe:

- `git clone --local .` clones your **local** `main`, which is very likely
  stale. Reset to `origin/main` or Codex builds on the wrong base.
- The clone has no `node_modules` / `.venv`. Install before dispatching — the
  sandbox has no network (below).

A related symptom with the same shape: `failed to initialize sqlite state
runtime under ~/.codex`. That one kills the run before it reads any code, and a
fresh broker (new working directory) is the only fix found so far.

## The sandbox has no network

`git fetch`, `git push`, `gh`, `pnpm install`, `uv sync`, `pulumi preview` — all
hang or fail. Consequences:

- **Build the environment first.** Worktree/clone, correct base, all
  dependencies, and verify the gates actually run before you dispatch.
- **`gh` is unavailable**, so Codex cannot read PR comments or resolve threads.
  Export what it needs to a file in the working directory and say so.
- Put "if anything is missing, STOP and report — do not install, do not reach
  the network" in the brief. **This instruction works.** Codex reliably stops
  rather than improvising.

## Getting the report back

The forwarding wrapper times out around two minutes. Codex frequently runs eight
to ten. A finished, correct report can therefore be lost entirely.

The report is still on disk:

```
~/.claude/plugins/data/codex-openai-codex/state/<dir>/jobs/<task-id>.log
```

Ask for findings **incrementally** rather than in one final message, and read
the log rather than trusting the wrapper's return value.

## Judging whether it is alive

Two hard signals, and only these:

1. `stat -f %m` on the job log — is it still being written?
2. A real `git status` diff in the target directory.

Task IDs, the wrapper's return message, and `/codex:status` are **not**
evidence. `ps | grep codex` is unreliable — it has missed live processes.

```bash
L=$(ls -t ~/.claude/plugins/data/codex-openai-codex/state/*/jobs/<id>*.log|head -1)
until [ $(( $(date +%s) - $(stat -f %m "$L") )) -gt 120 ]; do sleep 30; done
```

## What the brief must contain

- **Working directory, plus `pwd` / `git rev-parse --abbrev-ref HEAD` /
  `git log --oneline -1` echoed back in the report.** Codex has written into the
  wrong worktree before.
- **Every gate command in full, with `uv run` / `pnpm run` prefixes, each one
  run by you first.** A brief that says `mypy` instead of the real invocation
  wastes a whole dispatch. In this repo bare `uv run mypy` fails with "Missing
  target module" — the working command is the file list in `Makefile:87`.
- **The current baseline numbers**, so a regression is visible.
- **The house rules**, especially: no suppressions, the 1-10-50 caps, no `any`.
  Say explicitly that *a suggestion which can only be satisfied by silencing a
  rule is not to be actioned.*
- **What "done" looks like as a file**, when the deliverable is analysis. A
  triage with no written record is not deliverable, and asking for it in the
  report is not enough — the report can be lost.

## What to expect from the output

The pattern is consistent: **the judgement is good, the process is not.**

Real examples from one day — converging duplicated predicates, separating types
instead of patching a branch, correctly distinguishing two identical-looking
`is not None` checks with different meanings, and independently deriving that
declaring a DNS record next to a Cloudflare-owned one would fight for
ownership.

And, the same day: pushing two functions over the line cap to satisfy a linter
bot, deleting a module docstring that recorded why the tests existed, leaving an
import of a symbol it had just removed, and hardcoding a value the library
already exports.

So: **take the code, verify everything.**

1. Commit the output first — even in a clone, assume it may die mid-step.
2. Run every gate yourself. Never trust a "gates pass" claim; one report said
   "Mypy: NOT RUN" while the summary read as success.
3. Mutation-test the tests it wrote. Assert the mutation landed on the intended
   structure first — a mutation that fails to parse is a **false kill**, not a
   passing test.
4. Read the diff for house-rule violations, not just correctness.
5. Check test *names* still describe their assertions. Codex flips an assertion
   and leaves the name saying the opposite.

## Do not

- `codex exec --sandbox workspace-write` — blocked by the
  `block-codex-exec-codewrite` hook.
- Dispatch into a directory another agent is editing. Two writers in one tree
  produced silent conflicts more than once.
- Dispatch into a long-lived worktree. Delete and recreate, or clone fresh — old
  brokers are the ones that fail to start.
