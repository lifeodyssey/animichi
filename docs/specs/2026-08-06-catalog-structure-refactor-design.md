# Catalog structure refactor (existing code only)

- Status: **ACCEPTED** (owner 2026-08-06 — best-practice default; **no implementation in this doc**)
- Date: 2026-08-06
- Package: `workers/catalog` (+ rename notes for `packages/contract` types **already consumed**)
- Parents:
  - `docs/specs/2026-08-06-catalog-clean-architecture-design.md` (ACCEPTED CA target)
  - `docs/specs/2026-08-06-greenfield-language-and-data-plane.md` (Point / Bangumi / Itinerary)
- Scope lock: **only** catalog internal structure (move files/functions, simplify, SOLID / 1-10-50).
  **Not** edge / web / maintenance / monorepo root. **Not** new product features.

---

## 0. Intent

Turn today’s “pipeline folders + `api/*` transaction scripts + grab-bag `lib/*`” into the **existing** CA target tree **by moving and thinning code that already exists**, not by inventing product surfaces.

**Do**

- `git mv` / function extract into `domain/`, `application/`, `adapters/`, `processes/`
- Collapse duplicate mappers and dual “Origin” shapes where they already exist
- Prefer **delete** wrong layering over new interface trees
- Keep narrow ports that already work (`SearchDb`, `RouteDb`, …) — rename/relocate, do not grow a God port

**Do not**

- Rename-only PRs without moves that improve dependency direction
- Build empty domain entities for thin paths
- Ship Share / Check-in / しおり / OSRM layer-2 / SEO pipelines under this train
  (ticket pointers only — see §6)

---

## 1. Current inventory

Inventory taken from the live tree under `workers/catalog/` (2026-08-06). Line counts are approximate end-of-file anchors from reads (useful for prioritization, not CI pins).

### 1.1 `src/` tree (today)

```text
workers/catalog/src/
  index.ts                 # Hono app, DB pool, media route, IngestEntrypoint, cron (~239)
  router.ts                # oRPC implement(catalogContract) + CatalogContext (~109)
  types.ts                 # import-type mirror of packages/contract models (~186)
  cron-config.ts           # seed/TTL cron strings + batch cap
  api/
    anime-overview.ts      # SQL + pure overview aggregation (~174)
    geocode.ts             # SQL exact/fuzzy + collapse (~48)
    nearby.ts              # geo-query + detail merge (~68)
    preview.ts             # Anitabi lite + Bangumi search mapping (~93)
    resolve.ts             # alias hit + Bangumi miss ranking + SQL (~250)
    route.ts               # load points + cluster + plan + assemble Route (~171)
    search.ts              # alias hit/miss + SearchDb + SQL (~244)
    spots.ts               # representative point + distance (~99)
    work-points.ts         # work-id tiered preview/ingest (~136)
  lib/
    alias.ts               # normalizeAlias + rankAliases (pure, ~85)
    clustering.ts          # clusterByLocation union-find (pure, ~183)
    errors.ts              # CATALOG_ERRORS + ORPCError factories (~124)
    geo.ts                 # haversine (pure, ~36)
    geo-query.ts           # PostGIS nearby SQL (~58)
    geocode.ts             # collapseGeocodeHits pure collapse (~125)
    optional.ts            # strip null optionals (~21)
    route.ts               # orderNearestNeighbor + buildTimedItinerary (pure, ~300)
    rows.ts                # row coercers (~37)
    series.ts              # walkSeries pure graph (~100)
    upstream.ts            # withUpstreamUnavailable → ORPC (~13)
    transit/               # pure transit kernel + etl/* (already mostly pure)
      compare.ts, constants.ts, dijkstra.ts, estimate.ts, format.ts,
      graph.ts, heap.ts, leg.ts, model.ts, nearest.ts, index.ts
      etl/{build,coverage,csv,ekidata,index,n02}.ts
  db/
    client.ts              # makeDb / makeNeonSql / CatalogDb types
    schema.ts              # drizzle typing-only tables (work_id columns still present)
  ingest/
    orchestrator.ts        # singleflight full ingest (~157)
    jobs.ts                # JobStore / acquire / guard
    sources.ts             # Anitabi + Bangumi fetch (~240+)
    retry.ts               # retry helper
    raw-store.ts           # raw_* upserts
    cron-queries.ts        # seed/TTL SQL lists
    seed-works.ts          # checked-in seed list
  enrich/
    enrich.ts              # raw → UPSERT bangumi/points/aliases + publish (~176)
    parse.ts               # parseBangumi / parseAnitabiPoints (pure-ish, ~211)
  publish/
    versioning.ts          # cluster_version blue/green
    snapshots.ts           # route_snapshots R/W (legacy name)
    gc.ts                  # old version GC
  media/
    img.ts                 # lazy R2 image serve (~160)
    r2.ts                  # put/get image helpers (~23)
```

