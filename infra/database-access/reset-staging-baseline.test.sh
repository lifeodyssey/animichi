#!/usr/bin/env bash
# Behaviour tests for reset-staging-baseline.sh, the one step of CD's staging job that drops
# anything (#1625). CD runs it on every staging deploy, so its own gate is what keeps it from
# destroying a database it was never approved to rebuild:
#
#   app marker present                          -> named no-op, exit 0
#   no marker, no Atlas leftovers               -> named no-op, exit 0
#   no marker, leftovers, no business rows      -> pre-state, backup branch, rebuild
#   no marker, leftovers, business rows         -> named refusal, exit 1, nothing touched
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
# recorded, and the branch list answers that no backup exists yet.
set -euo pipefail
shift 2
if [ "$1" = psql ]; then
  role=""; prev=""
  while [ "$1" != "--" ]; do [ "$prev" != "--role-name" ] || role="$1"; prev="$1"; shift; done
  shift
  case " $* " in *" -f "*) echo "psql $role -f" ;; *) echo "psql $role" ;; esac >> "${CALL_LOG:?}"
  PGPASSWORD=gate exec psql -h 127.0.0.1 -p "${PORT:?}" -U postgres -d "${CASE_DB:?}" "$@"
fi
echo "branches $2" >> "${CALL_LOG:?}"
[ "$2" != list ] || echo '[]'
STUB
chmod +x "$WORK/bin/npx"

# new_case <label> <seed SQL>: a database of its own, seeded, and the call log emptied.
new_case() {
  LABEL="$1"
  case_number=$((case_number + 1))
  CASE_DB="reset_case_$case_number"
  export CASE_DB CALL_LOG="$WORK/calls-$case_number"
  : > "$CALL_LOG"
  admin postgres "CREATE DATABASE $CASE_DB TEMPLATE template1" >/dev/null
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

MARKER="CREATE SCHEMA prisma_contract;
  CREATE TABLE prisma_contract.marker (space text PRIMARY KEY, core_hash text NOT NULL);
  INSERT INTO prisma_contract.marker VALUES ('app', repeat('a', 64));"
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

new_case "a database the read cannot reach" ""
CASE_DB="reset_case_missing"
run_script 1
expect "and it refuses to guess" yes "$(said "cannot confirm staging state")"
expect "and it takes no backup" no "$(backup_taken)"

[ "$failures" -eq 0 ] || { echo "$failures reset-staging-baseline test(s) failed." >&2; exit 1; }
echo "All reset-staging-baseline tests passed."
