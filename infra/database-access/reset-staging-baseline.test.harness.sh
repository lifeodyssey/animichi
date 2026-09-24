#!/usr/bin/env bash
# The disposable PostgreSQL the reset-staging-baseline behaviour tests run each case against
# (#1625). Source it, call `new_case <label> <seed SQL>` and `run_script <want-exit>`, and read
# the outcome back with `expect` and the observations below. One container serves the whole run,
# each case gets a database of its own, and `npx neonctl` is stubbed so the branch calls are
# recorded instead of reaching the Neon API. The cases, the fixtures and the assertions belong
# to the test file; what it takes a database, a container and a stub to offer it is here.
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
# The roles the reset's grant chain runs through, as staging holds them (#1896, #1949).
# `neondb_owner` connects for the reset and so owns the database and the `public` it recreates —
# and it is no superuser: staging's reset died at the marker drop with "must be owner of table
# marker" (2026-09-24, #1949), and a superuser here would paper that over. Neon's
# `neon_superuser` is modelled by `pg_read_all_data`, the only part of it the reset uses — it
# reads the chain's rows and drops nothing it does not own. `migrator` owns the chain's schema
# and logs in, as the migrator Worker does, and carries no membership: it re-grants on the
# schema's grant option alone. `jobs_svc` — one of the two service roles staging reached CD
# without USAGE for — must have no path to the schema but that re-grant.
admin postgres "CREATE ROLE neondb_owner LOGIN PASSWORD 'gate'" >/dev/null
admin postgres "GRANT pg_read_all_data TO neondb_owner" >/dev/null
admin postgres "CREATE ROLE migrator LOGIN PASSWORD 'gate'" >/dev/null
admin postgres "CREATE ROLE jobs_svc NOLOGIN" >/dev/null

mkdir -p "$WORK/bin"
cat > "$WORK/bin/npx" <<'STUB'
#!/usr/bin/env bash
# `npx --yes neonctl@3.6.0 <command> …`: psql reaches the case's database as `--role-name`, branch
# calls are recorded, and the branch list answers BRANCH_LIST, by default that no backup exists
# yet. Taking a backup also records whether the marker schema was still there for it to copy.
set -euo pipefail
shift 2
if [ "$1" = psql ]; then
  role=""; prev=""
  while [ "$1" != "--" ]; do [ "$prev" != "--role-name" ] || role="$1"; prev="$1"; shift; done
  shift
  case " $* " in *" -f "*) echo "psql $role -f" ;; *) echo "psql $role" ;; esac >> "${CALL_LOG:?}"
  # The half-reset case (#1949) fails the owner's reset step once: the flag beside the call log
  # names the run whose second transaction dies after the migrator's drop has committed.
  if [ -f "${CALL_LOG:?}.fail-owner" ] && [ "$role" = neondb_owner ] && [[ " $* " == *" -1 "* ]]; then
    rm -f "$CALL_LOG.fail-owner"
    echo "neonctl: the owner's reset step fails, as the half-reset case requires" >&2
    exit 3
  fi
  # neonctl announces every psql connection on stderr (#1793) — "INFO: Connecting to the
  # database using psql..." — and the reset script's reads swallow stderr, so the rehearsal
  # reads back the real shape: diagnostic ahead of the rows, on every call.
  printf 'INFO: Connecting to the database using psql...\n' >&2
  # The role is who psql connects as, not a label on the call log: `public` belongs to whoever
  # recreates it, and what that owner grants the migrator is this rehearsal's subject (#1896).
  PGPASSWORD=gate exec psql -h 127.0.0.1 -p "${PORT:?}" -U "${role:?}" -d "${CASE_DB:?}" "$@"
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
  # OWNER neondb_owner: the database owner owns `public` (pg_database_owner), so the reset's
  # drop-and-recreate of it runs as its owner, as staging's does (#1949). The chain's migrator
  # holds CREATE on the database — it created prisma_contract itself — so the seeds can make the
  # schema under SET ROLE migrator.
  admin postgres "CREATE DATABASE $CASE_DB OWNER neondb_owner TEMPLATE template0" >/dev/null
  admin postgres "GRANT CREATE ON DATABASE $CASE_DB TO migrator" >/dev/null
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
marker_tables() { admin "$CASE_DB" "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'prisma_contract'"; }
owner_of() { admin "$CASE_DB" "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = '$1'"; }
table_owner() { admin "$CASE_DB" "SELECT tableowner FROM pg_tables WHERE schemaname = '$1' AND tablename = '$2'"; }
public_table_count() { admin "$CASE_DB" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"; }
backups_taken() { grep -cx "branches create" "$CALL_LOG" || true; }
# The seat the chain's access migration runs its grants from: `migrator`, with whatever the reset
# left it and nothing else. From a superuser session the grant below would carry whatever the reset
# had granted or not, and the case would stop proving anything (#1896).
as_migrator() { admin "$CASE_DB" "SET ROLE migrator; $1"; }

# `expect` is the only writer of the tally, so the verdict it adds up is this file's to give —
# the same seat scripts/delivery/schema-preflight-testbed.sh reports its own suites from.
report_suite() { # report_suite <name> — the sourcing test file's verdict and exit status
  [ "$failures" -ne 0 ] || { echo "All $1 tests passed."; return 0; }
  echo "$failures $1 test(s) failed." >&2
  exit 1
}