Supporting (not moved as “product API”, but part of package layout):

```text
workers/catalog/
  test/                    # *.worker.test.ts + *.spike.test.ts + fixtures/
  scripts/                 # gazetteer + transit ETL CLIs
  data/                    # gazetteer sources/audit
  wrangler.toml, vitest*.ts, package.json, AGENTS.md, CONTEXT.md
```

### 1.2 Hot modules (priority for structure)

| Module | ~LOC | Role today | Structure pressure |
|---|---:|---|---|
| `lib/route.ts` | 300 | Pure itinerary kernel | File at 1-10-50 file ceiling; domain home |
| `api/resolve.ts` | 250 | Use case + SQL + miss ranking | Classic SRP mix; best vertical slice after itinerary |
| `api/search.ts` | 244 | Use case + SearchDb + SQL + ingest hook | Second vertical slice |
| `index.ts` | 239 | Framework entry + cron + entrypoint | God boundary file |
| `ingest/sources.ts` | 240+ | Outbound HTTP | Belongs in adapters/outbound |
| `enrich/parse.ts` | 211 | Upstream JSON → rows | Domain/parser vs adapter boundary |
| `lib/clustering.ts` | 183 | Pure cluster | Domain ready |
| `api/anime-overview.ts` | 174 | SQL + pure aggregation | Split pure scene/circle builders |
| `api/route.ts` | 171 | Almost textbook app orchestration | Template for PlanItinerary |
| `enrich/enrich.ts` | 176 | Write batch orchestration | Application process |
| `media/img.ts` | 160 | R2 + SQL media | Outbound adapter |
| `api/work-points.ts` | 136 | Ingest claim orchestration | Application |
| `lib/errors.ts` | 124 | ORPC error registry mirror | **Stay inbound**; not domain |
| `lib/geocode.ts` | 125 | Pure collapse | Domain |

### 1.3 What is already “correct fragments”

| Fragment | Evidence | Keep / move as-is |
|---|---|---|
| Pure itinerary kernel | `lib/route.ts` — no I/O | → `domain/itinerary/` |
| Pure clustering | `lib/clustering.ts` | → `domain/model/cluster.ts` |
| Pure haversine | `lib/geo.ts` | → `domain/geo/haversine.ts` |
| Narrow ports on read paths | `SearchDb`, `RouteDb`, `ResolveDb`, `WorkPointsDb`, `OverviewDb` | → `application/ports` or colocated use-case files |
| `CatalogContext` injection | `router.ts` | Keep shape; live under inbound |
| Route handler flow | `api/route.ts`: fetch → cluster → plan → assemble | Template for PlanItinerary use case |
| Contract `import type` only | `types.ts` + AGENTS discipline | Stay at adapter boundary |
| Transit pure kernel | `lib/transit/*` (non-etl) | → `domain/transit/` |

### 1.4 Cross-cutting language lag (catalog-local; contract rename notes)

Already present in catalog code / schema typing (greenfield renames ride the structure train, not a separate cosmetic PR):

