# workers/catalog — AGENTS.md

TypeScript Cloudflare Worker: the anime **catalog REST API** + the **data platform** (ingest →
enrich → publish). Owns catalog-domain data; the Python agent is a read-only client of it.
Root guide: `../../AGENTS.md`.

## Commands (from `workers/catalog/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` (`vitest-pool-workers`: `test:worker` + `test:spike`) · `pnpm run typecheck` (`tsc --noEmit`).

## Stack (per the ADR)

- **Hono** HTTP; SSE via native `ReadableStream` (no buffering middleware).
- **oRPC** contract; **Drizzle for queries only** + Hyperdrive → Neon (5432 direct, not Supavisor 6543).
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

## Tests: TDD via `vitest-pool-workers`; keep `test/contract-parity.worker.test.ts` green.
