# Native recovery scanner database lane

`pnpm run test:agent-db` runs bounded selection, admission and settlement-obligation
queries through the production Prisma client against disposable PostgreSQL. The
fixture uses `@animichi/test-postgres` for the container and its service roles,
then migrates a database of its own with the single Prisma chain, which now builds
every object these queries touch (`test/contract-database.ts`).
The photo-offer namespace test left with the surface #1604 removes.

The old run-store, lease sweeper and Drizzle history tests are retired. Actual admission
and host behavior live in `admission-test/` and `host-integration-test/`; selection
transactions live in `selection-test/`. None of these tests may enter the Worker bundle.
No command here selects a hosted database or changes applied migrations.