| Today (catalog) | Target language |
|---|---|
| `PilgrimagePoint` (`types.ts`, handlers) | **Point** |
| `Route` / `route` handler / `POST …/route` | **Itinerary** / `planItinerary` |
| `work_id` in SQL (`aliases`, `cluster_version`, `route_snapshots`) | **`bangumi_id`** |
| `pointsByWorkId` / `input.work_id` | **`pointsByBangumiId` / `bangumi_id`** |
| `route_snapshots` / `saveRouteSnapshot` | **`itinerary_snapshots`** |
| `AnimeSampleRoute` / `sample_routes` | **AnimeSampleItinerary** / `sample_itineraries` |
| `lib/route.ts` dual `Origin` (kernel-only lat/lng) vs wire `Origin` | One domain origin coord type + wire map at boundary |

**Contract touch (notes only, same train as greenfield G1):** types and paths catalog already implements — `PilgrimagePoint`, `Route`, `pointsByWorkId`, `work_id`, route procedure — become Point / Itinerary / bangumi_id. No new contract procedures.

---

## 2. File / function move table

Concrete **from → to** for existing code. Intermediate re-exports allowed only inside a PR and **deleted before merge**.

### 2.1 Domain (no I/O, no hono/orpc/drizzle/neon)

| From | To | Symbols / notes |
|---|---|---|
| `src/lib/route.ts` | `src/domain/itinerary/plan.ts` | `orderNearestNeighbor`, `buildTimedItinerary`, `computeDwellMinutes`, `MAX_ITINERARY_CLUSTERS`, `ItineraryOptions` |
| (split if needed) `src/lib/route.ts` pacing tables | `src/domain/itinerary/pacing.ts` | `DWELL_MULTIPLIERS`, `TRANSIT_BUFFERS`, `safePacing` — only if plan.ts stays ≥300 |
| `src/lib/clustering.ts` | `src/domain/model/cluster.ts` | `ClusterablePoint`, `LocationCluster`, `clusterByLocation` |
| `src/lib/geo.ts` | `src/domain/geo/haversine.ts` | `haversine` |
| `src/lib/alias.ts` | `src/domain/model/alias.ts` | `Source`, `normalizeAlias`, `rankAliases`, `RawAlias`, `RankedAlias` |
| `src/lib/geocode.ts` | `src/domain/geocode/collapse.ts` | `collapseGeocodeHits`, thresholds, hit types used purely |
| `src/lib/series.ts` | `src/domain/model/series.ts` | `walkSeries`, `SeriesEdge`, `Relation`, `SAME_SERIES_RELATIONS` |
| `src/lib/transit/*` (except `etl/`) | `src/domain/transit/*` | keep internal relative imports |
| pure parts of `api/anime-overview.ts` | `src/domain/overview/*` or `application` pure helpers | `buildCircles`, `buildScenes`, `buildSampleRoutes` / `toSampleItinerary` (rename) — **no SQL** |
| domain errors (new thin types only if needed) | `src/domain/errors.ts` | e.g. too-many-clusters **as data**, not `ORPCError` |

**Do not move into domain:** `lib/errors.ts` (ORPC), `lib/geo-query.ts` (SQL), `lib/rows.ts` / `optional.ts` (boundary mapping — adapters or shared adapter util).

### 2.2 Application (use cases + ports; no hono/drizzle impl)

