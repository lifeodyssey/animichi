# `agent-db-test/` — the edge's agent-tier database arm (W1-2, #1251)

Separate from `test/` on purpose, exactly as `bundle-smoke/` is: this lane needs
Docker and the offline `animichi-test-postgres` image, and it is the only place
that can answer for the two properties the intake rests on — dedupe is a partial
unique index and atomicity is the transaction itself, so a double could only
lie about either.

- `pnpm run test:agent-db` — boots a disposable PostgreSQL container, creates a clean
  database from `template1`, applies the committed `migrations/neon` Atlas
  chain, and runs the statements the production adapters run. No Neon
  credentials, no network.
- Prerequisite (one-time, needs network):
  `docker build -f apps/agent/docker/test-postgres/Dockerfile -t animichi-test-postgres:18-3.6-pgvector-0.8.5 .`
- Not in `gate_edge` yet, so **run it by hand before pushing agent-tier changes**.
  `gate_edge` is also CI's `CI / affected (edge)` leg, and that leg builds no
  Postgres image; wiring the arm in means changing two contracts this repo pins
  on purpose — the image step's `if:` in
  `.github/scripts/test_pr_verification_contract.rb` (scoped to agent/db/catalog)
  and the edge `ci_lanes` list pinned by `test/bundle-smoke-lane.test.ts`. That
  is an owner call, tracked as a W1 follow-up.
- Test-only: excluded from the edge deploy unit in `.github/ci/components.json`.
- Not `db-test/`, which is the W0-S4 spike's opt-in lane: that one is pointed at a
  database someone else provisioned (`SPIKE_TEST_DATABASE_URL`) and is deleted
  when the spike closes. This lane brings its own database and outlives W0.
