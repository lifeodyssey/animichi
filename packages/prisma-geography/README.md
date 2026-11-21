# `@animichi/prisma-geography`

A private, temporary Prisma 8 extension pack for PostGIS `geography(Point,4326)`. It contributes:

- `geo.Geography(4326)` contract authoring;
- structured `{ type: "Point", coordinates: [longitude, latitude], srid: 4326 }` values;
- `dwithinMeters`, `distanceMeters`, and true KNN `<->` ordering.
- typed `pg_trgm` `trigramSimilarity` and `trigramMatches` operations for text fields.

Load `@animichi/prisma-geography/control` in Prisma configuration and the distinct
`@animichi/prisma-geography/runtime` descriptor in the Postgres client. Both are in use: the
data-plane chain (`@animichi/pi-session-neon`) and the migrator load the control descriptor, the
catalog, users and edge Workers load the runtime descriptor, and the catalog builds its point
values with `geographyPoint`.

Run the package gates from the repository root:

```sh
pnpm --filter @animichi/prisma-geography lint
pnpm --filter @animichi/prisma-geography typecheck
pnpm --filter @animichi/prisma-geography test
pnpm --filter @animichi/prisma-geography test:integration
```

The integration suite uses only the repository's disposable PostGIS test lifecycle. Test-only SQL for
catalog inspection, EXPLAIN and deliberate mutation lives under `test/support/`; shipped source exposes no
raw-SQL query or migration fallback.