| From | To | Responsibility |
|---|---|---|
| `api/route.ts` orchestration | `application/plan-itinerary.ts` | load points (port) → cluster → plan → assemble Itinerary |
| `api/route.ts` `fetchPoints` / SQL | **outbound** (below), called via port | |
| `api/search.ts` `search` / hit / miss | `application/search-points.ts` | alias hit vs partial preview + background ingest |
| `api/search.ts` `SearchDb` | `application/ports.ts` (or `ports/search.ts`) | keep narrow surface |
| `api/work-points.ts` | `application/list-points-for-bangumi.ts` | claim/preview/ingest orchestration |
| `api/work-points.ts` `WorkPointsDb` | ports | |
| `api/resolve.ts` resolve ranking (no SQL) | `application/resolve-bangumi.ts` | hit rules + miss similarity |
| `api/resolve.ts` `ResolveDb` | ports | |
| `api/spots.ts` handler body | `application/get-point.ts` | representative point + optional distance |
| `api/nearby.ts` merge logic | `application/nearby-points.ts` | geo port + detail port |
| `api/geocode.ts` lookup orchestration | `application/geocode-place.ts` | exact-first then fuzzy; collapse pure domain |
| `api/anime-overview.ts` orchestration | `application/anime-overview.ts` | load rows → pure builders |
| `api/preview.ts` | `application/miss-preview.ts` **or** outbound preview service used by use cases | keep single owner of lite mapping |
| `ingest/orchestrator.ts` | `application/ingest-bangumi.ts` | singleflight full ingest |
| `index.ts` `runSeedJob` / `runTtlJob` / `ingestBatch` | `application/cron-ingest.ts` | pure job loop; deps as ports |

### 2.3 Adapters — inbound (framework)

| From | To | Notes |
|---|---|---|
| `index.ts` Hono app + `/catalog/*` + healthz + img route | `adapters/inbound/http/app.ts` | thin wiring only |
| `router.ts` | `adapters/inbound/http/router.ts` | oRPC only |
| thin handlers wrapping use cases | `adapters/inbound/http/handlers/*.ts` | map errors → ORPC; **no SQL** |
| `index.ts` `IngestEntrypoint` | `adapters/inbound/rpc/ingest-entrypoint.ts` | service-binding door stays |
| `index.ts` scheduled export | `adapters/inbound/cron/scheduled.ts` | uses application cron use cases |
| `cron-config.ts` | `config/cron.ts` | constants only |
| `lib/errors.ts` | `adapters/inbound/http/errors.ts` | ORPC factories stay outer |
| `lib/upstream.ts` | next to errors or outbound | maps transport → typed boundary error |
| `types.ts` | `adapters/inbound/http/wire-types.ts` (or keep `types.ts` at src root briefly) | still `import type` only |

### 2.4 Adapters — outbound

| From | To | Notes |
|---|---|---|
| `db/client.ts` | `adapters/outbound/neon/client.ts` | |
| `db/schema.ts` | `adapters/outbound/neon/schema.ts` | typing only; column renames with greenfield |
| SQL in `api/search.ts` | `adapters/outbound/neon/alias-index.ts` + `points-repo.ts` | `firstWorkId`, `selectPoints` |
| SQL in `api/route.ts` | `adapters/outbound/neon/points-repo.ts` | `pointsQuery` by ids |
| SQL in `api/resolve.ts` | `adapters/outbound/neon/alias-index.ts` + `bangumi-repo.ts` | |
| SQL in `api/spots.ts` / `nearby.ts` / `anime-overview.ts` / `geocode.ts` | same repos by concern | avoid one God repo |
| `lib/geo-query.ts` | `adapters/outbound/neon/geo-query.ts` | PostGIS |
| `lib/rows.ts`, `lib/optional.ts` | `adapters/outbound/neon/row-map.ts` (or `adapters/shared/`) | row → wire/DTO |
| `ingest/sources.ts` + `retry.ts` | `adapters/outbound/upstream/{anitabi,bangumi,retry}.ts` | |
| `ingest/raw-store.ts` | `adapters/outbound/neon/raw-store.ts` | |
| `ingest/jobs.ts` | `adapters/outbound/neon/job-store.ts` | JobStore |
| `ingest/cron-queries.ts` | `adapters/outbound/neon/cron-queries.ts` | |
| `publish/*` | `adapters/outbound/neon/publish/*` **or** keep under processes (see §2.5) | versioning is persistence |
| `media/img.ts`, `media/r2.ts` | `adapters/outbound/r2/media.ts` + img serve adapter | |
| `enrich/parse.ts` | prefer `adapters/outbound/upstream/parse.ts` **or** `domain` if treated as pure parse of known JSON | pure parse of upstream payloads → stay framework-free; either domain or outbound-without-I/O helper |

