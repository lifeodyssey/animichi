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

## A path no gate covers cannot be pushed (2026-11-19)

The pre-push gate (`scripts/local-gates/pre-push-affected.sh`) refuses a changed path that no
selected package, fired bucket or `NO_PACKAGE` entry owns, with "no gate covers"
(`docs/ops/local-gates.md`, "Failure handling"). `recovery/` is tracked
(`scripts/local-gates/check-root-allowlist.sh` names it) and owned by none of them, so #2072 took
out its commit that removed a machine-local path from a note under `recovery/`; whether
`recovery/` joins the whitelist, as the archived `supabase/` directory does, is left to the owner.
Before planning a change outside every package, check that the gate covers the path, and split
out what it does not cover rather than route around the gate.

## A pre-push timeout is not yet a flake (2026-11-19)

A push whose affected set includes `packages/contract` runs contract's whole downstream
(`docs/ops/local-gates.md`), and on a loaded machine its timing-sensitive tests fail on things the
change cannot reach:

- #2075's first push stopped on `chat-page-clarify-pick`, which timed out under the gate's full
  load; the test passes on its own and depends on nothing #2075 changed, and the second push passed
  ([merge report](https://github.com/lifeodyssey/animichi/pull/2075#issuecomment-7004850624)).
- #2077's push took four attempts: on a heavily loaded machine three failed on timing-sensitive
  tests the change does not reach, each of those passed when run alone, and the fourth passed once
  the load dropped
  ([merge report](https://github.com/lifeodyssey/animichi/pull/2077#issuecomment-7015696475)).

Check the machine's load before such a push. When the gate stops on a timeout, first check that
the branch does not touch the test's imports or handlers, then run the file alone several times
and compare its duration with the limit. Until the test passes alone, the timeout is unproven, not
a flake; retry only after that. Never route around the gate with `--no-verify`
(`docs/agents/commit-and-pr-hygiene.md`). When the packages' suites ran side by side, `apps/web`'s
vitest run blew its 5 s budgets (#1503); that is why the gate runs one package at a time
(`docs/ops/local-gates.md`).

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

"任务完成了记得要删掉 worktree." The instruction stands for the stale-directory reason, not the one
originally given: the 2.2 GB per worktree was a `du` artefact. Measured with `df`, a `pnpm install
--frozen-lockfile --ignore-scripts` on an empty worktree consumes about 46 MB, and the 2026-09-16
disk-full incident came from the container runtime's sparse virtual disk (its path is in the
machine-local notes) — leaked anonymous volumes
([#1798](https://github.com/lifeodyssey/animichi/issues/1798)) plus the images of a retired service
(21 `public.ecr.aws/supabase/*` images, 17.6 GB). The investigation is recorded on
[#1778](https://github.com/lifeodyssey/animichi/issues/1778).

**Measurement rule:** `du` overstates clone-shared blocks on APFS with a cloning package manager and
`ls` overstates a sparse file's logical size, so read free space with `df`.

Done means the branch's PR is MERGED (`gh pr view --json state`) or the card is closed;
`git merge-base --is-ancestor` is never true after a squash merge. Three checks before removal:
`git status --porcelain` empty, no
runner in that directory, no unpushed commits — either `HEAD` equals the merged PR's head SHA
(`gh pr view <n> --json headRefOid`) or there are no commits beyond the upstream
(`git rev-list origin/<branch>..HEAD` empty; an ancestry test against `main` is always
false after a squash merge and is not the test). An agent need not run in a directory to depend
on it: a brief can send it there to read library source or `node_modules`, so also check that no
running agent's brief names the directory (2026-11-20). Then `git worktree remove <path>` and
`git branch -D <branch>`; GitHub deleted the remote
branch at merge. Worktrees that are not the pipeline's (the owner's own, the main checkout) are
not touched. The e2e lane derives its port per checkout (`E2E_EMITTED_WORKER_PORT` in
`e2e/AGENTS.md`), so removing a worktree no longer disturbs a running browser lane.

When a cleanup meets files nobody can vouch for, they are not deleted: they go into one backup
worktree, are checked one by one, not sampled, and stay reachable through git ("如果你不确定的话，就给我留个备份的worktree专门用来放这些，记住不要抽查，要一个个核对",
"确保通过git可以找到所有的东西，不要直接删除", owner, 2026-09-13). "Reachable through git" means a ref, not
just a working-tree file: an untracked or uncommitted file moved into the backup worktree is
committed there (a scratch backup branch or commit) before the worktree can be removed, or it is
lost with the directory. A file that carries a credential is the exception: it is checked for a
secret first and, if it has one, kept only in the private local backup — never made reachable
through git, where a push would place it in repository history. When the test for a bulk
deletion stops working (183 local branches that an ancestry test could not classify after squash
merges, 2026-09-18), each candidate is judged on its own, by a sub-agent if there are many. A cleanup
also looks for commits that were never pushed and worktrees whose PR has merged ("还有更多做了没推的嘛？还有做完了worktree没删的吗",
2026-09-18).

## When a brief touches `AGENTS.md` or `docs/`

Run `bash scripts/local-gates/check-agents-refs.sh` and
`bash scripts/local-gates/check-docs-paths.sh` before reporting; a writer once added a path that
did not exist to a package guide, and the stacked card above it found the gate red (2026-09-07).
Defensive boundaries are verified in reverse, asking not "did I block it" but "what are all the paths to
the protected target": a message-length cap on one route left three other callers of the same
handler uncapped.
