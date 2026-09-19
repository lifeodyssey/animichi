# Orca coordinator handoff — 2026-09-19

State at `371819375`. Written for a fresh coordinator picking up mid-flight. Everything here is
either live state or a pointer; the reasoning lives in the issues and PRs it references.

## Role

Orca coordinator for `lifeodyssey/animichi`. Dispatch writer lanes through the headless launcher;
**never write product code directly**. Own commits, pushes, PRs, merges and the board. Maximise
concurrency — the owner has said repeatedly to dispatch anything without a genuine file conflict and
not to impose a cap. Ask the owner only about money, production, secrets, scope, or rule exemptions.

## Live right now — five lanes

All on `command-code` / `deepseek/deepseek-v4-flash` / `max`. Briefs are at
`/private/tmp/animichi-lane-<id>/brief.md`, reports land beside them.

| card | worktree | what it is |
|---|---|---|
| #1628 | `orca-1628-lane` | the catalog Prisma connection shape; **unblocks #1629/#1630/#1631** |
| #452 | `orca-452-lane` | split "could not verify" from "credential rejected" at the edge |
| #469 | `orca-469-lane` | ship a CSP for `apps/web` — the BYOK spec's OQ-6 precondition, never met |
| #1814 fix | `orca-1690-lane` | `web-chat-save-login-wall.spec.ts:169` red in CI |
| #1815 fix | `orca-1650-lane` | docs hygiene reads test fixtures as broken `docs/` links |

**Settle each with `orca orchestration task-update --id <task_id> --status completed|failed`** —
note it is `orchestration task-update`, not `task-update`, and the status vocabulary is
`pending|ready|dispatched|completed|failed|blocked`.

## The stack that is waiting on #1628

#1629 (outbound adapters), #1630 (ingest pipeline), #1631 (api surfaces) all need #1628's connection
shape and all touch **different subdirectories** of `workers/catalog/src`. So they are three
siblings on one parent, not a chain:

```
main
 └── 1628
      ├── 1629   ├── 1630   └── 1631
```