### 2.5 Processes (data platform — existing pipeline only)

| From | To | Notes |
|---|---|---|
| `ingest/*` (remaining orchestration glue) | `processes/ingest/` **or** fully absorbed into `application/ingest-bangumi` + outbound | Prefer absorb over empty process shell |
| `enrich/enrich.ts` | `application/enrich-bangumi.ts` or `processes/enrich/enrich.ts` | application orchestration of pure parse + SQL ports |
| `publish/*` | `processes/publish/` if kept as stage name in CONTEXT | still calls outbound neon |

**Preference (owner principle):** if `processes/` would only re-export application modules, **skip the folder** and put orchestration under `application/`. Delete process indirection rather than add it.

### 2.6 Entry re-exports (temporary)

| From | To | Lifetime |
|---|---|---|
| Old paths under `src/api/*`, `src/lib/*` | one-line re-export of new path | **delete in same PR** once tests import new paths |

### 2.7 Test layout (existing tests only)

| From | To (optional, later PR) | Rule |
|---|---|---|
| pure kernel tests (`route.worker`, `clustering`, transit-*) | `test/domain/…` when path move lands | keep workerd vs spike split rules from AGENTS |
| search/resolve/route API tests | `test/application/` + thin adapter tests | do not rewrite scenarios; only update imports |
| spike / neon | stay spike pool | no structural rewrite required for design |

---

## 3. SOLID / 1-10-50 smells (with evidence)

### 3.1 Single Responsibility

| Smell | Evidence | Fix direction |
|---|---|---|
| Handler = use case + SQL + DTO map | `api/search.ts` exports `search`, `searchDb`, SQL `firstWorkId`/`selectPoints`, and `toPoint` | split application vs neon adapter |
| Same for resolve | `api/resolve.ts` ranking pure logic + `resolveDb` SQL in one file (~250) | same |
| Entry god-file | `index.ts` Hono + pool + media + IngestEntrypoint + cron jobs | split inbound adapters |
| `lib/` grab bag | pure kernels next to `errors` (ORPC) and `geo-query` (SQL) | dissolve `lib/` by layer |
| Enrich stages SQL + domain cluster log | `enrich/enrich.ts` | application orchestration + outbound statements |

### 3.2 Open/Closed & Dependency Inversion

| Smell | Evidence | Fix |
|---|---|---|
| Production wiring inside use-case modules | `searchDb(db)`, `workPointsDb(db)`, `resolveDb(db)` defined beside use cases | keep factories, but place them under outbound adapters implementing ports |
| Application imports orchestrator + JobStore concrete | `api/work-points.ts` imports `./ingest/*` and `JobStore` | depend on port methods already on `WorkPointsDb` only (good) — **delete direct JobStore import from application path** by completing the port |
| Domain-ish throw becomes framework error mid-stack | `lib/route.ts` throws bare `Error` for too many clusters; `lib/errors.ts` builds ORPC; router maps spots/overview | domain signal → application → inbound map once |

### 3.3 Interface Segregation (keep what works)

| Good | Evidence | Do not “improve” into |
|---|---|---|
| Narrow `SearchDb` / `RouteDb` / `ResolveDb` / `WorkPointsDb` / `OverviewDb` | each file defines only methods it needs | **God `CatalogDb` port** wrapping all SQL |
| `RouteDb` is just `execute` | `api/route.ts` | fine for thin reads; optional later PointsRepo with typed methods |

**Delete:** any impulse to invent `ICatalogService` / base repository class hierarchy.

### 3.4 Liskov / substitution

Ports already use structural typing (`CatalogDb` satisfies `RouteDb` via drizzle `execute`). Keep structural ports; no inheritance trees.

### 3.5 DRY violations (existing duplication)

