# workers/catalog — AGENTS.md

TypeScript Cloudflare Worker: the anime **catalog REST API** + the **data platform** (ingest →
enrich → publish). Owns catalog-domain data; the edge worker's TS agent tier (`workers/edge/src/agent/`)
reads it through the oRPC contract.
Root guide: `../../AGENTS.md`.

## Commands (from `workers/catalog/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` (`test:worker` alone — hermetic, boots no container) · `pnpm run test:integration`
  (Docker; deliberately not chained into `test`, see Test pools) · `pnpm run typecheck`
  (TypeScript 7.0.2) · `pnpm run lint:oxlint` (type-aware, strict, warnings denied).
  ESLint is gone.
- `pnpm run test:smoke` — boots the real deploy bundle in workerd and asserts
  `/healthz` 200. The worker pool evaluates unbundled modules, so bundle-only
  startup failures (the StringChunk TDZ, 2026-08-05) are invisible to it — this
  gate exists for exactly that class of bug. Runs in CI as `catalog-startup-smoke`.

## Stack (per the ADR)

- **Hono** HTTP; SSE via native `ReadableStream` (no buffering middleware).
- **oRPC** contract; **Drizzle for queries only** — Neon via @neondatabase/serverless (neon-http); no Hyperdrive.
- PostGIS via `sql` tagged template — do not vectorize structured geo (SD-29).

## Contract discipline (`packages/contract` is the source of truth)

- `src/types.ts` is **`import type` only** — never a value import, never zod (keeps the zod runtime out
  of the Worker bundle). Compile-time parity is asserted by `test/contract-parity.worker.test.ts` —
  **must stay green**.
- The `/catalog/public/*` guard accepts only the query parameters the route's own contract declares
  (`@animichi/contract/public-catalog` — the same allowlist the edge gateway reads, #1691); an
  undeclared parameter answers its 400 before any handler or database work, so the cache key stays
  the route's bounded query surface.
- Error registry = **two mirrors, one registry** (contract zod → catalog no-zod mirror). Never throw a bare `ORPCError` / `Error` for an actionable failure — register a code.
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

- **Drizzle via the single adapter seam** — every statement is built with the Drizzle **query
  builder** through `statementBuilder()` (`src/db/client.ts`) plus the typed expression helpers in
  `src/db/expressions.ts`, then executed through `CatalogDb` (`db.execute` / `db.batch`). Raw `sql`
  tagged template is reserved for narrow fragments (PostGIS, pg_trgm, interval) inside the
  expressions module. Every complete-SQL statement runs through the builder so the worker pool can
  test through fakes; the remaining live-Neon caveat (builder execution under workerd + neon-http
  still needs a real-Neon validation) is documented on `statementBuilder()`.
- **timestamptz comes back as a raw string under workerd** (the pg driver doesn't parse it to `Date`;
  Node would). Normalize at the boundary — `new Date(stamp).toISOString()` (see `src/api/search.ts`).
- **zod runs only at the handler/contract boundary** to validate untrusted public input — the one
  sanctioned place for a zod *value* import (contrast `src/types.ts`, which stays `import type` only;
  see Contract discipline above).
- **Resolved (2026-08-10, RETENTION-1 #940)**: the jobs Worker was retired; the catalog
  cron-dispatcher shape below is the standing pattern (see `src/index.ts`).

## Test pools

- `*.worker.test.ts` runs inside workerd via `vitest.config.ts`; its filesystem is sandboxed.
- `*.integration.test.ts` runs in the Node pool via `vitest.integration.config.ts` for filesystem,
  TCP, Docker, or child-process work. Filesystem parity checks belong here, not in Worker tests —
  **unless the check must never be skippable**. The suite is **hermetic and fail-loudly** (card
  1049): its `globalSetup` (`test/integration-db-global.ts`) boots a **Docker Postgres+PostGIS**
  container and installs the frozen Drizzle-era shape
  (`packages/test-postgres/sql/drizzle-era-catalog.sql`) on a database of its own — the plane's own
  database is migrated by the Prisma chain now (#1625), and this query layer still reads the
  pre-Prisma shape, so the suite keeps a database of its own until #1628–#1631 land
  (`integration-db-global.ts` carries the same note). Any setup failure throws — there is no
  silent-skip path and **zero Neon environment variables**.
  The suite is `test:integration`, one of the four scripts every lane already runs for an affected
  package: pre-push (`scripts/local-gates/pre-push-affected.sh`), CI's affected matrix
  (`.github/workflows/pr-verification.yml`) and `make check-full`. It is *not* chained into `test`
  (#1473): `test` stays Docker-free because it is the script every affected package runs first.
  `test/repo-config/package-test-segments.test.rb` pins that `test` does not chain `test:integration`
  and that `test:integration` still runs `vitest.integration.config.ts`; the matrix loop that runs it
  for `catalog` is pinned by `.github/test/pr-verification-affected.test.rb`. Whether the container
  actually boots is `test/integration-db-global.ts`'s job.
  **colima (macOS) local runs**: testcontainers' ryuk reaper bind-mounts the daemon socket, and
  the macOS-side colima socket mounts as a dead file — ryuk panics and the suite dies with
  `Log stream ended and message "/.*Started.*/" was not received`. Export
  `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` **and**
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` (the VM-internal path) before
  `pnpm test:integration`. CI's linux runners need neither.
  Config-as-data guards that must always run therefore belong in the worker pool, reading their file
  via Vite's `?raw` suffix (inlined at transform time, so the sandboxed filesystem never comes
  into it).
  See `test/wrangler-private.worker.test.ts`.
- TDD via `vitest-pool-workers`; keep `test/contract-parity.worker.test.ts` green.
