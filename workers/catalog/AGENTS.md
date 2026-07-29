# workers/catalog — AGENTS.md

TypeScript Cloudflare Worker: the anime **catalog REST API** + the **data platform** (ingest →
enrich → publish). Owns catalog-domain data; the Python agent is a read-only client of it.
Root guide: `../../AGENTS.md`.

## Commands (from `workers/catalog/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` (`test:worker` + `test:spike`) · `pnpm run typecheck` (TypeScript 7.0.2) ·
  `pnpm run lint:oxlint` (type-aware, strict, warnings denied). ESLint is gone.

## Stack (per the ADR)

- **Hono** HTTP; SSE via native `ReadableStream` (no buffering middleware).
- **oRPC** contract; **Drizzle for queries only** — Neon via @neondatabase/serverless (neon-http); no Hyperdrive.
- PostGIS via `sql` tagged template — do not vectorize structured geo (SD-29).

## Contract discipline (`packages/contract` is the source of truth)

- `src/types.ts` is **`import type` only** — never a value import, never zod (keeps the zod runtime out
  of the Worker bundle). Compile-time parity is asserted by `test/contract-parity.worker.test.ts` —
  **must stay green**.
- Error registry = **three mirrors, one registry** (contract zod → catalog no-zod mirror → Python
  mirror). Never throw a bare `ORPCError` / `Error` for an actionable failure — register a code.
  Full checklist + categories: `packages/contract/README.md`.

## Data platform

- `src/ingest/` (per-work TTL; singleflight via the `ingest_jobs` unique constraint — never stampede
  Anitabi) · `src/enrich/` (dedup / clustering / city backfill / attribution) · `src/publish/`.
- Route ordering is unified **here** (`src/lib/route.ts`, haversine × 1.3, SD-28) — the old Python
  `route_optimizer.py` is retired.
- Data-quality gate (X15): coordinate validation / dedup / episode completeness / volume-drift.
- Geocode API resolves normalized aliases exact-first; only an exact miss runs strict pg_trgm fuzzy
  matching, then deterministic collapse/limit (`src/api/geocode.ts`).
- Gazetteer source lock: `data/gazetteer-sources.json`; generator:
  `scripts/build-gazetteer.ts`; review output: `data/gazetteer-audit.csv`. The canonical invocation and
  provenance live in `docs/data-sources.md`.

## workerd gotchas (Drizzle / timestamptz)

- **Drizzle is queries-only through the raw `sql` tagged template** — reads and geo run through `sql`
  passed to Drizzle's `execute`, **never the fluent query builder** (its `select` / `from` chain
  **hangs** under workerd + the Neon HTTP driver; see the warning at `src/api/nearby.ts`).
  `src/db/schema.ts` (`drizzle-orm/pg-core`) exists for typing only.
- **timestamptz comes back as a raw string under workerd** (the pg driver doesn't parse it to `Date`;
  Node would). Normalize at the boundary — `new Date(stamp).toISOString()` (see `src/api/search.ts`).
- **zod runs only at the handler/contract boundary** to validate untrusted public input — the one
  sanctioned place for a zod *value* import (contrast `src/types.ts`, which stays `import type` only;
  see Contract discipline above).

## Test pools

- `*.worker.test.ts` runs inside workerd via `vitest.config.ts`; its filesystem is sandboxed.
- `*.spike.test.ts` runs in the Node pool via `vitest.spike.config.ts` for filesystem, TCP, Docker,
  or child-process work. Filesystem parity checks belong here, not in Worker tests — **unless the
  check must never be skippable**. The spike pool's `globalSetup` skips the entire suite without
  `NEON_API_KEY`/`NEON_PROJECT_ID`, so a guard placed there silently disappears in a CI job that
  has no Neon credentials. Config-as-data guards that must always run belong in the worker pool,
  reading their file via Vite's `?raw` suffix (inlined at transform time, so the sandboxed
  filesystem never comes into it). See `test/wrangler-private.worker.test.ts`.
- TDD via `vitest-pool-workers`; keep `test/contract-parity.worker.test.ts` green.
