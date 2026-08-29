# Catalog background ingest execution — decision spec

- Status: PROPOSED — decision-ready analysis for owner sign-off; not yet dual-reviewed. Written 2026-08-29.
- Tracking: #1229 (silent waitUntil ingest death). Refs: #1227 (fixed by #1228 — guard now reports dead running rows as ready), #1228, `docs/specs/2026-08-26-system-health-audit.md`.
- Scope: one decision — **where the per-work ingest pipeline runs when the trigger is a user request**. No code in this document; implementation tickets follow sign-off.

## Problem

`pointsByBangumiId` on an uncovered work acquires the singleflight claim, returns an L1 preview, and hands the whole fetch → raw → enrich → publish pipeline to `ExecutionContext.waitUntil` (`workers/catalog/src/api/work-points.ts`, `claimedResult`). Workers bound `waitUntil` to roughly 30 s of wall clock after the response. The pipeline is a multi-fetch, retry-backoff, multi-write affair — measured 7–11 s locally against the same staging database, i.e. already uncomfortably close to the cliff, and any upstream stall (sources.ts retry backoff alone can eat 30 s) blows straight through it.

When the ceiling hits, the isolate is killed: the `.catch` never runs, `console.error` never fires, `markFailed` never happens. Observed on staging 2026-08-27 (#1229): claim acquired, zero rows in every table three minutes later, `wrangler tail` shows `outcome=ok, wall=420ms, logs=[]`. With #1227 now fixed the wedged row expires after the 15-min TTL and is re-acquired — into the same 30 s execution context — so staging degrades to a retry loop that re-dies every cycle. The work never becomes covered on staging; on production the same death happens per lazy ingest but the production-only TTL-refresh cron re-picks the work within 24 h (a never-fetched work reads as infinitely stale).

So there are two distinct gaps:

1. **Execution context too short** (structural): a full ingest cannot reliably fit `waitUntil`.
2. **Staging has no backstop** (config): production self-heals via crons; staging declares only the daily snapshot import cron, so a dead lazy ingest is never retried outside user requests.

## Constraints

- The request path must keep returning the preview fast; no synchronous ingest.
- Upstream politeness budgets exist (`ingest/budgets.ts`); any new execution surface must spend from the same budget, not open an unbounded retry firehose.
- The pipeline is already at-least-once safe: raw stores upsert, publish is versioned, and the singleflight claim serializes per work — exactly-once is not a new requirement.
- No new runtime product should be added to staging without an owner cost/approval decision.

## Options

### A. Cloudflare Queues (producer in the request path, consumer runs the pipeline)

The claim holder enqueues `{bangumiId}` instead of running the pipeline; a queue consumer executes `runClaimed` with full CPU, delivery retries, and a DLQ.

- ✅ Purpose-built background execution; retries and backoff for free; removes waitUntil from the pipeline entirely.
- ❌ Requires Workers Paid (Queues) in both environments; new IaC (queue, consumer binding) in `infra/`; envelope delivery is at-least-once, so the singleflight must stay the dedupe layer (it can — the consumer just re-acquires).
- ❌ Largest blast radius: new product, new deploy surface, new failure mode (queue lag).

### B. Durable Object alarm per pending work

- ❌ Rejected. A stateful object per outstanding job to emulate a queue duplicates Queues badly; alarm fan-out across many pending works is awkward, and DO capacity/cost on staging needs its own approval. No advantage over A or C.

### C. Fold lazy ingest into the cron dispatcher (recommended)

The request path stops running the pipeline. `claimedResult` marks the intent durably — the `ingest_jobs` table already defaults `status` to `'pending'` (baseline `20260826000003_catalog.sql`), so the state machine gains a parked state with **no schema migration**: the request path upserts `status='pending'` (guarded by the same singleflight predicate, so a live running row wins) and returns the preview. The existing `scheduled()` dispatcher drains pending rows — `SELECT … WHERE status='pending' ORDER BY created_at LIMIT cap` — and runs the normal `claim → runClaimed` pipeline per row inside the cron context (scheduled handlers get minutes of CPU, not 30 s), spending from the shared budget and marking done/failed exactly as today.

- Production: the drain rides the existing TTL-refresh cadence (hourly).
- Staging: arm one hourly cron trigger for the drain (wrangler `[env.staging.triggers]` + the ENVIRONMENT guard in `cron-config`/`guardCron` — the current "ingest crons are production-alone" rule is amended for the drain kind only).
- The stale-`running` reclaim fixed in #1228 folds into the same drain (a dead running row past TTL is drain-eligible), so every retry of a died ingest happens in a context that can actually finish.
- ✅ No new runtime product; no schema migration; identical code path in both environments; reuses singleflight, budget, negative cache.
- ❌ Latency: a first-requested work becomes fully covered on the next cron tick (≤1 h) instead of ~15–30 s. The requester already gets the honest partial preview ("数据同步补充中"), and popular works are covered by the gazetteer seed and daily discovery — the lazy path is a long-tail backfill, where ≤1 h is acceptable. If product later wants instant coverage, that is the trigger to revisit A.
- ❌ `waitUntil` disappears from the request path entirely (`work-points.ts` `claimedResult` loses its background arm); the "dead running" guard/acquire semantics must be re-tested against the pending state (#1227's spike tests are the template).

## Recommendation

**Adopt C.** It resolves both gaps with the smallest surface: one state-machine change, one drain runner wired into the existing dispatcher, one staging cron entry. Option A stays the documented escalation path if lazy-coverage latency ever becomes a product requirement. B is rejected.

## Acceptance sketch (for the implementation ticket)

1. A pending row is drained by `scheduled()` in both environments; the pipeline completes and marks done (integration test on real Postgres, spike-pool pattern).
2. A request-path acquire on an uncovered work leaves a `pending` row and returns a preview without touching upstream (`workers/catalog` unit tests; waitUntil no longer referenced by `work-points.ts`).
3. A stale `running` row is drain-eligible after TTL and re-runs to completion (extends `ingest-jobs-guard.spike.test.ts`).
4. The drain respects `Budget` and the negative cache; a failing work parks hourly, not per-tick spam.
5. Staging `wrangler.toml` carries the drain cron with the ENVIRONMENT guard test updated; production cadence unchanged.

## Explicitly out of scope

- Migrating the pipeline to Workflows/containers; changing upstream retry policy; making staging ingest crons mirror production's seed/discovery cadence.
