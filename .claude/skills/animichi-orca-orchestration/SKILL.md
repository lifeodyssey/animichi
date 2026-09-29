---
name: animichi-orca-orchestration
description: Coordinate one manual or 30-minute scheduled Animichi delivery tick from Ready for Dev through verified squash merge, supervising Orca workers and board state without editing candidate product files or performing QA.
---

# Animichi Orca Orchestration

Use this skill as the coordinator for one bounded, idempotent delivery tick. It
coordinates Orca Tasks and Dispatches, the live Animichi delivery frontier, and
accepted publication evidence; it does not edit candidate product files, run
tests, deploy locally, perform API/E2E/computer-use QA, or use non-Orca
collaboration or sub-agents.

## Load the current authorities

At the start of every invocation, resolve `orca` with `command -v orca` and
copy that exact executable path into every command below. Load the
version-matched guides before using Orca:

```text
ORCA skills get orca-cli
ORCA skills get orchestration
```

Here `ORCA` means the exact absolute path printed by `command -v orca`; replace
it before running the commands and never invoke the token literally.
Follow those guides and their action-gated references from the same executable;
do not switch executables or guess flags after an error. Read these maintained
project authorities before making a delivery decision:

- `AGENTS.md`
- `docs/workflow.md`
- `docs/ops/orca-card-delivery.md`
- `docs/ops/review-gate.md`
- `docs/agents/issue-tracker.md`

When using a headless attempt, also read the README of the launcher named under
"The roster" below, and use its exact launcher contract. These
documents own Matt's methods, gate details, issue-tracker syntax, and recovery
rules; this skill supplies only Animichi coordination policy and must not copy
their review procedure.

## Bind one tick safely

The caller supplies the Run. Verify the binding with the selected executable's
`orchestration run-current`; if it is not the supplied Run, bind that Run with
`orchestration run-use --id` using the loaded orchestration guide. Never create
a Run or a scheduler for a tick. Keep the
caller's injected coordinator Task/Dispatch identity and terminal handle
exactly; never reconstruct or broaden lifecycle arguments.

Process the bound Run as a FIFO inbox, not as a fire-and-forget queue:

1. Check the inbox with the selected executable's
   `orchestration check --terminal <coordinator-handle> --json` before
   admission and at every natural checkpoint. Process every row in the
   returned Delivery: answer
   questions, handle escalations, and validate each `worker_done` against the
   expected Task ID, Dispatch ID, bound Run, terminal, and explicit outcome.
2. For a `worker_done`, require positive native Task/Dispatch settlement and
   preserve its evidence. Process the settled terminal decision before
   acknowledging the Delivery. A heartbeat, exit code, TUI idle state, timeout,
   stale status, or missing message is not settlement.
3. Acknowledge a Delivery only after every message is handled and every settled
   terminal has a next owner: reuse for an immediate follow-up, explicitly
   retain when requested, or release. For a headless attempt, run, in that launcher's checkout,
   `ruby scripts/orca-headless/orca-headless.rb status --state-dir <attempt>`;
   after the accepted bound `worker_done`, run
   `ruby scripts/orca-headless/orca-headless.rb cleanup --state-dir <attempt>
   --settlement-message <worker_done-message-id>`. Never replace this with raw
   terminal close.

Use finite waits and finish this tick after its report. Unknown or stale
liveness never authorizes retry, stop, abandon, release, or duplicate launch;
only the positive evidence required by the loaded orchestration guide does.
The next scheduled tick continues supervision of unresolved work.

## Recompute the delivery frontier

Build the live frontier each tick from all of these, rather than from a cached
list or one label:

- GitHub Project #3, `Animichi Delivery`, including its current status and
  source fields;
- current GitHub Issues and PRs, native dependencies, and existing candidate
  relationships;
- bound-Run Orca Tasks/Dispatches and worker settlement/liveness;
- every relevant worktree's dirty state, branch/PR ownership, and resolved
  current-base SHA evidence.

`ready-for-agent` alone is not Ready for Dev. Admit only a card with the
project's explicit Ready for Dev authorization, a frozen requirement/spec/AC
set with test types, satisfied dependency evidence, an exact worktree and base,
and no existing writer owning the candidate. Preserve blocked and backlog cards
and existing candidate work; treat dirty worktrees as owned state and preserve
them byte-for-byte. Do not reset, clean, overwrite, or create a replacement
because an observation is quiet or incomplete. Apply the scope in
`docs/ops/orca-card-delivery.md` and do not broaden it to unrelated work.

