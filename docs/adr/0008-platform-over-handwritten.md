# Platform features over hand-written code, repo-wide

> **Status**: proposed — owner ruled the principle on 2026-09-12 (「平台优于手写，能用现成的就不要自己搞」);
> this record awaits sign-off on its wording and on the two collisions in §5. Recorded against the
> evidence inventory produced the same day (`docs/iterations/production-readiness-2026-08/PLATFORM-OVER-HANDWRITTEN-INVENTORY.md`).
> This ADR **extends** [ADR 0006](0006-platform-over-handwritten-ci.md) decision 1 from the delivery
> lane to the whole repository. Everything 0006 decides about CI, OIDC and secrets stands unchanged,
> as does [ADR 0007](0007-selected-release-artifacts.md).

ADR 0006 made this call for `.github/` and it worked. Re-measured today, `.github/scripts` is 18
files / 772 lines against the 108 files / 10,586 lines 0006 recorded, and the affected-package
router it called "written three incompatible times" is now one line of `pnpm --filter "...[<ref>]"`.
The principle earned its extension by delivering.

## Decision

**Where the platform or an already-adopted library provides a capability, we do not write our own.
What stays hand-written is business rules.** This governs the whole repository, and it is the
tie-breaker whenever a hand-written mechanism would be "just a few lines".

"Platform" means a runtime, service or tool we already depend on: Cloudflare, GitHub, Neon, Pulumi,
Postgres, and every package in a `package.json` or `pyproject.toml` we ship.

## How a candidate is sorted

Every piece of hand-written machinery falls into exactly one bucket. The bucket determines who
decides, which is the point of having three.

**A — the platform already does this.** An adopted dependency or platform feature does the same job.
No decision is required; the principle decides it. Delete ours and use theirs.

**C — the platform genuinely lacks it.** Hand-written is correct. The calibration is 0006 §3.5:
Cloudflare Workers have no OIDC federation, so `workers/migrator` verifies GitHub OIDC itself, while
Pulumi Cloud does have native federation, so we use it. **The code must name what the platform
lacks**, at the point where a reader would otherwise ask why we wrote it. A C without that sentence
is an unclassified A.

**B — the platform has it, but the semantics are insufficient.** Adjudicated by the owner, case by
case, in **#1593**. Nothing in B may be kept or removed on the strength of this ADR alone.

**First adjudicated case (2026-09-12): #1620.** A private Prisma 8 extension pack declaring
`Geography(4326)`, ~380 lines, for a capability used by four lines in one file. Accepted. The precedent
it sets is about method, not about size: the ratio argued against it, and the ruling went the other way
because all three alternatives were measured first and each cost more — one line of raw SQL in
application code, or a second authorization model plus a pre-stable SDK, or `any`-typed columns on a
version that cannot carry the release handshake. **"Too much code for too little" is a comparison, not
a measurement.** A B case is not ready for adjudication until the alternatives are priced.

B exists because a rule that resolves it in advance has only two outcomes: it becomes a rubber stamp
for anything we felt like building, or it deletes a distinction that was load-bearing. The bucket is
not an escape hatch — #1593 sets five admission requirements for a case, and a case that cannot meet
them is an A that has not been read carefully enough.

## What this does not mean

**Not a mandate to adopt.** "Already adopted" is part of bucket A's test. A capability available in a
library we do not depend on is not an A — adding a dependency is its own decision with its own cost,
and this ADR does not pre-approve it. The inventory found this edge immediately: an 830-line OpenAPI
breaking-change engine in `packages/contract` duplicates `oasdiff`, which is not a dependency. Under
"already adopted" it is a B; under "off-the-shelf exists" it would be the largest A in the repo.
**Resolve that reading before applying this ADR to anything.**

**Not a licence to delete.** Replacing hand-written machinery with a library is a change like any
other: it needs the tests that prove the behaviour survived, and mutation evidence where the
behaviour is load-bearing. "The library does this" is a reason to open the card, not to skip its gates.

**Not retroactive.** This ADR does not invalidate a decision already recorded. ADR 0007 explicitly
authorises `.github/lib/release/*.rb` as the repository's admission layer over GitHub's artifact
primitives; those lines are a decision, not a finding.

**Not a rule about size.** A 5-line hand-rolled email regex where `zod` is already imported is an A.
A 253-line SSRF guard is a C. Lines measure what a change costs, not whether it should happen.

## Two collisions this ADR does not resolve

