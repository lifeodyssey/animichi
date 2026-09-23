# Worktrees, commits and pushes — what goes wrong between "done" and "on main"

The hygiene rule is `.claude/rules/worktree-hygiene.md`; the gates are `docs/ops/local-gates.md`.
This file records why each line of those exists.

## A fresh worktree's base is not `origin/main` until you make it so

Worktrees created for parallel writers were up to 490 commits behind the remote tip,
unpredictably, because they branch from a local ref that was never fetched (2026-07-21/24; one PR
redid a 22-file refactor another PR had already landed and arrived CONFLICTING). Every brief
starts with STEP 0: `git fetch origin <base> && git reset --hard origin/<base>`, then
`git rev-list --count HEAD..origin/<base>` must print 0 or the worker stops. Independent
verification checks `git rev-list HEAD..origin/<base>` too; green tests on stale code are green.

## One worktree per agent, including planners and reviewers

Two concurrent planners both ran `git checkout` in the main checkout and one's commit landed on
the other's branch (2026-07-28). The main checkout is shared mutable state: every dispatched agent
gets `git worktree add` and never switches branches in a shared checkout. Concurrent sub-agents
also share one persistent shell cwd, and each tool call may reset it: a `git pull --rebase`
without a `cd` rebased a sibling's worktree onto the wrong head (2026-09-08). Every command in a
brief is `cd <worktree> && …`, and gate reports say which directory they ran in. Per-agent scratch
files do not use fixed names in a shared `/tmp`: two workers wrote the same commit-message file
and one commit took the other's title (2026-09-06). Never run push gates on a tree a writer is
still editing: pre-commit reports "files were modified by this hook" and every sub-gate looks
green.

## Verify the commit and the push before trusting either

- After a commit, `git log -1 --format=%H` must have moved. A pre-commit hook (gitleaks) once
  rejected a commit while the summary line looked like success; the push then carried nothing,
  and the worktree was removed before anyone noticed (2026-07-19).
- After a push, `git ls-remote origin <branch>` must show the SHA you pushed. No worktree or
  branch is removed before both checks pass.
- `git push` resolves the ref when it starts, and the pre-push gate can run 45–60 minutes; a
  rebase or amend during that window is silently overwritten by the old SHA when the push
  completes. Before rewriting a branch, `pgrep -f "git push.*<branch>"`; a running push is judged
  by its child processes rotating, not by the clock (2026-09-07).
- Fixture tokens in tests are obviously fake strings that match no scanner rule (a
  `token-fixture-…` pattern), never high-entropy samples shaped like real keys (gitleaks blocks the
  commit) and never `gitleaks:allow` (a suppression).
  The inverse for probes: gitleaks' `github-pat` rule needs entropy ≥ 3 and its stopwords include
  the alphabet sequence, so a canary that must go red is random and checksum-free.

## Hooks: check they are on

On 2026-09-03 the repository's `.git/config` carried `core.hooksPath=/dev/null` from an unknown
source: every commit was a silent `--no-verify`. The owner decided the hooks stay on. At the start
of a session, especially one taken over from another, `git config --get core.hooksPath` must
print nothing; report anything else. A sub-agent saying "hooks did not fire" is a signal to chase.
When a hook is red from a linked worktree and green from the main checkout, check
`env | grep ^GIT_` (a linked worktree's hook environment exports `GIT_DIR`, and fixture
repositories inherited it; the gate now unsets `GIT_*` at its entry) and
`git config --local user.email` (a fixture once rewrote the shared config's identity).

## Remove the worktree when the PR is merged (owner, 2026-09-17)

"任务完成了记得要删掉 worktree." Sixty-six idle worktrees at 2.2 GB of `node_modules` each filled the
disk on 2026-09-16, and stale directories misled the lane inventory. Done means the branch's PR
is MERGED (`gh pr view --json state`) or the card is closed; `git merge-base --is-ancestor` is
never true after a squash merge. Three checks before removal: `git status --porcelain` empty, no
runner in that directory, no unpushed commits (`git rev-list origin/main..HEAD` empty, or the PR
merged). Then `git worktree remove <path>` and `git branch -D <branch>`; GitHub deleted the remote
branch at merge. Worktrees that are not the pipeline's (the owner's own, the main checkout) are
not touched. The e2e lane derives its port per checkout (`E2E_EMITTED_WORKER_PORT` in
`e2e/AGENTS.md`), so removing a worktree no longer disturbs a running browser lane.

## When a brief touches `AGENTS.md` or `docs/`

Run `bash scripts/local-gates/check-agents-refs.sh` and
`bash scripts/local-gates/check-docs-paths.sh` before reporting; a writer once added a path that
did not exist to a package guide, and the stacked card above it found the gate red (2026-09-07).
Defensive boundaries are verified in reverse, asking not "did I block it" but "what are all the paths to
the protected target": a message-length cap on one route left three other callers of the same
handler uncapped.