| Duplication | Paths | Consolidation |
|---|---|---|
| Point row → wire Point | `search.toPoint`, `route.toPoint`, `spots.toPoint`, `nearby.merge`, `preview.litePoint` | one `adapters/…/map-point.ts` (or shared mapper); lite path stays separate input shape |
| Origin: kernel lat/lng vs wire union | `lib/route.ts` `Origin` vs `types.ts` `Origin` | domain `GeoOrigin {lat,lng}`; wire map in plan-itinerary / get-point |
| Optional null stripping | repeated `optional({…})` | keep `optional` helper once under adapters/shared |
| Alias SQL `work_id` | `search.ts`, `resolve.ts` | single AliasIndex outbound |

### 3.6 1-10-50 pressure

| Rule | Breaches / near | Action |
|---|---|---|
| File ≤300 | `lib/route.ts` ~300 | split pacing/assemble if anything else is added; move first |
| File ≤300 | `api/resolve.ts` ~250, `api/search.ts` ~244 | drops when SQL extracted |
| Function ≤10 | generally followed in enrich/route helpers | preserve when moving |
| Class ≤50 | `JobStore` is a thin class — OK | keep; no new service classes |
| Indent ≤2 | mostly OK | preserve early-return style in work-points claim flow |

### 3.7 Language / boundary smells (structure-relevant)

| Smell | Paths |
|---|---|
| Fan language still `Route` / `PilgrimagePoint` / `work_id` | `types.ts`, handlers, `router.ts` `pointsByWorkId`, `schema.ts` columns, `publish/snapshots.ts` |
| Overview still builds `sample_routes` | `api/anime-overview.ts` `buildSampleRoutes` |
| Domain pure code imports wire names from `types` | `lib/route.ts` imports `TimedItinerary` from `../types` | either domain owns plan types, or imports only type-only aliases renamed to Itinerary |

---

## 4. Target patterns — and what NOT to use

### 4.1 Patterns to use (minimal)

1. **Pure domain functions**
   Existing kernels stay functions/modules, not entity class hierarchies.
   Example spine: `clusterByLocation` → `buildTimedItinerary`.

2. **Use case functions**
   `planItinerary(ports, input)`, `searchPoints(ports, input)`, …
   One exported async function per use case file; helpers private.

3. **Narrow ports (structural TypeScript interfaces)**
   Extend the existing style:

   ```text
   PointsRepo.loadByIds(ids) → Point[]
   AliasIndex.bangumiIdForNormalized(alias) → bangumi_id?
   BangumiRepo.candidatesForIds / metadata
   GazetteerRepo.exact / fuzzy
   UpstreamCatalog.lite / search / full
   IngestGate.claim / guard / runClaimed
   Clock / WaitUntil (for miss path)
   ```

   Prefer **several small interfaces** over one catalog façade.

4. **Adapter inbound thin handlers**
   parse/validate (oRPC/zod at boundary) → call use case → map domain/application errors to `lib/errors` (relocated) ORPC factories.

5. **Adapter outbound neon**
   Raw `sql` tagged templates only (workerd hang rule stays — AGENTS).
   No fluent Drizzle query builder.

### 4.2 What NOT to use

| Anti-pattern | Why |
|---|---|
| New abstract base classes / DI containers | package is a Worker; structural ports + factories suffice |
| God `CatalogDb` / `UnitOfWork` mega-port | violates ISP; existing narrow ports already testable |
| Domain entities with mutators / ORM entities | schema is typing-only; points are values |
| Hexagonal “port per function” explosion | one port per **concept**, not per SQL string |
| Long-lived `src/lib` façade re-exports | temporary only |
| Empty `domain/model/point.ts` with no behavior | only add if a pure invariant needs a home |
| CQRS/event-sourcing layers | not in current code; out of scope |
| New middleware frameworks | Hono + oRPC stay |

### 4.3 Target tree (aligned with CA parent; processes optional)

