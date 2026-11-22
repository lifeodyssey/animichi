# prisma-geography — AGENTS.md

Private Prisma 8 extension pack for an SRID-constrained PostGIS geography point. Root guide:
`../../AGENTS.md`. Its consumers: `@animichi/prisma-geography/control` is loaded by the data-plane
chain (`packages/pi-session-neon/prisma.config.ts`) and the migrator
(`workers/migrator/src/prisma-control.ts`); `@animichi/prisma-geography/runtime` by
`workers/catalog/src/db/prisma.ts`, `workers/users/src/db/prisma.ts` and
`workers/api/src/native-client.ts`; and the catalog builds its point values with `geographyPoint`.

- `pnpm run contract:emit` — regenerate `src/contract.json` and `src/contract.d.ts`.
- `pnpm exec prisma migration plan --name <snake_slug> --json` — plan a native migration after emission.
- `pnpm run lint` / `pnpm run typecheck` — package static gates.
- `pnpm run test` — the `*.unit.test.ts` files, and the coverage gate over `src/geography/**`:
  95% lines, written to `coverage/lcov.info` for CI. It lives here because this is the lane that
  earns it — the db files measure 90.08% of those lines on their own and add none the unit files
  do not already reach (#1771). Needs no container.
- `pnpm run test:integration` — the `*.db.test.ts` files: one disposable `@animichi/test-postgres`
  PostGIS lifecycle, serially: the cluster it opens (no data-plane chain applied, #1783), the pack's
  own chain database on it (one chain per database), and the pack's own migrations applied there.
  It measures no coverage. Never point it at live Neon.

The public package surface has seven exports. `./control` is the authoring/control descriptor loaded by
`prisma.config.ts`; `./runtime` is a distinct runtime descriptor loaded by a Postgres client. Do not
collapse them. The `geo.Geography(4326)` author must remain the only way this package creates its
`geography(Point,4326)` column. Its data type, `geo/geography`, declares no parameters and writes that
one column type: Prisma 8 (rc.24) fills a type text's `{param}` only from an arktype parameter schema,
which this package does not depend on, so the codec keeps the column's `srid` and refuses every SRID
but 4326 (`src/geography/srid.ts`), and `contract emit` refuses `geo.Geography(3857)`. Runtime values
are structured longitude/latitude Points carrying the declared SRID. `dwithinMeters` and `distanceMeters` use PostGIS geography metre semantics;
`knnOrder` must lower to the true `<->` infix operator.

Application and migration/query authoring code must not use a raw-SQL fallback. Raw PostgreSQL text is
allowed only under `test/support/` for independent catalog inspection, `EXPLAIN`, adversarial SRID/index
mutation and plan-only filler rows in a disposable database. Behavioral fixture inserts use the typed ORM.
Keep the same generated query statement for the indexed and index-dropped plan assertions.

`src/contract.{json,d.ts}`, `migrations/snapshots/` and migration packages are Prisma-generated artifacts.
Regenerate them through the pinned CLI; never hand-edit hashes or `ops.json`. Preserve the exact independent
pins for `@prisma/orm-postgres` and `prisma`. Zod is the Standard Schema validator; do not add arktype or a
direct `@standard-schema/spec` dependency. Negative compiler fixtures are `.txt` inputs copied to a temporary
`.ts` path so expected failures need no suppression directives.
