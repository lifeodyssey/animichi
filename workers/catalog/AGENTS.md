# workers/catalog — AGENTS.md

TypeScript Cloudflare Worker: the anime **catalog REST API** + the **data platform** (ingest →
enrich → publish). Owns catalog-domain data; the edge worker's TS agent tier (`workers/edge/src/agent/`)
reads it through the oRPC contract.
Root guide: `../../AGENTS.md`.

## Commands (from `workers/catalog/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` (`test:worker` then `test:node` — hermetic, boots no container) ·
  `pnpm run test:integration`
  (Docker; deliberately not chained into `test`, see Test pools) · `pnpm run typecheck`
  (TypeScript 7.0.2) · `pnpm run lint:oxlint` (type-aware, strict, warnings denied).
  ESLint is gone.
- `pnpm run test:smoke` — boots the real deploy bundle in workerd and asserts
  `/healthz` 200. The worker pool evaluates unbundled modules, so bundle-only
  startup failures (the StringChunk TDZ, 2026-08-05) are invisible to it — this
  gate exists for exactly that class of bug. Runs in CI as `catalog-startup-smoke`.

## Stack (per the ADR)

- **Hono** HTTP; SSE via native `ReadableStream` (no buffering middleware).
- **One query path.** Every read and write crosses the Prisma data plane (spec §4.2) — the
  **nearby** read (#1628), the `src/api` handlers (#1631), the cron/daily queries, the
  **ingest → enrich → publish writes** (#1630) and, since #1633, the staging **import**
  (`src/import/switch.ts`) and **media** (`src/media/img.ts`). `src/db/prisma.ts` builds the
  contract-bound client from `@animichi/pi-session-neon` + `@animichi/prisma-geography`, and the
  Hono `/catalog/*` boundary (or a cron pass) acquires ONE `Runtime` per request and disposes it
  with `await using` — never a connection cached across requests. The second path Drizzle held
  (`src/db/{client,schema,expressions}.ts` over neon-http) is deleted; so is
  `@neondatabase/serverless` in this package, whose only importer was that client.
  **No Hyperdrive**: no binding, no preference branch, no comment —
  `test/no-hyperdrive.worker.test.ts` is the tripwire.
- PostGIS via the geography pack's typed operations — do not vectorize structured geo (SD-29).
  Distances are reported AND ordered by the spheroid (`ST_Distance`), one metric, never `<->`
  (§4.11).
- **`pg` is aliased to `test/fakes/pg-pool-stub.ts` in the worker pool.** workerd runs with the
  CJS→ESM shim disabled and `pg` ships CommonJS, so `src/db/prisma.ts` (which imports the Prisma
  serverless entry) could not load at all without it. The stub LOADS without a socket and fails
  loudly if a test reaches a real driver; the Node integration arm resolves the real `pg`.

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

## workerd gotchas (plans / timestamptz)

- **A converted path builds PLANS.** With `CatalogPrisma` (`src/db/prisma.ts`): build with the
  shared contract's builder, run on the request's runtime (`executor.query`), and group with
  `transaction()`. Three facts that shape that code: the builder's surface stops at
  `returning`/`build`, so an upsert and a server-clock write are plan repairs in `src/db/plans.ts`;
  a projection's ALIAS is the key the row carries; and a raw fragment interpolates BOUND values
  (only a hand-built `RawExpr` renders text). `transaction()` inside an open transaction JOINS it —
  never a second connection.
- **The import loads the snapshot's OWN keys** (#1633). `src/publish/candidate-export.ts` projects
  each public table under camelCase aliases, because a projection's alias is the key the exported
  JSON carries; `src/import/snapshot-rows.ts` reads those keys back as this plane's columns. Stated
  key by key, not by case conversion — and it is where the two shapes genuinely differ:
  `points.latitude` / `longitude` are GENERATED over `location` here, so the exported pair is
  written back as the geography it came from (`428C9` otherwise).
- **The escape hatch is one rule, guarded by path.** `.semgrep/ts-no-prisma-raw-escape.yaml`
  rejects ``db.raw.sql`…` `` and a hand-built `new RawExpr(...)` everywhere but `src/db/`; the
  `fns.raw` / `match.raw` fragment form is the sanctioned shape and the query layer is full of it.
- **timestamptz comes back as a raw string under workerd** (the pg driver doesn't parse it to `Date`;
  Node would). Normalize at the boundary — `new Date(stamp).toISOString()` (see `src/api/search.ts`).
- **zod runs only at the handler/contract boundary** to validate untrusted public input — the one
  sanctioned place for a zod *value* import (contrast `src/types.ts`, which stays `import type` only;
  see Contract discipline above).
- **Resolved (2026-08-10, RETENTION-1 #940)**: the jobs Worker was retired; the catalog
  cron-dispatcher shape below is the standing pattern (see `src/index.ts`).

## Test pools

- `*.worker.test.ts` runs inside workerd via `vitest.config.ts`; its filesystem is sandboxed.
- `*.node.test.ts` runs in the plain Node pool via `vitest.node.config.ts`: filesystem, a child
  process, a Miniflare bucket, a fake seam — everything workerd cannot host that needs **no**
  database. It boots no container and `pnpm test` chains it after `test:worker` (#1771).
  Filesystem parity checks belong in a Node pool, not in Worker tests — **unless the check must
  never be skippable**.
- `*.integration.test.ts` runs in the Node pool via `vitest.integration.config.ts`, and every file
  it selects reaches for the database; `test/repo-config/integration-lane-selection.test.rb`
  refuses one that does not. The suite is **hermetic and fail-loudly** (card
  1049): its `globalSetup` (`test/integration-db-global.ts`) boots a **Docker Postgres+PostGIS**
  container and builds **one database of its own** on it — `<suite>_plane`, a clone of the
  container's migrated template, i.e. the committed Prisma chain (#1626), the shape every real
  environment has. Every database-backed file runs there. The second database this setup used to
  build, the frozen Drizzle-era shape, went with #1633: the files that needed it wrote
  `points.latitude` / `longitude` as plain scalars, which are generated columns on the plane. It is
  NOT the plane's own database — one chain per database, and `startTestPostgres` migrates the
  plane's (`integration-db-global.ts` carries the same note). Any setup failure throws — there is no
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