Dispatch them as stacked PRs (base pointing at #1628's branch) as soon as #1628 has a commit — do
not wait for it to merge. An audit confirmed the Prisma flip (#1767) did **not** deliver them:
`git grep -l drizzle-orm -- workers/catalog/src` still finds 26 files, zero Prisma imports.

## Two PRs are red, both for real reasons

#1814 and #1815 have auto-merge armed, so they will land the moment CI goes green — the lanes above
are fixing them. Neither is waiting on anything else.

Separately, `github-advanced-security` fails on every PR with *"The requested model is not
supported"*. It is **not** a required check, so it blocks nothing — that is #1639, already filed.

## What the owner is paying for, and the deadline

The Command Code Go subscription **expires 2026-09-20** with ~45% of its quota unused. The owner's
explicit instruction is to spend it. Writer priority while it lasts:

`command-code deepseek/deepseek-v4-flash max` > `pi opencode-go/deepseek-v4.1-flash max` ≡
`pi bigmodel/glm-5.3-flash max` > `claude claude-opus-5 high` > `grok grok-4.6 xhigh`

Command Code and pi's opencode-go are **different products with different model ids** — Command Code
has no `v4.1`. Details and the launcher's flags: `[[project-writer-priority-2026-09]]` in the
coordinator's memory.

## Three things that will bite a fresh coordinator

**1. Check a card is still real before dispatching it.** On 2026-09-19 three of four dispatches hit
stale premises — one card had shipped two weeks earlier and was nearly rebuilt. Read the card body
in full (blocked-by lines sit at the end and get truncated), and `git grep` for the product on
`origin/main`. The lanes caught all three themselves; that was luck, not process.

**2. The board does not close cards when their work merges.** 51 of 157 open cards with merged PRs
were simply never closed — see **#1816** for the cause and the measurement. Two mechanisms: the
repo's `Refs: #…` convention never closes anything, and `Closes #a, #b, #c` closes only the *first*
(GitHub's docs: *"use full syntax for each issue"*). Both are now guarded — the detached push script
refuses to create a PR whose body closes nothing, and `squash_merge_commit_message` was changed from
`BLANK` to `PR_BODY` so commit bodies stop being discarded at merge.

**3. `gh pr update-branch` and local pushes do not mix.** Using both on one branch produces a
non-fast-forward rejection, and pulling GitHub's merge commit back drags `main`'s squash commits
into the push range, where the pre-push gate rejects their `(#N)` subjects (**#1804**). Pick one:
either GitHub's update-branch throughout, or local rebase + `--force-with-lease` throughout.

## Merge protocol that works

Arming auto-merge is a **foreground** action so it passes `~/.claude/hooks/check-pr-comments.sh`;
the mechanical branch update is automated because it does not. Order matters:

1. wait for the bot window (the hook blocks for 10 minutes after a push, then permits — *"or the
   window passes in silence"*, which is the documented second exit, not a bypass);
2. read and resolve threads;
3. `gh pr merge <n> --squash --delete-branch --auto` — **always with a literal PR number**, the
   hook cannot parse a loop variable;
4. leave `/private/tmp/pr-autoupdate.sh` running; it updates armed-but-behind branches.

Squash is now the only permitted merge method, enforced at the repo rather than by discipline.

## anitabi egress — done except the deploy

The whole chain landed today: fixed egress address allocated and given to the upstream, the API
document pinned at upstream `api.md` `513aa80e` with path-level drift detection, a PreToolUse guard
on all six agent CLIs, the service itself (#1806), and `INGEST_SIGNING_KEY` present in ESC staging,
ESC prod and Fly.

**Remaining: one manual `fly deploy`** — an owner-granted exemption to `block-local-deploy`.
Runbook: `docs/ops/anitabi-egress.md`. Deferred hardening: **#1809**; the rate ceiling does not
survive a restart and the owner chose an external store — **#1810**.

## Open findings a fresh coordinator should not rediscover

- **#1811** — production's ESC carries **none** of the four runtime vendor keys. Production CD would
  stop at `Apply database access` today, independently of anything recent. Read this before blaming
  a card for a production release failure.
- **#1813** — `.env.test` is loaded by nothing, so the documented local login proof fails by name.
- **#1798 / #1778** — the container runtime, not worktrees, filled the disk. Host went 20 GiB → 57
  GiB free by pruning volumes and 21 retired Supabase images (17.6 GB). The per-run volume leak is
  unfixed. `ls` on colima's `diffdisk` reads its sparse cap, not its occupancy — only `df` is true.

## The one pattern worth carrying forward

Nine separate defects found on 2026-09-19 were the same shape: **a check whose real scope differs
from the scope its name claims**, in both directions. Empty coverage reports passing the gate; four
e2e specs no script ever named; grant postchecks that answer "yes" for any `neon_superuser` member;
a mutation suite whose helper could not locate its target; contract tests that would not go red on a
new destination parameter; a disclosure scan skipping dotfiles; a single-fetch-site rule walked
around by aliasing `node:http`; config validation accepting `Infinity` as a rate ceiling; and docs
hygiene flagging test fixtures as broken links.

None of them produced a failure signal. The question that found every one: **"what would have to
happen for this check to go red?"** Ask it of any guard being cited as proof.

## Suggested skills

- **`orca-cli`** — first, before any Orca command. It loads the version-matched guide from the
  running executable; the command surface has already drifted once mid-session.
- **`/implement`** (Matt) — every writer brief names it; read what it expects before writing one.
- **`/investigate`** — for the red-CI diagnoses, rather than reading workflow logs by hand, which
  burns context fast.
- **`use-opencode`** — if the Command Code subscription lapses on 2026-09-20 and the pool falls back
  to `pi`.
- **`/review`** — when the bots are rate-limited and a PR needs a substantive read. A Grok seat
  reviewing a Command Code diff satisfies the different-model rule.

## Standing constraints

- The repository is **public**. No key value, no egress address, no credential in the tree in any
  form — including as a placeholder, a default, or a fixture.
- Commit subjects and PR titles: `<type>(<scope>): <outcome>`, ≤72 chars. Scopes are fixed and there
  is **no `ops` scope**; `docs(repo)` is the usual home for repository documentation.
- Never add a `Co-Authored-By` trailer naming an AI tool. Lanes emit one; strip it before pushing.
- Lanes never push, never open PRs, never deploy. Those are the coordinator's, and so is closing an
  issue.