```text
workers/catalog/src/
  domain/
    model/           # cluster, alias, series (+ Point/Bangumi types if needed)
    itinerary/       # plan, pacing
    geo/             # haversine
    geocode/         # collapse pure
    transit/         # moved pure kernel
    overview/        # pure circle/scene builders (optional)
    errors.ts        # non-ORPC signals only if needed
  application/
    ports.ts         # or ports/*.ts
    plan-itinerary.ts
    search-points.ts
    list-points-for-bangumi.ts
    resolve-bangumi.ts
    get-point.ts
    nearby-points.ts
    geocode-place.ts
    anime-overview.ts
    miss-preview.ts
    ingest-bangumi.ts
    enrich-bangumi.ts   # if not under processes
    cron-ingest.ts
  adapters/
    inbound/
      http/           # app, router, handlers, errors, wire-types
      cron/
      rpc/            # IngestEntrypoint
    outbound/
      neon/           # client, schema, repos, job-store, raw-store, geo-query, publish
      upstream/       # anitabi, bangumi, parse, retry
      r2/             # media
  config/
    cron.ts
  # NO long-term lib/, api/ after P6
```

Package root entry for wrangler: keep a **thin** `src/index.ts` that re-exports default fetch/scheduled from inbound adapters (Cloudflare entry path stability).

### 4.4 Dependency rules (hard)

```text
domain        → (nothing in catalog except other domain)
application   → domain + ports (interfaces only)
adapters      → application + domain + frameworks
config        → nothing
```

Forbidden: domain/application import `hono`, `@orpc/server` values, `drizzle-orm` SQL builders, `cloudflare:workers`.

---

## 5. PR slices (existing code only, ordered)

Each slice: **one reviewable PR**, green `pnpm test` + typecheck + oxlint in `workers/catalog`. Prefer vertical slices that leave no half-dead `lib/` permanent dual homes.

| # | Slice | Moves / deletes | Done when |
|---|---|---|---|
| **S0** | Design docs only | this file + parents already ACCEPTED | no code |
| **S1** | Greenfield language in catalog + contract types catalog uses | rename Point/Itinerary/bangumi_id in `types.ts`, handlers, router keys, schema column names **as consumed**, snapshots table name alignment with greenfield | compile + catalog tests green; **structure can still be old folders** if needed, but no new old names |
| **S2** | Domain extract (pure only) | `lib/route|clustering|geo|alias|geocode|series|transit` → `domain/*`; delete `lib` copies | domain imports have zero I/O; itinerary/clustering tests import new paths |
| **S3** | PlanItinerary vertical | `api/route.ts` → `application/plan-itinerary` + `outbound/neon/points-repo` + thin handler; router calls handler | handler has no SQL; behavior parity on route tests |
| **S4** | Search + work-points vertical | `search` / `preview` / `work-points` → application + AliasIndex/Points/Ingest ports; outbound SQL + upstream | miss/hit/partial parity; `SearchDb`/`WorkPointsDb` live as ports |
| **S5** | Resolve vertical | pure ranking → application; SQL → neon; miss upstream → outbound | resolve tests green |
| **S6** | Remaining reads | spots, nearby, geocode, anime-overview same pattern; pure overview builders out of SQL file | no new business rules inside handlers |
| **S7** | Ingest/enrich/publish placement | orchestrator/jobs/sources/raw/enrich/publish → application + outbound; delete orphan process shells | cron + ingest entrypoint + worker tests green |
| **S8** | Inbound finalize + delete husks | split `index.ts`; move errors; **delete** empty `api/`, `lib/`, old re-exports; update `AGENTS.md` paths | tree matches §4.3; startup smoke green |

### 5.1 Slice rules

- **S1 may couple to monorepo contract** (greenfield); still **catalog-first** in this design — web/agent follow outside this doc’s implementation ownership.
- **S2 before S3** so itinerary domain is free of wire rename thrash mid-move (or S1+S2 combined if PR size acceptable).
- **Do not** open a “introduce ports only” PR with zero callers moved.
- **Do not** move tests without code in the same slice.

### 5.2 Suggested first vertical (teaching path)

`PlanItinerary` is already almost correct in `api/route.ts`:

