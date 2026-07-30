# Dispatching Codex

Invoke before handing any coding task to Codex. Everything here was learned the
expensive way on 2026-07-30: **17 dispatches, zero that delivered end-to-end**,
until the causes below were found. None of them was Codex being bad at code.

## Codex cannot commit. Plan the whole workflow around that.

Every `git add` fails, in every directory shape tried:

```
fatal: Unable to create '.../.git/index.lock': Operation not permitted
```

That is the sandbox refusing to write **anything under `.git`**, not a
filesystem permission — the same path is writable from your own shell. Verify in
one line before theorising: `touch <dir>/.git/probe && rm <dir>/.git/probe`.

**Do not ask Codex to "commit as you go".** It cannot, it will hit the wall
partway through, and — obeying the instruction — it stops there, leaving less
finished work than if you had never asked.

Instead:

1. Ask for **all changes left in the working tree**, plus a written deliverable
   (`TRIAGE.md`, a report file) for anything that is analysis rather than code.
   A finding that exists only in the report can be lost; a file cannot.
2. **You** commit, immediately, the moment the job stops. `git add -A` in the
   target directory is the first thing you run, before reading anything.
3. Then run the gates and review, as below.

> **A correction, kept on purpose.** An earlier version of this skill blamed
> linked-worktree metadata living outside the writable root, and told you to use
> `git clone` instead. That was inferred from a single error message naming
> `.git/worktrees/<name>/index.lock`, and it is **wrong**: a standalone clone
> fails identically on its own in-tree `.git/index.lock`. The clone changed the
> path in the error and nothing else. Kept because the reasoning was plausible
> enough that someone will reconstruct it.

A different failure with a similar flavour: `failed to initialize sqlite state
runtime under ~/.codex`, which kills the run before it reads any code. A fresh
working directory (hence a new broker) is the only fix found, and that one *is*
about where you point it.

### Prepare the environment either way

Worktree or clone, build it fully before dispatching — the sandbox has no
network (below):

```bash
git worktree add -b <branch> <dest> origin/main
cd <dest> && pnpm install --frozen-lockfile --ignore-scripts
(cd apps/agent && uv sync)
```

If you do clone, note `git clone --local .` copies your **local** `main`, which
is very likely stale — reset to `origin/main` or Codex builds on the wrong base.

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

## Arm a monitor immediately after dispatching

**The completion notification you get seconds after dispatching is not the
task finishing.** It is the forwarder returning a task ID. The real work starts
then and runs for another eight to ten minutes with nothing watching it. Treat
that first notification as "queued", never as "done", and never report its
contents as a result.

So the step after every dispatch is to arm a watch. Not manual polling, and not
sitting idle.

**Use the `Monitor` tool, especially with more than one job in flight.** A
backgrounded Bash `until` loop gives you one notification when it exits, which
means one job per loop and nothing until each finishes. `Monitor` turns every
stdout line into its own notification, so a single watch covers all concurrent
jobs and reports whichever one moves:

```
Monitor({
  description: "codex jobs: progress + stalls",
  timeout_ms: 3600000,
  persistent: false,
  command: `
    S=~/.claude/plugins/data/codex-openai-codex/state
    while true; do
      for L in $(ls -t $S/*/jobs/*.log 2>/dev/null | head -6); do
        age=$(( $(date +%s) - $(stat -f %m "$L") ))
        name=$(basename "$L" .log)
        if [ "$age" -gt 120 ]; then
          grep -q "^STOPPED $name$" /tmp/codex-seen 2>/dev/null && continue
          echo "STOPPED $name" | tee -a /tmp/codex-seen
        fi
      done
      sleep 30
    done`,
})
```

**The filter must match failure as well as success.** A watch that only greps
for a completion marker stays silent through a crash, a hang, or a permission
wall — and silence is indistinguishable from progress. Watching for *the log
going quiet* covers finished and crashed alike, which is why the loop keys on
mtime rather than on any particular line.

Two things that break these watches:

- The log does not exist for the first ~30 seconds. An unguarded `stat` on an
  empty path makes the condition true immediately and the watch reports a
  finish that never happened.
- Every stdout line becomes a message, so a watch must de-duplicate (the `seen`
  file above) or one stalled job floods the conversation until the monitor is
  auto-stopped for volume.

A single-job Bash fallback, when `Monitor` is overkill:

```bash
until [ -n "$(git -C <target> status --porcelain)" ] \
   || [ $(( $(date +%s) - $(stat -f %m "$L") )) -gt 120 ]; do sleep 15; done
```

Note the diff check is only an early exit. Removing the mtime clause would make
a run that dies before writing anything wait forever.

The log may not exist for the first ~30 seconds. Guard for that, or the whole
wait collapses immediately on an empty `$L`.

### Judging liveness by hand

Two hard signals, and only these:

1. `stat -f %m` on the job log — is it still being written?
2. A real `git status` diff in the target directory.

Task IDs, the wrapper's return message, and `/codex:status` are **not**
evidence. `ps | grep codex` is unreliable — it has missed live processes that
were demonstrably still writing to their log.

### While it runs

Do not touch the target directory. Reading a half-written file leads to
"correcting" work that was still in progress; two writers in one tree produced
silent conflicts more than once. Pick up other work in a *different* directory,
or wait.

A quiet log is not the same as a finished job — check the tail before deciding.
Codex sometimes stops deliberately (a missing command, a permission wall) and
says so, which is a different outcome from a crash and calls for a different
fix.

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

1. Commit the output first, yourself — Codex cannot, so an uncommitted tree is
   the normal end state, not a sign the run went wrong.
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
