# Deep refactor execution protocol

> Status: active execution authority, 2026-08-10
> Scope: local development and staging only
> Product authority: [deep-code-refactor spec](../../specs/2026-08-10-deep-code-refactor-spec.md)
> Ticket authority: [GitHub #936](https://github.com/lifeodyssey/animichi/issues/936) and [tickets.md](./tickets.md)

This is the single entry point for executing the owner-approved deep refactor. It turns the Spec's
product contract into a resumable operating procedure. The linked playbooks are part of this
document and are disclosed only when their branch is active:

| Read when | Playbook |
|---|---|
| Executing the current production freeze | [SAFE-1](./execution/SAFE-1.md) |
| Materializing or running any card | [card playbooks](./execution/CARD-PLAYBOOKS.md) |
| Proving a card and opening its PR | [gates and evidence](./execution/GATES-AND-EVIDENCE.md) |
| Running AUTH-2, RETENTION-1, or SESSION-3 staging changes | [staging cutover](./execution/STAGING-CUTOVER.md) |

The Spec owns behavior and acceptance criteria. GitHub owns ticket state and blocking edges. Git
owns implementation state. This document owns sequence, handoff, evidence, and recovery. If they
disagree, stop the affected card and reconcile the higher authority instead of silently choosing.

## 1. Outcome and hard boundary

The campaign ends with one deep behavior path per capability:

- `AgentTurn.execute` owns a complete turn behind separate pre-stream `TurnAdmission`.
- `POST /v1/chat` is the only published turn endpoint; Contract is the only wire source.
- Agent owns one Session aggregate and one durable Message transcript.
- Neon Auth is the only human identity authority; Edge verifies once and forwards trusted identity.
- Users owns explicit authenticated SavedRoutes and no Agent Session projection or claim protocol.
- Catalog exposes behavior through application use cases and narrow consumer ports.
- Web owns browser state and protocol mapping, not Agent or Users policy.
- Edge composes identity, protection, routing, and forwarding once.
- Automated retention and the generic Jobs package are absent from campaign source and staging.

A **seam** is the stable application entry used by real callers and behavior tests. The internals may
change behind it. A renamed folder, one-line wrapper, interface with no production adapter, or test
that still patches implementation helpers is not a seam.

The following rules are locked:

1. The campaign carries only the target shape. It lands no alias, compatibility wrapper, dual read,
   dual write, shadow DTO, dual issuer, legacy endpoint, or staging-only fallback.
2. Production runtime, data, auth activation, user migration, Session lifecycle, and backup policy
   are untouched. Campaign revisions cannot mutate production.
3. Staging application data is disposable only inside the declared IaC cutover. Ordinary runtime
   does not delete Session or quota rows.
4. Automated retention is deleted, not replaced. No soft-delete flag, TTL, scheduled function,
   Worker, Workflow, queue, or new purge command enters this campaign.
5. Every resource, grant, binding, secret reference, issuer, route, and cutover switch required by a
   slice is declared as infrastructure as code. Dashboard-only configuration is not completion.
6. The final monorepo CI/CD redesign is deferred. Its recorded target remains one `ci.yml` and one
   `cd.yml`, test/build once, then promote the same immutable artifacts. SAFE-1 is only the narrow
   production freeze required before code work.
7. Historical branches, clones, and worktrees are preserved. This campaign authorizes no bulk Git
   cleanup or salvage decision.

## 2. Current recovery point

At 2026-08-10 after SAFE-1 merged, the current state is:

| Path | Branch / HEAD | State | Authority |
|---|---|---|---|
| `/Users/lumimamini/Documents/Seichijunrei-agent` | `main` at `1bcd5906`, behind `origin/main` | clean | stale root; do not implement here |
| `/Users/lumimamini/Documents/Seichijunrei-agent/.worktrees/deep-refactor-spec` | `codex/deep-refactor-spec` from `b94c30ab` | planning docs only | this document, Spec, ADR, and ticket planning |
| `/Users/lumimamini/work/animichi` | `main` at `1bcd5906`, behind by N | three workflow edits plus old handoff | preserve; never use as whole-tree truth |
| `/Users/lumimamini/work/animichi-wts` | 35 historical auxiliary worktrees | clean at last audit | evidence only |
| `/Users/lumimamini/animichi-work` | obsolete July clone | root and two worktrees clean | preserve pending separate salvage review |

**Waves 0–5 are DONE through TURN-3** — SAFE-1 (#937) via #964, CONTRACT-1 (#938) via #965,
TURN-1 (#939) via #972, RETENTION-1 (#940) via #969, CATALOG-1..4 (#941–#944) via #966/#970/#967/#968,
AUTH-1 (#945) via #971, CATALOG-5..7 (#946–#948) via #975/#973/#974, TURN-2 (#949) via #976,
AUTH-2 (#950) via #977, USERS-1 (#954) via #978, AGENT-2 (#953) via #979, TURN-3 (#951) via #980,
USERS-3 (#957) via #982. Issues closed; worktrees cleaned. Note: the GitHub
ruleset's Maintenance / lint·test·build required checks were dropped with RETENTION-1 (pipeline
removed) — ruleset now 32 contexts.

**Recovery point (2026-08-11 ~23:10)**: `origin/main` at `d46294d8` — AGENT-1 #952 via #981 AND USERS-2 #956 via #983 merged; issues closed; worktrees cleaned. **Waves 0–5 are DONE except TURN-4** (#937–#950, #953, #954, #956, #957, #951, #952 merged; only #955 open of the first five waves).
- RUNNING ELSEWHERE: TURN-4 (#955) ralph loop in `.worktrees/turn-4` (chat commands through AgentTurn; files actively changing).
- TODO: TURN-4 #955 → WEB-1 #958 + SESSION-1 #959 (need #955) → SESSION-2 #960 → SESSION-3 #961 → AGENT-3 #962 → EDGE-1 #963.

**Recovery point (2026-08-12 ~03:15)**: `origin/main` at `221908ab` — TURN-4 #955 via #984 merged (codecov fix round included: patch 96.5%→100%, eval flake documented twice); issue closed; worktree removed. **Waves 0–6 nearly done**:
- IN FLIGHT: SESSION-1 #959 PR #986 open — 2 review threads FIXED + resolved (next_offset cap at contract ceiling + offset>1000 bounds test); codecov 97.4% ✓, SonarCloud ✓, invariants ✓ (AGENTS.md ref repoint + .ralph untracked); waiting on final CI for head `93cdb5b0`.
- NEXT: merge #986 → SESSION-2 #960 (brief + ralph prompt ready; needs #955/#958/#959) → SESSION-3 #961 → AGENT-3 #962 → EDGE-1 #963.
- Wave table: 4 ✓(TURN-3,AGENT-1,AGENT-2,USERS-1) 5 ✓(TURN-4,USERS-2,USERS-3) 6 = WEB-1 ✓, SESSION-1 ~; 7=SESSION-2; 8=SESSION-3; 9=AGENT-3; 10=EDGE-1.

**SAFE-1 (historical) is DONE**: merged via PR #964 (squash `f44a76e9`-based stack; final head on
`main`), issue closed. The safe-1-promotion-guard worktree and branch are removed; its
characterization commit (`50be86d5`) and B1/B2/B3/review commits are on `main` through the squash.
Production is now fail-closed behind the pinned manifest (see `docs/ops/deployment.md` § SAFE-1).

**Wave 1 is unblocked**: `CONTRACT-1` (#938), `TURN-1` (#939), `RETENTION-1` (#940), `CATALOG-1..4`
(#941–#944) all list #937 as green. Resume from the per-card playbooks in
[./execution/CARD-PLAYBOOKS.md](./execution/CARD-PLAYBOOKS.md), not from a chat transcript.
All Wave-1 cards branch from refreshed `origin/main` (now past `b94c30ab`).

The 2026-08-09 handoff is historical input. Its claims that both roots were synced and all historical
worktrees could be removed are superseded by
[WORKSPACE-BASELINE.md](./WORKSPACE-BASELINE.md) and the live snapshot above.

## 3. Roles and authority

| Role | Owns | Cannot do |
|---|---|---|
| Owner | Product semantics, destructive production decisions, identity authority, future data lifecycle | Routine implementation arbitration |
| Root orchestrator | Refresh base, create worktrees serially, write briefs, dispatch, inspect every diff, run gates and mutations, commit, push, open/triage PRs, preserve evidence | Hand-write campaign code or accept executor claims as proof |
| OpenCode executor | Code and test edits inside one assigned worktree | Git commands, commits, cross-card edits, self-approval |
| Independent reviewer | Diff-versus-brief review and explicit verdict | Editing the same diff while judging it |
| CI / staging tester | Required checks, Codecov, browser/API smoke, remote IaC evidence | Converting a blocked check into a claimed green result |

All code-writing dispatches use one `opencode serve` instance with independent sessions and
worktrees. Preferred model is `opencode-go/deepseek-v4-flash --variant max`; use
`opencode-go/gpt-5.6-luna --variant max` only after a failed DS probe. Independent cards may run in
parallel after their blockers merge. Worktree creation remains serialized because it writes shared
Git metadata.

## 4. Per-card state machine

Every card advances through the following states. The completion criterion at the end of each state
is mandatory; activity is not evidence of completion.

### 4.1 SELECT

1. Confirm the ticket's exact `needs` from [tickets.md](./tickets.md).
2. Confirm every blocker is merged and green on current `origin/main`.
3. Re-read the card row in the Spec and its issue body.
4. Verify no other worktree owns the same files or behavior.

Complete when the selected card is unblocked, its acceptance boundary is unchanged, and its source
base is the current fetched `origin/main`. Exploratory work may precede blockers; implementation may
not merge before them.

### 4.2 MATERIALIZE

1. Create exactly one `codex/<card-slug>` branch and dedicated worktree under the Documents clone.
2. Record absolute path, branch, base SHA, initial status, and ticket number.
3. Create the fleet scratchpad `orchestra/cards/<CARD>/` with `brief.md`, `card.env`, exact `needs`,
   `state`, and `log/`. Scratchpad files are not product source.

Complete when the worktree is clean, based on current `origin/main`, and the `needs` file exactly
matches the ticket graph.

### 4.3 CHARACTERIZE

1. Run the card's pre-change gates and record every green, failure, skip, and environmental block.
2. Write the behavior manifest: observable inputs, outputs, durable effects, errors, ordering,
   security boundary, redaction boundary, and deletion inventory.
3. Add tests that pass against current behavior but would fail if a protected behavior changed.
4. Commit characterization separately before structural edits.

Complete when the characterization commit is green for its declared gates, immutable in the card
history, and contains no target implementation. A pre-existing repository failure is recorded, not
silenced or attributed to the card.

### 4.4 EXECUTE

1. Give OpenCode a self-contained brief with exact anchors, ordered edits, acceptance tests,
   deletion targets, mutation target, allowed commands, and `no git commands`.
2. Implement the application seam, real local/staging adapter, live caller migration, redacted
   observability, and replacement tests in the same card.
3. Delete the retired path and its structure-coupled tests before considering the slice complete.
4. Keep every intermediate commit small and green; a horizontal interface-only layer cannot land.

Complete when the real caller reaches the new seam, the real adapter works, and the former behavior
path is absent rather than bypassed.

### 4.5 VERIFY

1. The orchestrator inspects `git diff` line by line against the brief; exit status and executor prose
   are not proof.
2. Run focused tests, package gates, cross-stack gates, and `make check` as specified in
   [gates and evidence](./execution/GATES-AND-EVIDENCE.md).
3. Perform the named mutation: deliberately break one protected rule, observe red, restore by safe
   file copy, and observe green.
4. Run source-structure and generated-drift checks proving retired names and paths cannot return.

Complete when all required gates have classified outcomes, the meaningful mutation is killed, the
worktree is clean except intended files, and patch coverage is at least 95%.

### 4.6 REVIEW

1. An independent reviewer reads the issue, brief, complete diff, tests, deletion inventory, and
   mutation record.
2. Security, auth, schema-reset, production-guard, and destructive staging cards also receive a
   Codex Sol `xhigh` adversarial pass.
3. The executor never reviews its own implementation. Findings return to EXECUTE with surgical
   instructions and repeat the affected proof.

Complete only on an explicit approving verdict with zero untriaged blocking findings.

### 4.7 PR_OPEN → WAIT_GREEN → TRIAGE → MERGE

1. Commit only intentional files; exclude `TASK-BRIEF.md` and scratchpad state.
2. Push the card branch and open one reviewable PR linked to its issue and parent #936.
3. Wait for required checks and Codecov on the exact head SHA.
4. Inspect both unresolved review threads and top-level comments. Record owner-authored triage for
   bot findings, then resolve only addressed threads.
5. Re-run the fresh-head gate and squash merge. Never force-push or use `--no-verify`.

Complete when the squash commit is on `main`, required checks correspond to that head, the issue is
closed, evidence is linked, and all dependents see the blocker as green.

### 4.8 CLEANUP → DONE

1. Stop the card's OpenCode session and remove transient task briefs/log handles.
2. Remove only that merged card's dedicated worktree and local branch after verifying no unique
   patch remains.
3. Update the iteration progress record with merge SHA, gates, mutation, review, and staging proof.

Complete when no active state points at the removed worktree and the next unblocked card can recover
from repository artifacts alone.

## 5. Dependency waves

Waves express maximum safe parallelism, not permission to merge around a missing edge.

| Wave | Cards eligible after prior blockers are green on `main` |
|---|---|
| 0 | `SAFE-1` |
| 1 | `CONTRACT-1`, `TURN-1`, `RETENTION-1`, `CATALOG-1`, `CATALOG-2`, `CATALOG-3`, `CATALOG-4` |
| 2 | `AUTH-1`, `CATALOG-5`, `CATALOG-6`, `CATALOG-7` |
| 3 | `TURN-2`, `AUTH-2` |
| 4 | `TURN-3`, `AGENT-1`, `AGENT-2`, `USERS-1` |
| 5 | `TURN-4`, `USERS-2`, `USERS-3` |
| 6 | `WEB-1`, `SESSION-1` |
| 7 | `SESSION-2` |
| 8 | `SESSION-3` |
| 9 | `AGENT-3` |
| 10 | `EDGE-1` |

Within a wave, start independent sessions only when each owns a distinct worktree and file surface.
If two cards discover a shared source edit, stop the later card and add an explicit ordering edge or
move the shared behavior into the earlier owner card. Do not solve overlap by duplicating helpers.

## 6. Quality contract

Every card must prove all six properties:

1. **Behavior:** the acceptance case is observable through the published application seam.
2. **Runtime:** a real local or staging adapter is exercised where the external boundary matters.
3. **Migration:** every real caller reaches the new seam; no unused architecture layer lands.
4. **Deletion:** the superseded code, test, type, route, table, config, or remote resource is absent.
5. **Sensitivity:** logs and traces contain only the redacted fields approved in the Spec.
6. **Mutation:** changing one meaningful policy makes the replacement suite red.

Changed code follows 1-10-50, typed Python/TypeScript without `Any`/`any`, no suppression, no skipped
gate, no timing assertion, no lowered coverage threshold, test files at most 200 lines, and at most
five mocks per test. Coverage floors only move upward.

## 7. Owner escalation boundary

Continue autonomously for naming, extraction, module placement, error-handling shape, test
organization, adapter design, and routine clean-code tradeoffs already bounded by the Spec.

Ask the owner only when at least one of these becomes necessary:

- change a user-visible product rule, anonymous policy cell, quota, identity authority, or published
  API beyond the approved hard cut;
- mutate production, enable production traffic/data, or weaken the immutable production freeze;
- destroy data outside the declared disposable staging reset;
- introduce a new deployable, scheduler, queue, retention policy, compatibility window, or generic
  framework not authorized by the Spec;
- change a ticket boundary or dependency because a complete vertical slice cannot fit;
- accept a security tradeoff or waive a required proof.

An incidental failure is not an owner decision. Diagnose it, try safe in-scope recovery, and classify
it. After three repetitions of the same blocker, or when credentials/permissions are truly missing,
record `BLOCKED` with exact evidence and request the smallest needed intervention.

## 8. Campaign completion

The campaign is done only when all 27 issues are merged and the final evidence proves:

- fresh staging schema matches the explicit retained-surface manifest;
- every retained public API appears once in Contract and generated Python is drift-free;
- `/v1/chat`, history, adoption, feedback, photo, credential probe, SavedRoute, Catalog, and Edge
  journeys pass at their declared test level;
- retired runtime paths, API keys, Supabase verification, Session projection/claim, Jobs, retention
  triggers, duplicate models, wrappers, and old schema vocabulary are zero-match outside exact
  historical and SAFE-1 allowlists;
- staging cutover was executed through IaC, private smokes passed before ingress reopened, and no
  campaign revision touched production;
- every card has patch coverage, mutation red/green evidence, independent approval, green PR checks,
  and a merged SHA.

The next campaign may then design the one-`ci.yml`/one-`cd.yml` build-once release pipeline. A later
pre-production owner decision must separately define production identity activation, data migration,
Session/user deletion, retention, backup expiry, and production Jobs retirement.