1. Domain: cluster + plan (S2)
2. Application: load via port → domain → assemble Itinerary (S3)
3. Outbound: one SQL
4. Inbound: cap check stays in router/handler (`MAX_ROUTE_POINT_IDS` → itinerary point cap)

Use this as the template for Search (harder: waitUntil + ingest).

---

## 6. Explicit non-goals / out of scope

### 6.1 Other packages / surfaces

- `workers/edge`, `apps/web`, `workers/users`, `workers/maintenance`, monorepo root layout
- Agent Python catalog client (except note that contract rename forces follow-up **outside** this structure doc’s catalog PRs)
- New public HTTP products not already in `catalogContract`

### 6.2 Product / enabler tickets (one-line pointers only)

| Topic | Ticket pointer | Relation to this refactor |
|---|---|---|
| OSRM / rail topology layer-2 | #292 (and related) | do not implement under structure PRs |
| Quality / SEO pipelines | #285 etc. | not created here |
| Ingest internal entry morph | #540 / #555 | if already code-shaped, only **relocate**; no new universe |
| Share / Check-in / しおり | #235 / #243 / #249 … | Users/product train — **not** catalog structure |
| Delete-not-in-set enrich gap | noted in `enrich/enrich.ts` header | product/data quality ticket, not structure |
| Persist cluster_id / city_backfill | enrich comments | not structure |

### 6.3 Non-structure work this design refuses

- Rewrite transit ETL algorithms or gazetteer scripts (scripts/ stay; optional import path fix only when domain/transit moves)
- New caching layers, Hyperdrive adoption, Drizzle query-builder revival
- Compatibility aliases for old wire names (greenfield: **no**)
- Coverage theatre / large test rewrites without behavior change
- Adding Share/Check-in tables or SavedRoute concepts into catalog

### 6.4 Abstraction non-goals

- Demonstrating OOP for its own sake
- Full DDD aggregate/repository textbooks with factories for every row
- Micro-package split of catalog into multiple Workers

---

## 7. Risk register (structure)

| Risk | Mitigation |
|---|---|
| Import graph thrash breaks vitest workerd pool | move + update tests same PR; avoid path aliases until needed |
| Dual homes (`lib` re-export forever) | PR checklist: no re-export left at merge |
| Over-porting thin GetPoint | allow application file that is 20 lines calling one repo method |
| Contract rename vs folder move conflicts | sequence S1 then S2–S3, or one carefully owned mega-PR with greenfield |
| Cron / entrypoint export shape (workerd primitive export ban) | keep constants in `config/`; entry only exports handlers/classes |

---

## 8. Acceptance (for future implementation PRs)

Structure refactor is done when:

1. No long-term `src/api/` or `src/lib/` (except temporary deleted in-PR).
2. `domain/**` has no framework/SQL imports (lint or boundary test optional).
3. PlanItinerary + SearchPoints paths: handlers thin; SQL in outbound; pure plan/cluster in domain.
4. Language: Point / Bangumi / Itinerary in catalog-facing names; no new `work_id` / `PilgrimagePoint` / bare `Route`.
5. `AGENTS.md` paths match the tree; startup smoke + worker/spike suites green.
6. No new product feature landed in the same PRs.

---

## 9. Related docs

| Doc | Role |
|---|---|
| `docs/specs/2026-08-06-catalog-clean-architecture-design.md` | CA target, ports, P1–P6 |
| `docs/specs/2026-08-06-greenfield-language-and-data-plane.md` | Language + tables |
| `workers/catalog/CONTEXT.md` | BC language ownership |
| `workers/catalog/AGENTS.md` | Commands, workerd SQL rules (update after moves) |
| `packages/contract` | Wire SoT for renames catalog already implements |

---

## 10. Changelog

| Date | Change |
|---|---|
| 2026-08-06 | Initial structure-refactor design: inventory, move table, SOLID evidence, patterns, PR slices S0–S8, non-goals |
| 2026-08-06 | Owner ACCEPTED (best-practice default) |
