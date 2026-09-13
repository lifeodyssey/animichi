# prisma-geography — AGENTS.md

Private Prisma 8 extension pack for an SRID-constrained PostGIS geography point. Root guide:
`../../AGENTS.md`. This package is independent infrastructure; no catalog or users consumer moves here
until its owning migration card.

- `pnpm run contract:emit` — regenerate `src/contract.json` and `src/contract.d.ts`.
- `pnpm exec prisma migration plan --name <snake_slug> --json` — plan a native migration after emission.
- `pnpm run lint` / `pnpm run typecheck` / `pnpm run test` — package static and unit gates.
- `pnpm run test:integration` — one disposable `@animichi/test-postgres` PostGIS lifecycle, serially.
  It enforces 95% line coverage and writes `coverage/lcov.info`. Never point it at live Neon.

The public package surface has seven exports. `./control` is the authoring/control descriptor loaded by
`prisma.config.ts`; `./runtime` is a distinct runtime descriptor loaded by a Postgres client. Do not
collapse them. The `geo.Geography(4326)` author must remain the only way this package creates its
`geography(Point,4326)` column. Runtime values are structured longitude/latitude Points carrying the
declared SRID. `dwithinMeters` and `distanceMeters` use PostGIS geography metre semantics;
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
