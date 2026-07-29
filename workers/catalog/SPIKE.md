# Catalog TS Stack — SPIKE Verdict

**Card:** W0-2 (scaffold) + W1-SPK (risky-stack validation gate)
**Date:** 2026-06-21
**Stack:** Cloudflare Workers + Hono + oRPC + Drizzle (raw `sql`) + Neon/PostGIS, tested with vitest + `vitest-pool-workers`.

## Verdict: GO ✅

All three risk areas are proven against real components. The TS Catalog stack is safe to build on.

| Risk | Result |
|---|---|
| (a) Drizzle raw `sql` + PostGIS `ST_DWithin` | **GO** — runs against a real Neon child branch, returns correct rows |
| (b) `vitest-pool-workers` runs Worker tests | **GO** — Hono app imported + exercised inside the workerd runtime |
| (c) neon-http transaction path | **GO** — Neon Local HTTP proxy exercises the production driver and batch transaction path |

## What was validated

### (a) Drizzle raw `sql` + PostGIS `ST_DWithin` — GO
`test/postgis.spike.test.ts` uses the spike session's direct Neon child-branch endpoint, creates a
scratch table that mirrors the production geography shape, inserts two pilgrimage spots
(Washinomiya / Oarai, about 95 km apart), then runs radius queries through **Drizzle's raw `sql`
template** (`drizzle-orm/node-postgres`):

- 10 km radius around Washinomiya → returns exactly 1 row (Washinomiya), distance < 100 m. ✅
- 120 km radius → returns both rows, ordered nearest-first via the `<->` KNN operator. ✅

This confirms Drizzle's `sql` tagged template passes parameters correctly into PostGIS functions and that `ST_DWithin` / `ST_Distance` / KNN ordering all work. We use raw `sql` (not the Drizzle query builder) for geo because PostGIS functions aren't first-class in the builder — this is the intended pattern for the real `nearby` query.

### (b) vitest-pool-workers runs a Worker test — GO
`test/worker.worker.test.ts` runs inside the **workerd runtime** (not Node) via `@cloudflare/vitest-pool-workers`. It imports the real Hono app from `src/index.ts` and asserts:
- `GET /healthz` → 200, `{status:"ok", service:"catalog"}`. ✅
- `POST /rpc/nearby` (oRPC stub) → 200 with mock spots. ✅

It uses `env` from `cloudflare:test` to supply Worker bindings, proving the pool wires `wrangler.toml` bindings into tests.

### (c) neon-http transaction path — GO

`vitest.spike.config.ts` starts one Neon Local container and forks a child from `test-base`.
Serverless-driver tests use the local HTTP endpoint with the same `@neondatabase/serverless`
driver as production; node-postgres tests use the child's direct cloud endpoint. The helper
snapshots and restores process-global `neonConfig`, and every DB file truncates the pinned FK-closed
catalog table set without `CASCADE`.

## Why two vitest configs

The Worker pool (workerd) and the Neon-backed spikes (Node + testcontainers) have incompatible
runtimes, so they run as two configs that `pnpm test` runs in sequence:
- `vitest.config.ts` → workerd pool, `*.worker.test.ts`
- `vitest.spike.config.ts` → Node, `*.spike.test.ts`

## Version notes (blockers hit + resolved)

- The originally-pinned `@cloudflare/vitest-pool-workers@^0.9` + `vitest@3.2` combo failed at runtime with `The Console method is not implemented` (workerd `node:console` shim vs. vitest 3.2). **Resolution:** upgraded to `vitest-pool-workers@0.16.18` + `vitest@4`, the current supported pairing.
- The v3→v4 migration **removed** `@cloudflare/vitest-pool-workers/config` (`defineWorkersConfig` / `poolOptions.workers`). The new API applies the pool as a Vite **plugin**: `cloudflareTest({ wrangler: { configPath } })` from the package root. The config here uses that shape.
- oRPC `os.handler` does not infer input types from the destructured handler arg; you must declare them with a validator. To keep deps minimal we use oRPC's built-in `type<T>()` passthrough validator (no zod/valibot pulled in for the scaffold). Later cards can swap in a schema lib if runtime validation is wanted.

## How to reproduce

```bash
cd workers/catalog
pnpm install
pnpm test          # worker tests, then Neon-backed spikes
pnpm run typecheck
```

DB spikes skip actionably when Neon credentials are absent. A live run needs Docker/Colima,
`NEON_API_KEY`, and `NEON_PROJECT_ID`; the global setup removes its temporary branch at teardown.

The live counts and timings belong in CI evidence, not this stable stack verdict.
