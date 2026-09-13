# `@animichi/prisma-geography`

A private, temporary Prisma 8 extension pack for PostGIS `geography(Point,4326)`. It contributes:

- `geo.Geography(4326)` contract authoring;
- structured `{ type: "Point", coordinates: [longitude, latitude], srid: 4326 }` values;
- `dwithinMeters`, `distanceMeters`, and true KNN `<->` ordering.

Load `@animichi/prisma-geography/control` in Prisma configuration and the distinct
`@animichi/prisma-geography/runtime` descriptor in the Postgres client. Nothing in the current catalog or
users runtime consumes the pack yet.

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
