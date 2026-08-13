# Edge Rate-Limit Layered Rollback Manual (issue #680)

## Why this exists

The edge worker's rate limiting is a **layered** system (issue #680): a coarse
best-effort Cloudflare-native `ratelimit` binding plus an exact durable tier in
an `EDGE_GUARD` Durable Object. A rollback must therefore be **layered** too —
the right lever depends on which tier misbehaved, and the changes are ordered
so the cheapest, most reversible control is used first. **No automation** is
used to roll back (decision 2026-08-03): every step here is a deliberate,
operator-triggered action with a recorded outcome.

## The tiers at a glance

| Tier | Primitive | What it governs | Misbehaviours |
|---|---|---|---|
| WAF/IP | zone `http_ratelimit` ruleset (`infra/src/hardening.ts`) | coarse network floods on `/v1` | over/under-challenging at the edge of the network |
| Native burst | Cloudflare `ratelimit` binding (`workers/edge/wrangler.toml` `[[ratelimit]]`, `env.RATE_LIMITER`) | best-effort per-key burst for cacheable public reads + the coarse outer wall | false 429s (over-tight `/v1/search/preview`, guide), or silently letting floods through |
| Durable exact | `EDGE_GUARD` DO (`workers/edge/src/protect/rate-limiter.ts`, `edge-guard.ts`) | exact per-identity high-cost/write windows (chat, BYOK, photo-search, users mutations); fails closed on outage | stuck 503 `rate_limit_unavailable`, wrong identity key, a burst window that never resets |
| Daily quota | $EDGE_GUARD budget latch + container ingress (`daily_usage` / `anon_daily_message_count`) | anonymous daily cost/message ceilings | early budget lockout (403 `anon_budget_exhausted`) |

Every tier's limiter selection and failure mode is decided by ONE route policy
— `workers/edge/src/gateway/rate-policy.ts` `classifyRatePolicy` — which
classifies every public API operation by identity key, cost, quota, retry
contract, and limiter-failure mode. Routing never hand-picks a guard: every
branch classifies with the policy and delegates to the enforcement seam
(`workers/edge/src/protect/burst-guard.ts` `guardPolicy`), which routes a
durable cell to the fail-closed `EDGE_GUARD` shard and a cacheable-read cell
to the native damper. **Policy changes are the dominant rollback cause** and
are governed by the first layer below.

## Layer 0 — policy / feature flag (seconds, no redeploy)

The route classification (`rate-policy.ts`) is the single decision table. If a
class is mis-mapped (e.g. a read got a `durable`/fail-closed limiter), the fix
is a corrected classification, shipped and reviewed like any code change. For
an immediate stop without a code change, the per-identity coarse and durable
windows are env-configurable in `wrangler.toml` `[vars]`:
- `ANON_RATE_LIMIT` / `ANON_RATE_LIMIT_WINDOW_SECONDS` — anonymous coarse burst.
- `AUTH_RATE_LIMIT` / `AUTH_RATE_LIMIT_WINDOW_SECONDS` — authenticated high-cost burst.
- `ANON_ACCESS_ENABLED = "false"` — hard-global anonymous off (Turnstile + burst +
  budget all stop for anonymous callers; 401 instead of any anonymous service).
- `EDGE_SHOWCASE_MODE = "true"` — land-only (every functional /v1 route answers 403).


## Layer 1 — Worker platform rollback (instant, minutes)

Redeploy the previous immutable Worker revision through the normal CI/CD path
(`docs/ops/deployment.md`). The edge worker is stateless for the rate-limit
tiers: the native binding is config-driven and the `EDGE_GUARD` DO state is
reclaimed/rebuilt on the fly (a reverted worker that stops writing a window
lets stale shards be reclaimed by `EdgeGuard.alarm`). A Worker-version rollback
reverts BOTH the native-binding usage and the durable limiter wiring at once.

## Layer 2 — downgrade the native binding only (config)

If only the coarse tier misbehaves (over-tight public-read 429s), the `[[ratelimit]]`
binding is a config surface: relax `simple = { limit, period }` (or remove the
binding — the worker then fails the native tier open with an alert) without
touching the durable tier. This is the *one* layer that can be changed without a
redeploy when the environment permits a config-only update.

## Layer 3 — durable-tier fail-closed bypass (code review, not a silent trip)

The durable tier FAILS CLOSED on a limiter outage (AC4): an unmeterable
high-cost turn must not run. A deliberate operator-bypass is a security
decision, not a restart step — it requires a reviewed change to the failure
mode in `rate-policy.ts` plus the documented trade-off, and must be gated on
an owner decision (parent #1004). It is **never** a config flip done casually.

## Layer 4 — code/base rollback for the durable DO

If a durable regression ships (wrong window, identity-key bug, 503 storm), the
correct move is a Layer 1 Worker rollback of `EDGE_GUARD` + `rate-policy.ts`
together. `EDGE_GUARD` uses SQLite-backed DO storage; a rollback that stops
writing a window lets the reclaim alarm delete stale shards, so no manual DO
state reset is required in normal operation. If an operator must force-pop
state, the reclaim logic (`edge-guard.ts` `alarm`) is the documented seam.

## Layer 5 — migration / config revert chain

#680 adds no Neon migration. The only deployed-config surfaces it touches are
`wrangler.toml` (`[[ratelimit]]`, `[vars]`) and `infra/src/hardening.ts` (the
zone WAF damper), both reverts of checked-in declarative config — CI-drive the
previous revision. If a future ticket adds a DB-backed meter, its rollback
follows `docs/ops/migrations.md` (revert chain, no automation).

## How to choose a layer

1. **Best-effort wrong (false 429s on reads)** → Layer 0 (relax window / policy)
   or Layer 2 (binding config).
2. **Durable wrong (503s on chat/BYOK/users mutations)** → Layer 1 (Worker
   revision) first; Layer 3 only with owner sign-off.
3. **Whole surface down / anonymous lockout** → Layer 0 `ANON_ACCESS_ENABLED`/
   showcase, then Layer 1.
4. **Flood not being damped** → check the zone WAF damper (Layer WAF) before the
   application tiers.

Each action should be recorded (who/what/when/outcome) in the change log the
`docs/ops/README.md` tracks.