## Dispatch independent work

Maximize safe parallelism without a fixed writer cap. A card may launch
only when it is independently Ready for Dev, its dependencies are satisfied,
its worktree and ownership are distinct, and no existing writer owns that
candidate. Never create duplicate worktrees, Tasks, Dispatches, PRs, or writers.
Start every eligible light worker in the tick, but allow at most one heavy
DB/Docker/full-gate worker at a time.

Serialize cards that edit the same hot files. Before admitting a card, compare
the files its scope names with every card already In Dev or unmerged; if both
touch a shared registry or inventory (for example
`packages/contract/src/agent-paths.ts`, `approved-breaking-changes.ts`, the
generated OpenAPI documents, `workers/edge/test/route-inventory.test.ts`), hold
the second card until the first merges. GitHub merge queue is unavailable on this
user-owned repository, so serialization is the lever.

### The roster (2026-09-22)

Dispatch through `scripts/orca-headless/orca-headless.rb` on `main` (#1944). The coordinator
keeps the sibling worktree
`~/orca/workspaces/Seichijunrei-agent/orca-pi-headless-support` at `origin/main`'s copy of the
launcher, so dispatching from that worktree runs the same launcher. Its accepted selections are a
hard-coded whitelist, not a router: an unlisted pair is refused
at launch, which is the point.

| Role | Selection |
|---|---|
| Writer | `--provider pi --model bigmodel/glm-5.3-flash --effort max` |
| Writer | `--provider pi --model opencode-go/deepseek-v4.1-flash --effort max` |
| Writer, **paused** | `--provider pi --model opencode-go/mimo-v2.5-pro --effort max` |
| Writer, **paused** | `--provider pi --model opencode-go/mimo-v2.5 --effort max` |
| Writer, **visible UI only** | `--provider kimi --model kimi-code/k3-256k-max --effort max` |
| Reviewer | The writer's counterpart — GLM and DeepSeek review each other; kimi reviews a candidate that both of them wrote; GLM or DeepSeek reviews a candidate kimi wrote (owner, 2026-09-24 — Claude models no longer review) |

`--runtime-client` has no default and `start` refuses without it: pass
`/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/cli/runtime/client.js`.
The two MiMo selections were added on 2026-09-22 at the owner's request; `mimo-v2.5-pro`
delivered #1841 the same day. The owner paused both on 2026-09-23;
do not dispatch them until the owner lifts the pause.

**Retired, do not dispatch:** grok (allowance exhausted 2026-09-21) and command-code
(subscription expired 2026-09-20). If a provider fails, record it and hold — never
silently substitute one, because the receipt will then name a model that did not run.

**kimi's effort lives in the model alias, not a flag.** `kimi-code/k3-256k` has
`default_effort = "high"` in `~/.kimi-code/config.toml`; `kimi-code/k3-256k-max` is an alias
over the same upstream model whose only difference is `default_effort = "max"`. The plain
alias is refused by the launcher on purpose. kimi's `-p` also takes the prompt as an
argument (it rejects stdin) and cannot combine with `--yolo` or `--auto` — and note that in
kimi, `--yolo` is the *milder* mode ("Ask When Needed") while `--auto` is "Never Ask", the
opposite of most CLIs.

**A card with a visible UI surface is different in three ways:** it goes to kimi; its PR
comment must carry before/after comparison screenshots and screenshots of the flow; and the
coordinator does **not** merge it — the owner accepts it. A change inside `apps/web` with no
user-visible surface (a test helper, a build config) is not a visible-UI card.

Every developer or fixer role spec must explicitly require:

- the exact selection above, named in the spec so the worker can report a mismatch;
- invoking and following Matt `/implement` for implementation and every fix,
  including review, PR-feedback, and CI repairs, when the worker's Skill tool
  allows it, and otherwise working from the brief;
- changes and evidence returned to the coordinator, with no publication or
  merge by the worker.

Every pre-PR and post-fix review role spec must explicitly require:

- the writer's counterpart as the reviewer — GLM and DeepSeek review each other; kimi
  reviews a candidate that both of them wrote; GLM or DeepSeek reviews a candidate kimi
  wrote (owner, 2026-09-24 — Claude models no longer review), reported as blocked rather
  than as approval if the effective model is anything else;
- direct invocation and following of Matt `/code-review`;
- a reviewer model different from every model that wrote the current
  candidate, including fixes, and no candidate edits by the reviewer.

Reviews use the Standards and Spec axes. Count the initial review as round one;
allow at most three complete review rounds for the card; the post-PR changes
that do not consume one are listed in `docs/ops/orca-card-delivery.md`
(owner, 2026-09-18). Do not evade the limit with a new Run, card, or PR; unresolved findings,
model-identity uncertainty, or missing evidence is a human gate.

## What would have to happen for this check to go red?

Ask it of every check you are about to trust. On 2026-09-21 eight separate failures in one
day had one shape: **a check whose name describes a scope wider than the one it actually
reads.** None produced a failure signal. Every one of them was, at some point, cited as
proof that something was safe.

| The check | What it claimed | What it actually read |
|---|---|---|
| `pgrep -x grok` in the automation precheck | "a coordinator is working" | a process with that name exists — a TUI parked for 2d05h answered it for 100 consecutive runs |
| `# workers_dev = false` in `wrangler.toml` | production has workers.dev off | nothing. No key was set anywhere; the comment bound to no code |
| `pnpm --filter @animichi/web test` | the web package's tests | **nothing**. An unmatched filter prints `Scope: 0 of 15 workspace projects` and **exits 0** |
| `git status --porcelain` empty | the worker did no work | either that, or the worker committed. The two are indistinguishable here |
| `orchestration check` → `count: 0` | the inbox is drained | either that, or `consumer_fenced` — a second coordinator had taken the consumer seat |
| `oxlint` exit 0 through a pipe | lint is clean | the exit code of `tail`. Clean oxlint output is **zero bytes**, identical to never having run |
| a handoff saying "needs owner round 4" | a blocking fact | the previous coordinator's inference. The reports it linked said `0 must-fix` on both axes |
| `ps \| grep "pi --print"` | the worker is dead | the grep pattern was wrong. pi's process is named `pi`; its argv is wrapped by node |

The cure is the same every time, and it is cheap: **make the check produce a red, once.**

- Before trusting a gate, break something it should catch, watch it fail, then restore.
  A reviewer on 2026-09-21 planted `export const probe: any = 1` for exactly this reason.
- Before trusting a measurement, take a control. A production `workers.dev` host answering
  `HTTP/2 404` reads as "a Worker is refusing an unrouted path" until a subdomain that never
  existed returns a byte-identical response — at which point it reads as "no Worker here".
- Before trusting a liveness verdict, use the platform's: `orca orchestration worker-read
  --dispatch <id> --source auto` and read `projection.liveness`. Never a hand-rolled
  `ps | grep`; you will invent a pattern that misses and call a working lane dead.
- Before trusting a clean worktree, read `git log`. Writers commit despite briefs telling
  them not to — four of four did on 2026-09-21, across two models. Brief for what they do.
- Before trusting "no findings", ask whether the bot has spoken yet, and read both channels:
  line-level `reviewThreads` **and** top-level issue comments. A quota-exhausted notice is
  not a review.

**A correction to the pnpm rule above, measured 2026-09-22 by a reviewer who checked it rather
than repeating it.** `Scope: 0 of N` is real when a filter matches nothing — but pnpm 12 prints
**no `Scope:` line at all for a single-package filter that matches**. So "read the `Scope:`
line" has nothing to read on the success path, and its absence proves nothing either way. The
positive evidence is the `$ <script>` echo pnpm prints before running, and
`pnpm --filter <name> exec pwd` returning the package's directory. Name the package correctly
first: the six `packages/*` libraries are scoped (`@animichi/contract`, `@animichi/agent`,
`@animichi/eval`, `@animichi/pi-session-neon`, `@animichi/prisma-geography`,
`@animichi/test-postgres`); `web`, `catalog`, `users`, `edge-worker`, `migrator`,
`anitabi-egress`, `animichi-e2e`, `infra` and the root `animichi-cloudflare-worker` are bare.

That correction is itself the lesson: I had put "read the `Scope:` line" into four task briefs
and into this file before anyone checked whether the line appears on the path that matters.

## One coordinator, and a tick that only nudges

**Never run two coordinators on one Run.** On 2026-09-21 a second one merged a PR the first
was actively working, and — worse, because it was silent — took the Run's consumer seat, so
the first coordinator's `orchestration check` returned `count: 0` while deliveries piled up
behind the fence. Re-bind with `orchestration run-use --id <run>` to take the seat back; the
messages appear immediately.

The scheduled automation exists to **message the live coordinator**, not to become one. Its
precheck (`~/orca/animichi-coordinator-precheck.sh`) sends the nudge itself and exits 42
whenever either witness says a coordinator is alive: a heartbeat on
`/private/tmp/animichi-coordinator-alive` newer than 2400s, **or** any dispatch on the Run
reporting `"verdict": "live"`. The second witness exists because the first one lapsed for
40 minutes while the coordinator was busy — which is exactly when it was needed.

If you are the coordinator, touch that heartbeat on a schedule you do not have to remember:
a recurring job in your own session, such as a 15-minute Claude Code `CronCreate` job that
drains the inbox and touches the file. The 30-minute scheduled automation above only nudges
while a coordinator is alive, so it is not that schedule, and intending to remember is not
one either.

**Repairing a safety mechanism that has never fired is a first deployment, not a fix.** The
automation's 101 recorded runs contain 100 `skipped_precheck` and exactly one execution —
the one right after it was repaired. Before you fix a dormant guard, ask what it will
collide with when it finally works.

## Decide by engineering principles

Owner decision 2026-09-14: do not ask the owner about choices that TDD, DDD,
clean code, SOLID, KISS, established best practice or design patterns already
settle — for example the shape of a fix, whether a raw nit should be fixed by
code, how to split or name a seam, or how to sequence overlapping candidates.
Decide, record the principle and evidence in the tick report, and keep going.

Ask only for what those principles cannot decide: external spend or live
model/service windows, staging or production actions, secrets, scope or
priority changes that belong to the PO, and exceptions to written repository
rules (suppressions, file-cap or review-round exceptions).

## Readability-first review bar

Owner decision 2026-09-15, after review loops grew findings (42 → 8 → 20) and
contract tests grew anti-obfuscation cases no maintainer needs:

- **Must fix:** violations of written repository rules (1-10-50, test-file
  size, conditional logic in tests, `any`, suppressions, statements the patch
  made false) and real defects or AC gaps.
- **Judgement / nit / optional:** fix only when the fix makes the code shorter
  or plainer. If it would add a file, a test double, an abstraction, test
  variants or net lines, do not fix it; the fixer records a one-line reason and
  the reviewer confirms the reason. Such items do not block merge-clean.
- Fixer briefs default to subtraction: delete or inline first, report the net
  line delta. Contract tests prove the AC's one or two facts in the shortest
  readable form and do not defend against adversarial rewrites.
- Review briefs ask the reviewer to state, per finding, whether the proposed
  correction adds or removes code, and to apply the two tiers above.
- Apply this bar to similar choice points without asking the owner.

## Hold the delivery state machine

Drive one card through this sequence, retaining exact revisions, SHAs, and
evidence at every boundary:

```text
Ready for Dev -> In Dev -> local gates -> Dev Done
  -> independent review/fix loop -> regular PR
  -> inventory and resolve every actionable inline/review/top-level comment
     plus required CI and fresh review
  -> squash merge -> verify the GitHub merge record -> Ready for QA
```

Keep Project status **Dev Done** throughout review, fixes, PR creation, and PR
feedback. API/E2E/computer-use QA is deferred to the later phase; existing
tests and required CI still need worker evidence. If every PR review bot
explicitly reports exhausted quota, classify those quota notices as
non-actionable and continue with required CI, Matt review, and substantive
feedback; any substantive finding still blocks merge.

The coordinator may create the candidate commit, publish Git/GitHub changes,
operate the board, and squash-merge only after the corresponding evidence is
accepted. It never edits candidate files. Keep one complete card/Story in one
regular PR, bind approval to the exact reviewed head SHA, inventory all
feedback after every push and before merge, verify `mergedAt` and merge SHA,
and then move the card to Ready for QA. No local deploy, production approval,
administrator bypass, stale-head merge, or fourth review round is permitted;
human decisions remain explicit.

### The three merge conditions, and the one that is not one

Merge when **all three** hold, and not before:

1. **Every bot that left a comment or finding is resolved**, both channels checked: line-level
   `reviewThreads(isResolved:false)` and top-level issue comments (qodo summaries, SonarCloud,
   codecov). A bot that left **nothing** does not block — absence is not a pending item, and
   waiting for it is waiting for something that may never come.
2. **The last APPROVE from an Orca review seat covers the current head**, on a model different from
   every model that wrote the candidate, fixes included: the PR opened at an approved head
   (`Review: APPROVE at <sha>` in the body; owner, 2026-09-24), and every push since is a change
   `docs/ops/orca-card-delivery.md` exempts from re-review (owner, 2026-09-18); any other change
   needs a fresh APPROVE. The coordinator reading the diff is a coordinator's check, not a review;
   it does not satisfy this.
3. **Every CI check is green** — not "no required check is red". A non-required red is a thing to
   fix or explain, never a thing to step over.

**There is no bot-window wait** beyond the merge hook's own ten-minute freshness guard. An older
rule said to wait ten minutes after a push; it is superseded. Condition 1 is about what the bots said, not about how long you waited.

`~/.claude/hooks/check-pr-comments.sh` refuses the CLI merge verb with "the bots have not reviewed
the final push yet". When the bots are exhausted that condition can never be satisfied, so under the
owner's standing authorization fall back to the REST route (`gh api -X PUT
repos/<owner>/<repo>/pulls/<n>/merge` with `merge_method=squash`, `sha=<the head you reviewed>` and
`commit_message=@<the checked body file>`) and do not come back to ask. Without `sha` the endpoint
merges whatever the head is at request time, and without `commit_message` a bot's late edit to the
PR body becomes the squash message. If GitHub refuses the `sha`, the head moved: check the merge
conditions again before retrying. Prefer the literal CLI form with a written-out number otherwise.
The hook parses the number off the command line, and when it finds none, as with a variable, it
silently checks the current branch's PR instead.

Note the hook's real scope while you are here: it matches a merge-shaped string **anywhere in a
bash command**, so it will also block a heredoc that merely quotes one. That is this skill's own
subject arriving in person; write such text with a file tool rather than working around the hook.

**A rebase changes the SHA without changing what was reviewed.** Condition 2 binds approval to a
head, and `required_linear_history` will make you rebase after someone else lands. Do not re-run
the review seat reflexively; prove the premise still holds instead:

```sh
git diff <old-base>..<reviewed-head> | git hash-object --stdin
git diff <new-base>..<rebased-head>  | git hash-object --stdin
```

Equal hashes mean the reviewed delta is byte-identical and the verdict still covers it. Unequal
means it genuinely changed and needs a fresh seat, with the one exception the runbook's list
makes: restack conflict resolution reported hunk by hunk needs no fresh seat (owner, 2026-09-18).

### Launcher facts that cost a lane each

- **The Orca version pin is exact, on purpose.** `runtime-client.cjs` and `response_verifier.rb`
  compare `EXPECTED_VERSION` for equality because the launcher rides an unsupported internal
  `RuntimeClient` seam. When Orca updates, every dispatch hard-fails `unsupported_orca_version`.
  Bump it to the new exact version only after confirming the runtime still advertises the
  launcher's own `REQUIRED_CAPABILITIES` (`terminal.create-idempotency.v2`,
  `orchestration.contract.v1`), then re-run the launcher suite. **Never relax it to a range** —
  that removes the thing that stops the next silent breakage.
- **An interactive shell prompt eats the injected command.** On 2026-09-21 oh-my-zsh's `[Y/n]`
  update prompt consumed the first character of `exec …`, leaving `xec` and `command not found`,
  with an empty stderr and a lane stuck at `prompt_published`. If lanes die there, read the
  terminal itself — `worker-read --source terminal` — before suspecting the model, the
  concurrency, or the machine. All three were wrong that day.
- **A failed `start` before the Dispatch exists leaves no Orca resource.** Check the attempt
  directory's receipts (`failure.json`, absence of `dispatch.json`) before re-launching; archive
  the directory rather than deleting it, and use a fresh `--state-dir` (an existing one is refused).

## End the bounded tick

Do not wait forever or turn this skill into a scheduler. End by reporting:

- active writers and reviewers;
- work launched in this tick;
- held cards and the evidence-based reason for each hold;
- settled workers and whether each was reused, retained, released, or headless
  cleaned;
- every human gate or unresolved lifecycle/evidence boundary.

Before the report, run the required inbox check once more, process the complete
FIFO Delivery, and acknowledge only after the terminal decisions above are
recorded. The report describes observed state, not inferred completion.
