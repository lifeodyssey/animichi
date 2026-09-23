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
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/infra/database-access/reset-staging-baseline.sh"
# shellcheck source=packages/test-postgres/postgres-image.env
. "$ROOT/packages/test-postgres/postgres-image.env"
command -v docker >/dev/null || { echo "reset-staging-baseline.test: docker is required" >&2; exit 1; }
command -v psql >/dev/null || { echo "reset-staging-baseline.test: psql is required" >&2; exit 1; }
docker image inspect "$TEST_POSTGRES_IMAGE" >/dev/null 2>&1 || {
  echo "reset-staging-baseline.test: build $TEST_POSTGRES_IMAGE first (packages/test-postgres/postgres-image.env)" >&2
  exit 1
}

WORK="$(mktemp -d)"
cid=""
trap 'test -z "$cid" || docker rm -f "$cid" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
failures=0
case_number=0
OUT=""

cid="$(docker run -d -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=postgres -p 127.0.0.1::5432 "$TEST_POSTGRES_IMAGE")"
PORT="$(docker port "$cid" 5432/tcp | sed 's/.*://')"
export PORT
for _ in $(seq 1 60); do
  docker exec "$cid" pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1 && break
  sleep 1
done

admin() { PGPASSWORD=gate psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -qtAc "$2"; }
admin postgres "CREATE ROLE migrator NOLOGIN" >/dev/null

mkdir -p "$WORK/bin"
cat > "$WORK/bin/npx" <<'STUB'
#!/usr/bin/env bash
# `npx --yes neonctl@3.6.0 <command> …`: psql reaches the case's database, branch calls are
# recorded, and the branch list answers BRANCH_LIST, by default that no backup exists yet. Taking a
# backup also records whether the marker schema was still there for it to copy.
set -euo pipefail
shift 2
if [ "$1" = psql ]; then
  role=""; prev=""
  while [ "$1" != "--" ]; do [ "$prev" != "--role-name" ] || role="$1"; prev="$1"; shift; done
  shift
  case " $* " in *" -f "*) echo "psql $role -f" ;; *) echo "psql $role" ;; esac >> "${CALL_LOG:?}"
  # neonctl announces every psql connection on stderr (#1793) — "INFO: Connecting to the
  # database using psql..." — and the reset script's reads swallow stderr, so the rehearsal
  # reads back the real shape: diagnostic ahead of the rows, on every call.
  printf 'INFO: Connecting to the database using psql...\n' >&2
  PGPASSWORD=gate exec psql -h 127.0.0.1 -p "${PORT:?}" -U postgres -d "${CASE_DB:?}" "$@"
fi
echo "branches $2" >> "${CALL_LOG:?}"
[ "$2" != create ] || PGPASSWORD=gate psql -h 127.0.0.1 -p "${PORT:?}" -U postgres -d "${CASE_DB:?}" -qtAc \
  "SELECT coalesce(to_regnamespace('prisma_contract')::text, 'absent')" > "$CALL_LOG.backup-saw"
[ "$2" != list ] || echo "${BRANCH_LIST:-[]}"
STUB
chmod +x "$WORK/bin/npx"

# new_case <label> <seed SQL>: a database of its own, seeded, and the call log emptied.
new_case() {
  LABEL="$1"
  case_number=$((case_number + 1))
  CASE_DB="reset_case_$case_number"
  export CASE_DB CALL_LOG="$WORK/calls-$case_number"
  : > "$CALL_LOG"
  # template0, not template1: the image's preloaded workers can still hold template1 here (#1890).
  admin postgres "CREATE DATABASE $CASE_DB TEMPLATE template0" >/dev/null
  [ -z "$2" ] || admin "$CASE_DB" "$2" >/dev/null
}

run_script() { # run_script <want-exit>
  local rc=0
  OUT="$(PATH="$WORK/bin:$PATH" NEON_API_KEY=stub-neon-key bash "$SCRIPT" 2>&1)" || rc=$?
  expect "$LABEL exits $1" "$1" "$rc"
}

expect() { # expect <label> <want> <got>
  if [ "$2" = "$3" ]; then printf 'PASS %s\n' "$1"; return; fi
  failures=$((failures + 1))
  printf 'FAIL %s: want [%s] got [%s]\n%s\n' "$1" "$2" "$3" "$OUT"
}

