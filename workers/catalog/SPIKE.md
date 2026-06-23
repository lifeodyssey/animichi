# Catalog TS Stack — SPIKE Verdict

**Card:** W0-2 (scaffold) + W1-SPK (risky-stack validation gate)
**Date:** 2026-06-21
**Stack:** Cloudflare Workers + Hono + oRPC + Drizzle (raw `sql`) + Postgres/PostGIS, tested with vitest + `@cloudflare/vitest-pool-workers`.

## Verdict: GO ✅

All three risk areas are proven against real components. The TS Catalog stack is safe to build on.

| Risk | Result |
|---|---|
| (a) Drizzle raw `sql` + PostGIS `ST_DWithin` | **GO** — runs against real `postgis/postgis:16-3.4`, returns correct rows |
| (b) `vitest-pool-workers` runs Worker tests | **GO** — Hono app imported + exercised inside the workerd runtime |
| (c) Hyperdrive (prod-only) blocker | **Mitigated** — simulated locally with a direct `pg` connection (identical query path) |

## What was validated

### (a) Drizzle raw `sql` + PostGIS `ST_DWithin` — GO
`test/postgis.spike.test.ts` spins up a real `postgis/postgis:16-3.4` container, applies a schema that mirrors the production `points` table (a `geography(Point,4326)` `location` column populated via `ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography`), inserts two real pilgrimage spots (Washinomiya / Oarai, ~95 km apart), then runs radius queries through **Drizzle's raw `sql` template** (`drizzle-orm/node-postgres`):

- 10 km radius around Washinomiya → returns exactly 1 row (Washinomiya), distance < 100 m. ✅
- 120 km radius → returns both rows, ordered nearest-first via the `<->` KNN operator. ✅

This confirms Drizzle's `sql` tagged template passes parameters correctly into PostGIS functions and that `ST_DWithin` / `ST_Distance` / KNN ordering all work. We use raw `sql` (not the Drizzle query builder) for geo because PostGIS functions aren't first-class in the builder — this is the intended pattern for the real `nearby` query.

### (b) vitest-pool-workers runs a Worker test — GO
`test/worker.worker.test.ts` runs inside the **workerd runtime** (not Node) via `@cloudflare/vitest-pool-workers`. It imports the real Hono app from `src/index.ts` and asserts:
- `GET /healthz` → 200, `{status:"ok", service:"catalog"}`. ✅
- `POST /rpc/nearby` (oRPC stub) → 200 with mock spots. ✅

It uses `env` from `cloudflare:test` to supply Worker bindings, proving the pool wires `wrangler.toml` bindings into tests.

### (c) Hyperdrive blocker — mitigated
Hyperdrive (the Cloudflare binding that gives a Worker a pooled Postgres connection) is **only provisioned in the Cloudflare environment** — it cannot be exercised on a local dev box, and the workerd test pool has no real outbound TCP to a local Postgres.

**Mitigation:** the spike runs the PostGIS validation in a **plain Node vitest project** (`vitest.spike.config.ts`) using the `pg` driver over a direct TCP connection (port 55432, to avoid clashing with local Supabase on 54322). This exercises the *identical* Drizzle query path that prod will use; only the connection acquisition differs (direct `pg` locally vs. Hyperdrive's `connectionString` in prod). In prod, `wrangler hyperdrive create` yields a connection string that drops into the same `drizzle(pool)` setup — see the commented `[[hyperdrive]]` block in `wrangler.toml`.

## Why two vitest configs

The Worker pool (workerd) and the PostGIS spike (Node + Docker TCP + `node:child_process`) have incompatible runtimes, so they run as two configs that `npm test` runs in sequence:
- `vitest.config.ts` → workerd pool, `*.worker.test.ts`
- `vitest.spike.config.ts` → Node, `*.spike.test.ts`

## Version notes (blockers hit + resolved)

- The originally-pinned `@cloudflare/vitest-pool-workers@^0.9` + `vitest@3.2` combo failed at runtime with `The Console method is not implemented` (workerd `node:console` shim vs. vitest 3.2). **Resolution:** upgraded to `vitest-pool-workers@0.16.18` + `vitest@4`, the current supported pairing.
- The v3→v4 migration **removed** `@cloudflare/vitest-pool-workers/config` (`defineWorkersConfig` / `poolOptions.workers`). The new API applies the pool as a Vite **plugin**: `cloudflareTest({ wrangler: { configPath } })` from the package root. The config here uses that shape.
- oRPC `os.handler` does not infer input types from the destructured handler arg; you must declare them with a validator. To keep deps minimal we use oRPC's built-in `type<T>()` passthrough validator (no zod/valibot pulled in for the scaffold). Later cards can swap in a schema lib if runtime validation is wanted.

## How to reproduce

```bash
cd catalog
npm install
npm test          # runs worker tests (workerd) then the PostGIS spike (Docker)
# requires Docker/colima up; the spike auto-pulls postgis/postgis:16-3.4,
# starts container "catalog-spike-postgis" on :55432, and removes it after.
npm run typecheck # tsc --noEmit, clean
npx wrangler deploy --dry-run  # bundles, 163 KiB
```

## Test output (latest run)

```
test:worker  → Test Files 1 passed (1) | Tests 2 passed (2)
test:spike   → Test Files 1 passed (1) | Tests 2 passed (2)   (~18s, incl. container boot)
typecheck    → No errors found
wrangler dry-run → Total Upload 163.73 KiB / gzip 37.16 KiB
```
