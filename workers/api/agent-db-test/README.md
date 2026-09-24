# Native recovery scanner database lane

`pnpm run test:agent-db` runs bounded selection, admission and settlement-obligation
queries through the production Prisma client against disposable PostgreSQL. The
three fixtures share ONE database for the whole lane (`lane-contract-database.ts`,
#1771): `@animichi/test-postgres` gives the container and its service roles, and that
one database is cloned from the container's migrated template, which builds every
object these queries touch (`test/contract-database.ts`). Each fixture keeps its own
client and its own `beforeEach`; the tables they clean are disjoint.
The photo-offer namespace test left with the surface #1604 removes.

The old run-store, lease sweeper and Drizzle history tests are retired. Actual admission
and host behavior live in `admission-test/` and `host-integration-test/`; selection
transactions live in `selection-test/`. None of these tests may enter the Worker bundle.
No command here selects a hosted database or changes applied migrations.
