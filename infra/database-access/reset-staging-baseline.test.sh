#!/usr/bin/env bash
# Behaviour tests for reset-staging-baseline.sh, the one step of CD's staging job that drops
# anything (#1625). CD runs it on every staging deploy, so its own gate is what keeps it from
# destroying a database it was never approved to rebuild:
#
#   app marker present, no Atlas ledger         -> named no-op, exit 0
#   app marker beside the Atlas ledger          -> named refusal, exit 1, nothing touched
#   the marker reset-staging-baseline
#     .approved-marker names, beside the ledger -> pre-state, backup branch, then the rebuild
#                                                  drops prisma_contract's three tables and the
#                                                  schema with `public`
#   ... but the owner's step fails after the
#       migrator's drop has committed         -> a half-reset, and a re-run finishes it (#1949)
#   ... but a reused backup predates the marker,
#       or a later write to the ledger          -> named refusal, exit 1, nothing touched
#   ... but prisma_contract holds a fourth table -> the drop fails, the transaction rolls back
#   no marker, no Atlas leftovers               -> named no-op, exit 0
#   no marker, leftovers, no business rows      -> pre-state, backup branch, rebuild
#   no marker, leftovers, rows only in tables
#     reset-staging-baseline.approved-rows names -> pre-state, backup branch, rebuild
#   no marker, leftovers, rows anywhere else    -> named refusal, exit 1, nothing touched
#   a read that cannot be answered              -> named refusal, exit 1, nothing touched
#
# The predicates are SQL, so each case runs the shipped script against a disposable
# PostgreSQL + PostGIS database; only `npx neonctl` is stubbed, routing `psql` to that database
# and recording the branch calls that would reach the Neon API. Fails closed without Docker or
# the offline image, like scripts/local-gates/db-fresh-schema.sh.
#
# One suite, three files split by responsibility, sourced into this shell so the one container
# serves the whole run: this file owns the seeds every case runs on and the no-marker cutover
# states the reset exists for, reset-staging-baseline.marker-cases.sh owns the marker beside the
# ledger and the owner's record that may approve it (#1781), and
# reset-staging-baseline.half-reset-cases.sh owns the half-reset a failed owner step strands and
# the re-run that finishes it (#1949).
set -euo pipefail

# shellcheck source=infra/database-access/reset-staging-baseline.test.harness.sh
. "$(dirname "${BASH_SOURCE[0]}")/reset-staging-baseline.test.harness.sh"

# Prisma 8's marker carries updated_at; the one staging held was written 2026-09-12 (#1781).
# The chain's schema is the chain's own: every seed below creates it under SET ROLE migrator, the
# ownership staging's reset ran against (#1949) — and which the ownership assertions in
# reset-staging-baseline.marker-cases.sh show.
MARKER="SET ROLE migrator;
  CREATE SCHEMA prisma_contract;
  CREATE TABLE prisma_contract.marker (space text PRIMARY KEY, core_hash text NOT NULL,
    updated_at timestamptz NOT NULL);
  INSERT INTO prisma_contract.marker VALUES ('app', repeat('a', 64), '2026-09-12 06:49:00+00');
  RESET ROLE;"
# What staging carries (spec §2.6): PostGIS's own populated spatial_ref_sys, the Atlas ledger
# with its nine revisions, and the chain's tables, empty.
ATLAS="CREATE EXTENSION postgis;
  CREATE TABLE public.atlas_schema_revisions (version text PRIMARY KEY);
  INSERT INTO public.atlas_schema_revisions SELECT g::text FROM generate_series(1, 9) g;
  CREATE TABLE public.bangumi (id text PRIMARY KEY);
  CREATE TABLE public.points (id text PRIMARY KEY);"
# The owner approved the rows staging held on 2026-09-18 by table (#1781).
APPROVED="CREATE TABLE public.sessions (id text); INSERT INTO public.sessions VALUES ('qa');
  CREATE TABLE public.ingest_jobs (id int); INSERT INTO public.ingest_jobs VALUES (276);"
# #1781: the owner's record names staging's stale marker, and the rebuild drops its schema itself.
# The cases seed the very marker the committed record names inside the three tables a real
# `prisma db migrate` writes (dumped from one on 2026-09-18), rows in each, as staging holds them.
RECORDED="$(grep -vE '^(#|$)' "$ROOT/infra/database-access/reset-staging-baseline.approved-marker")"
RECORDED_AT="${RECORDED##* updated_at=}"
recorded_marker() { # recorded_marker <interval added to the recorded instant>
  echo "SET ROLE migrator;
    CREATE SCHEMA prisma_contract;
    CREATE TABLE prisma_contract.contract (core_hash text PRIMARY KEY,
      created_at timestamptz DEFAULT now() NOT NULL, contract_json jsonb NOT NULL);
    CREATE TABLE prisma_contract.ledger (id bigserial PRIMARY KEY,
      created_at timestamptz DEFAULT now() NOT NULL, space text NOT NULL, migration_name text NOT NULL);
    CREATE TABLE prisma_contract.marker (space text DEFAULT 'app' PRIMARY KEY, core_hash text NOT NULL,
      profile_hash text NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL);
    INSERT INTO prisma_contract.contract VALUES (repeat('a', 64), '$RECORDED_AT', '{}');
    INSERT INTO prisma_contract.ledger (created_at, space, migration_name)
      VALUES ('$RECORDED_AT', 'app', 'baseline'), ('$RECORDED_AT', 'app', 'second');
    INSERT INTO prisma_contract.marker
      VALUES ('app', repeat('a', 64), repeat('b', 64), '$RECORDED_AT'::timestamptz + interval '$1');
    RESET ROLE;"
}