said() { grep -qF -- "$1" <<<"$OUT" && echo yes || echo no; }
backup_taken() { grep -qx "branches create" "$CALL_LOG" && echo yes || echo no; }
relation() { admin "$CASE_DB" "SELECT coalesce(to_regclass('$1')::text, 'absent')"; }
marker_schema() { admin "$CASE_DB" "SELECT coalesce(to_regnamespace('prisma_contract')::text, 'absent')"; }

# Prisma 8's marker carries updated_at; the one staging held was written 2026-09-12 (#1781).
MARKER="CREATE SCHEMA prisma_contract;
  CREATE TABLE prisma_contract.marker (space text PRIMARY KEY, core_hash text NOT NULL,
    updated_at timestamptz NOT NULL);
  INSERT INTO prisma_contract.marker VALUES ('app', repeat('a', 64), '2026-09-12 06:49:00+00');"
# What staging carries (spec §2.6): PostGIS's own populated spatial_ref_sys, the Atlas ledger
# with its nine revisions, and the chain's tables, empty.
ATLAS="CREATE EXTENSION postgis;
  CREATE TABLE public.atlas_schema_revisions (version text PRIMARY KEY);
  INSERT INTO public.atlas_schema_revisions SELECT g::text FROM generate_series(1, 9) g;
  CREATE TABLE public.bangumi (id text PRIMARY KEY);
  CREATE TABLE public.points (id text PRIMARY KEY);"

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

new_case "the cutover state with a business row" "$ATLAS INSERT INTO public.bangumi VALUES ('real');"
run_script 1
expect "and it names the table holding rows" yes "$(said "refusing reset: business rows in public.bangumi")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

# #1781: a spike wrote the marker six days before the flip, and the Atlas chain's objects stayed.
new_case "a marker beside the Atlas ledger" "$MARKER $ATLAS"
run_script 1
expect "and it names the marker" yes "$(said "prisma_contract.marker space=app updated_at=2026-09-12T06:49:00Z")"
expect "and it counts what the Atlas chain left" yes "$(said "9 Atlas revisions, 3 tables in public")"
expect "and it points at the migrator's refusal" yes "$(said "atlas_leftovers_present")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

# The owner approved the rows staging held on 2026-09-18 by table (#1781).
APPROVED="CREATE TABLE public.sessions (id text); INSERT INTO public.sessions VALUES ('qa');
  CREATE TABLE public.ingest_jobs (id int); INSERT INTO public.ingest_jobs VALUES (276);"
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

# #1781: the owner's record names staging's stale marker, and the rebuild drops its schema itself.
# The cases seed the very marker the committed record names inside the three tables a real
# `prisma db migrate` writes (dumped from one on 2026-09-18), rows in each, as staging holds them.
RECORDED="$(grep -vE '^(#|$)' "$ROOT/infra/database-access/reset-staging-baseline.approved-marker")"
RECORDED_AT="${RECORDED##* updated_at=}"
recorded_marker() { # recorded_marker <interval added to the recorded instant>
  echo "CREATE SCHEMA prisma_contract;
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
      VALUES ('app', repeat('a', 64), repeat('b', 64), '$RECORDED_AT'::timestamptz + interval '$1');"
}
marker_tables() { admin "$CASE_DB" "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'prisma_contract'"; }
expect "the committed record names one app marker" "prisma_contract.marker space=app" "${RECORDED% updated_at=*}"

new_case "the marker the record names, beside the Atlas ledger" "$(recorded_marker '0') $ATLAS $APPROVED"
run_script 0
expect "and neonctl's connection diagnostic rode along, unread as data" yes "$(said "INFO: Connecting to the database using psql...")"
expect "and it quotes the record it acted on" yes "$(said "stale marker approved by $ROOT/infra/database-access/reset-staging-baseline.approved-marker: $RECORDED")"
expect "and it records the ledger it will drop" yes "$(said "pre-state: prisma_contract.ledger 2 rows")"
expect "and the contract it will drop" yes "$(said "pre-state: prisma_contract.contract 1 rows")"
expect "and it takes the backup branch" yes "$(backup_taken)"
expect "and the backup saw the marker schema" prisma_contract "$(cat "$CALL_LOG.backup-saw")"
expect "and the backup precedes the drop" "$(printf 'branches create\npsql neondb_owner -f')" "$(tail -2 "$CALL_LOG")"
expect "and the marker schema is gone, with its three tables" absent "$(marker_schema)"
expect "and the ledger's sequence went with it" absent "$(relation prisma_contract.ledger_id_seq)"
expect "and the Atlas ledger is gone" absent "$(relation public.atlas_schema_revisions)"
expect "and the leftover table is gone" absent "$(relation public.bangumi)"
expect "and the approved table is gone" absent "$(relation public.sessions)"
expect "and the migrator can build the chain" t "$(admin "$CASE_DB" "SELECT has_schema_privilege('migrator', 'public', 'CREATE')")"

