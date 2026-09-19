# Orca coordinator handoff — 2026-09-19

Written for a fresh coordinator picking up mid-flight. Everything here is either live state or a
pointer; the reasoning lives in the issues and PRs it references.

**26 PRs merged since 2026-09-18**, 197 cards open after 51 were closed with evidence. Companion:
`LESSONS.md` beside this file — read §1 before trusting any guard, and §6 before writing a brief.

## Role

Orca coordinator for `lifeodyssey/animichi`. Dispatch writer lanes through the headless launcher;
**never write product code directly**. Own commits, pushes, PRs, merges and the board. Maximise
concurrency — the owner has said repeatedly to dispatch anything without a genuine file conflict and
not to impose a cap. Ask the owner only about money, production, secrets, scope, or rule exemptions.

## Live right now — one lane, and a stack that cannot land yet

One lane runs: **#1628 fix round 2**, in `orca-1628-lane`. Everything else in the Prisma chain is
committed and waiting on it.

### The stack, and why it is stuck

```
main
 └── 1628  connection shape — two pre-push failures, second fix in flight
      ├── 1629  ✅ committed `a12a8f3c2` — outbound adapters converted
      ├── 1630  ⛔ stopped with no commit — a missing primitive, see below
      └── 1631  ✅ committed `ca3147aa2` — search + spots converted
```

**#1629 and #1631 cannot be pushed until #1628's gate passes**, because they inherit its commits and
therefore its failures. When #1628 lands a green tip, restack both onto it before pushing.

They do not conflict with each other: #1629 touched no shared file, #1631 needed two call sites in
`workers/catalog/src/router.ts` and said so. **`router.ts` is the seam the subdirectory split
missed** — three lanes own three subdirectories, and that file is where all three wire in. A
tree-shaped ownership split cannot partition a point-shaped convergence; the same failure mode as
`pnpm-lock.yaml`.

### #1628 has failed the gate twice, for two unrelated reasons

Both were caught by the pre-push gate, and **neither was visible to `workers/catalog`'s own 94-file
pool**, which was green each time.

1. **Two of its own memoization tests failed under the full suite.** Diagnosed (not guessed): the
   test dynamically imports `src/db/prisma` *inside* each case after `vi.resetModules()`, so it pays
   a cold graph transform against the pool's 20 s `testTimeout` — a cost the other 93 files pay in
   their import phase, which no per-test budget governs. **A vitest timeout does not stop the test
   body**, so the timed-out case ran on and called the constructor twice, failing the next test too.
   Cause and consequence, not one defect twice. Fixed in `b9e2e6d2f` without touching
   `src/db/prisma.ts`.
2. **`packages/agent/integration-test/catalog.test.ts:78` — `/catalog/nearby` returns 500** to a
   real cross-package caller. A second lane independently observed this from #1631's side. This is
   the expensive shape: catalog's own suites test the handler; the agent's test calls it over the
   wire against a real database, and only that sees a runtime that is assembled differently. Fix
   round 2 is running.

   A lead worth checking, from #1629's lane: the driver **decodes `count`'s `int8` as a string**. A
   value crossing the boundary in the wrong shape fails at the far end, not at the query.

### #1630 is blocked on a missing primitive, and the decision is already taken

The contract-bound Prisma SQL builder has **no `INSERT … ON CONFLICT`**. Nine operations in the
ingest slice are upserts and three are *guarded* upserts whose `WHERE` clause **is** the concurrency
control (the `ingest_jobs` singleflight). So `git grep -l drizzle-orm` over that scope cannot reach
zero — which is the card's own completion test. The lane refused to half-convert and said why.

**Chosen unblock (recorded on #1630): give the seam a conflict primitive** — one helper beside
`CatalogPrisma`: guarded `UPDATE … RETURNING`, else `INSERT`, with `sqlState === '23505'` meaning
"a concurrent writer won" for the guarded case and "retry the UPDATE once" otherwise. It needs
`src/db/prisma.ts`, so it belongs to #1628 or a successor. The two rejected options and why are in
that comment.

**`428C9` — `enrich.ts` writing the generated `points.latitude`/`longitude` — lives inside the point
upsert**, so splitting the card would leave the bug it exists for unfixed.

## Open PRs

| PR | what | state |
|---|---|---|
| #1815 | docs-hygiene stops reading test fixtures as broken links | behind/blocked, auto-merge armed |
| #1817 | this document and `LESSONS.md` | behind/blocked |
| #1818 | nonce-based CSP for `apps/web` (#469) | behind/blocked |
| #1819 | **the owner's own branch**, not a lane's — do not touch | — |

`github-advanced-security` fails on every PR with *"The requested model is not supported"*. Not a
required check, blocks nothing — that is #1639.

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