new_case "a database the Prisma chain already migrated" "$MARKER CREATE TABLE public.bangumi (id text); INSERT INTO public.bangumi VALUES ('kept');"
run_script 0
expect "and it names why it skipped" yes "$(said "skip: the staging baseline is already applied")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and the migrated table stands" bangumi "$(relation public.bangumi)"

new_case "an unmarked database with no Atlas leftovers" ""
run_script 0
expect "and it names why it skipped" yes "$(said "skip: staging holds no Atlas leftovers")"
expect "and it takes no backup" no "$(backup_taken)"

new_case "the cutover state with empty tables" "$ATLAS"
run_script 0
expect "and it records the pre-state first" yes "$(said "pre-state: public.atlas_schema_revisions 9 rows")"
expect "and PostGIS's rows are recorded but are not business rows" yes "$(said "pre-state: public.spatial_ref_sys")"
expect "and it takes the backup branch" yes "$(backup_taken)"
expect "and the backup precedes the drop" "$(printf 'branches create\npsql neondb_owner -f')" "$(tail -2 "$CALL_LOG")"
expect "and the leftover table is gone" absent "$(relation public.bangumi)"
expect "and the Atlas ledger is gone" absent "$(relation public.atlas_schema_revisions)"
expect "and the migrator can build the chain" t "$(admin "$CASE_DB" "SELECT has_schema_privilege('migrator', 'public', 'CREATE')")"
# #1896: the chain's access migration grants the five service roles USAGE on `public`, and it runs
# as `migrator`. A GRANT by a role holding no grant option is not an error — it warns and grants
# nothing — so staging reached CD with `jobs_svc` and `readonly` still lacking USAGE. The `f` below
# is what rules out every membership that would answer this question for jobs_svc anyway, Neon's
# `neon_superuser` and `pg_read_all_data` among them: it holds none, so only the re-grant moves it.
expect "and jobs_svc reaches the schema by no other path" f "$(admin "$CASE_DB" "SELECT has_schema_privilege('jobs_svc', 'public', 'USAGE')")"
expect "and the migrator re-grants with no superuser to fall back on" off "$(as_migrator "SELECT current_setting('is_superuser')")"
expect "and the migrator can pass USAGE on, as the chain does" t "$(as_migrator "GRANT USAGE ON SCHEMA public TO jobs_svc; SELECT has_schema_privilege('jobs_svc', 'public', 'USAGE')")"

new_case "the cutover state with a business row" "$ATLAS INSERT INTO public.bangumi VALUES ('real');"
run_script 1
expect "and it names the table holding rows" yes "$(said "refusing reset: business rows in public.bangumi")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

new_case "the cutover state with rows only in approved tables" "$ATLAS $APPROVED"
run_script 0
expect "and it records the approved rows first" yes "$(said "pre-state: public.sessions 1 rows")"
expect "and it takes the backup branch" yes "$(backup_taken)"
expect "and the approved table is gone" absent "$(relation public.sessions)"

new_case "the cutover state with a row beside the approved ones" "$ATLAS $APPROVED INSERT INTO public.points VALUES ('real');"
run_script 1
expect "and it names only the table the record does not" yes "$(said "refusing reset: business rows in public.points, which")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and nothing is dropped" sessions "$(relation public.sessions)"

new_case "a database the read cannot reach" ""
CASE_DB="reset_case_missing"
run_script 1
expect "and it refuses to guess" yes "$(said "cannot confirm staging state")"
expect "and it takes no backup" no "$(backup_taken)"

# The marker's cases and the half-reset's, in this shell and against the same container.
# shellcheck source=infra/database-access/reset-staging-baseline.marker-cases.sh
. "$(dirname "${BASH_SOURCE[0]}")/reset-staging-baseline.marker-cases.sh"
# shellcheck source=infra/database-access/reset-staging-baseline.half-reset-cases.sh
. "$(dirname "${BASH_SOURCE[0]}")/reset-staging-baseline.half-reset-cases.sh"

report_suite "reset-staging-baseline"