new_case "a marker one microsecond after the one the record names" "$(recorded_marker '1 microsecond') $ATLAS"
run_script 1
expect "and it refuses as though there were no record" yes "$(said "refusing reset: a Prisma app marker stands beside the Atlas ledger")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and the marker schema stands, all three tables" contract,ledger,marker "$(marker_tables)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

new_case "the recorded marker, with a backup branch taken before it" "$(recorded_marker '0') $ATLAS"
BRANCH_LIST='[{"name":"staging-before-prisma-baseline","created_at":"2026-09-01T00:00:00Z"}]' run_script 1
expect "and it names the backup that cannot restore the marker" yes "$(said "was taken at 2026-09-01T00:00:00Z, before the prisma_contract writes it would have to restore")"
expect "and it takes no new backup" no "$(backup_taken)"
expect "and the marker schema stands" prisma_contract "$(marker_schema)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

# Every marker row is named or none is: a second space beside the recorded one is not approved.
new_case "a second space's marker beside the one the record names" "$(recorded_marker '0') $ATLAS
  INSERT INTO prisma_contract.marker VALUES ('geography', repeat('c', 64), repeat('d', 64), '$RECORDED_AT');"
run_script 1
expect "and it refuses as though there were no record" yes "$(said "refusing reset: a Prisma app marker stands beside the Atlas ledger")"
expect "and it names both rows" yes "$(said "space=app updated_at=$RECORDED_AT, prisma_contract.marker space=geography updated_at=$RECORDED_AT")"
expect "and it takes no backup" no "$(backup_taken)"

# The drop takes the ledger too, so a backup must post-date its last write, not only the marker's.
new_case "the recorded marker, with a backup branch taken before a later ledger write" "$(recorded_marker '0') $ATLAS
  INSERT INTO prisma_contract.ledger (created_at, space, migration_name) VALUES ('2026-09-13T00:00:00Z', 'app', 'late');"
BRANCH_LIST='[{"name":"staging-before-prisma-baseline","created_at":"2026-09-12T12:00:00Z"}]' run_script 1
expect "and it names the backup that cannot restore the ledger" yes "$(said "was taken at 2026-09-12T12:00:00Z, before the prisma_contract writes it would have to restore")"
expect "and the marker schema stands, all three tables" contract,ledger,marker "$(marker_tables)"

# The drop names three tables and no CASCADE: anything else in the schema is not approved, and
# Postgres refuses the schema drop, taking the whole transaction — `public` too — back with it.
new_case "the recorded marker, with a fourth table in its schema" "$(recorded_marker '0') $ATLAS
  CREATE TABLE prisma_contract.unrecorded (id int); INSERT INTO prisma_contract.unrecorded VALUES (1);"
run_script 3
expect "and Postgres names what else the schema holds" yes "$(said "cannot drop schema prisma_contract because other objects depend on it")"
expect "and the three tables are back" contract,ledger,marker,unrecorded "$(marker_tables)"
expect "and public is back too" bangumi "$(relation public.bangumi)"
expect "and so is the Atlas ledger" atlas_schema_revisions "$(relation public.atlas_schema_revisions)"

new_case "a database the read cannot reach" ""
CASE_DB="reset_case_missing"
run_script 1
expect "and it refuses to guess" yes "$(said "cannot confirm staging state")"
expect "and it takes no backup" no "$(backup_taken)"

[ "$failures" -eq 0 ] || { echo "$failures reset-staging-baseline test(s) failed." >&2; exit 1; }
echo "All reset-staging-baseline tests passed."