**1. ADR 0006 decision 6 versus the migrator's Atlas engine — resolved 2026-09-12 as a *wait*, not a decision.**
Decision 6 says CI never holds a database credential, "even short-lived". That forces migration apply
into a Worker. The reason the real Atlas binary is unreachable there is **not** that Workers cannot
exec a subprocess — `docs/specs/2026-08-16-migrator-neon-connectivity-spec.md` explicitly refuses that
claim ("This spec does **not** claim Cloudflare 'cannot do Postgres TCP'"). It is that **`5432` from
the migrator container never completed TLS to Neon**: Neon's ops log showed `start_compute` — TCP
arrived, the compute woke — with no Postgres session established. Option 2 abandoned 5432 entirely,
and that spec's decision 5 then required the Worker to keep writing `atlas_schema_revisions` with
Atlas v0.30 version/hash semantics so a laptop `atlas migrate status` stays truthful. Those two
constraints together are what produced ~644 hand-written lines (`http-apply.ts` 260, `sql-split.ts`
200, `chain.ts` 64, `ledger.ts` 59, `sql.ts` 50, `preflight-ledger.ts` 11).

So the correct statement is conditional, and it is this ADR's bucket-B admission fact #5 exactly —
a gap that upstream or a decision closes is a wait, not a decision:

> Those 644 lines exist as long as Atlas owns tables. Atlas owns tables as long as it owns tables.

The owner closed it on 2026-09-12 by retiring Atlas: **Prisma 8 takes the whole database layer**, and
`ControlClient.migrate` replaces the hand-written apply, ledger and SQL splitter. The exit condition
was never a tradeoff between security and code volume — it was a schema-ownership decision, and the
ADR previously mis-stated it as the former. Spec in `docs/specs/`, dated 2026-09-12.

**2. The largest hand-written cluster in the repo is not a platform duplication at all.**
`packages/eval/src/gate/**` is ~1,736 TypeScript lines twinning ~656 Python lines
(`apps/agent/src/animichi/tests/eval/{gate,metric_gate,stats}.py`), including a bit-exact CPython
MT19937 and an `math.fsum` port, so the two gates produce diffable numbers. No platform is being
duplicated; a *language* is. This ADR does not reach it, and pretending it does would be its first
misuse.

**It also has a deadline, which the first version of this ADR missed.** The ports are not a permanent
duplication — they are a migration in flight. `packages/eval/src/gate/stats-oracle.ts:9-13` names its
source as "the Python side's own answers, for the TS port to be measured against", written by
`stats_oracle.py` running the real `stats.py`/`gate.py`; `gate-run/python-baseline.ts:6` names the
record as the one "a TS staging run is gated against (W3-5 #1303)". Two things then happened: #1303
closed as superseded with the owner declaring the W3 exit not met and **no Python baseline ever
produced**, and #1607 will delete `apps/agent` — taking the oracle's source with it. So the decision
of whether the bit-exact ports (~332 lines: MT19937 148, fsum 98, number rendering 86) have served
their purpose must be made **before #1607 merges**, and #1603 is where it lands. A wait with a
closing window is not the same as a wait.

## Consequences

- A reviewer may reject a hand-written mechanism by naming the adopted equivalent. That is now
  sufficient grounds, and it does not require agreement about taste.
- A C must carry its justification in the code. Reviewers should reject an unexplained C.
- A B goes to #1593 and waits. It does not get built, and it does not get deleted, in the meantime.
- **Cite the repo's own precedent before citing the principle.** The inventory turned up the same job
  done twice, in opposite ways, and the earlier one got it right: `.github/lib/release/config.mjs:1`
  reads Wrangler configuration with Wrangler's own `experimental_readRawConfig`, while
  `workers/catalog/scripts/worker-entry-exports.ts:5-8,33-43` hand-rolls 126 lines of regex over the
  same files. That is not a team that does not know the platform API exists — it is knowledge that did
  not travel. A reviewer naming the in-repo precedent carries more than a reviewer naming this ADR,
  because the precedent proves the thing already works here.
- The inventory is a snapshot, not a worklist. Cards come from it one at a time, each with its own
  acceptance criteria; nobody is authorised to "apply the ADR" in a sweep.

## Primary references

- [ADR 0006](0006-platform-over-handwritten-ci.md) decision 1 and §3.5 (the principle and the C calibration)
- [ADR 0007](0007-selected-release-artifacts.md) (the recorded exception this ADR must not re-open)
- #1593 (the B adjudication log)
- `docs/iterations/production-readiness-2026-08/PLATFORM-OVER-HANDWRITTEN-INVENTORY.md` (the evidence)
