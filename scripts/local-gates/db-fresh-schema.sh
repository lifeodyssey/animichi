#!/usr/bin/env bash
# Disposable fresh-schema apply (#1003, AC3/AC6).
#
# Boots a throwaway postgres container (the same offline postgis+pgvector
# image every database-backed suite uses), applies the full migration chain to
# the pristine schema, and tears the container down. Never points the chain at
# shared Neon. The image build command is the documented prerequisite.
#
# The image pre-initialises POSTGRES_DB (here the `postgres` admin database)
# with its own extension set — postgis, vector, documentdb and the objects those
# bring — so the chain must never be applied to that database: a clean-schema
# test needs a database created from pristine template1. The gate waits for the admin database, creates the target `gate`
# database from template1, creates the five cluster-global service roles the
# chain's grant matrix prechecks, and only then applies the chain to `gate`.
#
# AC6: this is a REQUIRED local Docker-backed gate — it fails closed with an
# actionable message when Docker (or the offline image) is unavailable; it
# never silently skips.
#
# Behavioral tests: db-fresh-schema.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the fresh-schema gate but is not installed:" >&2
  echo "  install Docker Desktop (https://docs.docker.com/desktop/) or colima (brew install colima && colima start)" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the daemon is not running:" >&2
  echo "  start Docker Desktop or run 'colima start', then retry the push." >&2
  exit 1
fi

# The tag is declared once, in the shared test data plane (#1326): workers/
# catalog and workers/edge boot the same image from TypeScript, and a copy of
# the tag here is a copy that drifts without failing. That file is bash, and it
# is read only once the two Docker checks above have passed — they run on a
# PATH that may not even have `dirname`, so $ROOT is only trustworthy here.
# shellcheck source=../../packages/test-postgres/postgres-image.env
. "$ROOT/packages/test-postgres/postgres-image.env"
IMAGE="$TEST_POSTGRES_IMAGE"
BUILD_CMD="docker build -f packages/test-postgres/Dockerfile -t $IMAGE ."

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "missing offline test image; build it first (one-time, needs network):" >&2
  echo "  $BUILD_CMD" >&2
  exit 1
fi

cid=""
trap 'test -z "$cid" || docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
wait_for_tcp() {
  local database="$1"
  for _ in $(seq 1 30); do
    docker exec "$cid" pg_isready -h 127.0.0.1 -p 5432 -U postgres -d "$database" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "fresh-schema: PostgreSQL did not become ready over TCP for $database" >&2
  docker logs --tail 50 "$cid" >&2 || true
  return 1
}

# `CREATE DATABASE ... TEMPLATE template1` carries a SECOND precondition beyond
# server readiness: no other session may be attached to template1. The image
# preloads background workers that open a connection into every database the
# cluster will let them into, template1 among them, on the postmaster's own
# schedule — so readiness cannot establish this and a poll of pg_stat_activity
# cannot either. The server makes the check itself, under a lock, at the moment
# of the create; reissuing that statement until it stops refusing for this one
# reason is the only form that holds (#1874).
TEMPLATE1_IN_USE='is being accessed by other users'
TEMPLATE1_EXCLUSIVITY_TRIES=30

# The statement itself: its output discarded, its refusal handed back to be read.
issue_gate_create() {
  { docker exec "$cid" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c 'CREATE DATABASE gate TEMPLATE template1' >/dev/null; } 2>&1
}

template1_is_in_use() { printf '%s\n' "$1" | grep -qF -- "$TEMPLATE1_IN_USE"; }

# A refusal that is not the exclusivity conflict is a real failure: say what
# psql said and stop, because reissuing it would only repeat the same error.
report_create_refused() {
  echo "fresh-schema: failed to create the pristine target database from template1" >&2
  printf '%s\n' "$1" >&2
}

# The bound is what keeps this a gate: naming the precondition that was not met,
# and who was holding it, is what the next reader of a red run needs.
report_template1_never_free() {
  echo "fresh-schema: template1 never came free — CREATE DATABASE gate TEMPLATE template1" >&2
  echo "  requires template1 to have no other session attached. Still attached:" >&2
  docker exec "$cid" psql -U postgres -d postgres \
    -c "SELECT pid, backend_type, application_name, state, query FROM pg_stat_activity WHERE datname = 'template1'" >&2 || true
  return 1
}

# `refusal` is assigned on its own line: `local refusal="$(...)"` would report
# the declaration's exit status, not the create's.
create_gate_from_template1() {
  local refusal
  for _ in $(seq 1 "$TEMPLATE1_EXCLUSIVITY_TRIES"); do
    refusal="$(issue_gate_create)" && return 0
    template1_is_in_use "$refusal" || { report_create_refused "$refusal"; return 1; }
    sleep 1
  done
  report_template1_never_free
}

# POSTGRES_DB names the ADMIN database. The target `gate` database is created
# from pristine template1 below; the chain never touches this admin database.
cid="$(docker run -d -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=postgres -p 127.0.0.1::5432 "$IMAGE")"
port="$(docker port "$cid" 5432/tcp | sed 's/.*://')"
# The image entrypoint starts a temporary Unix-socket-only server while it
# runs init scripts. A socket-only pg_isready can therefore report ready
# before the final TCP server is listening, which lets the apply race the restart
# and fail with "connection reset by peer". Probe TCP explicitly so this gate
# only proceeds once the final server is accepting host connections.
wait_for_tcp postgres

# Create the pristine target database from template1 — the clean-schema recipe
# every database-backed arm shares, and which packages/test-postgres/src/
# clean-database.ts names this gate as the reference for. The image-
# preinitialised admin database is never a clean schema. Fail closed if the
# create does not complete.
create_gate_from_template1 || exit 1

# Creating a database is asynchronous from the client's perspective. Probe
# the target over TCP as well, so the chain never connects during that transition.
wait_for_tcp gate

# The five data-plane service roles are cluster-global, and the chain's grant matrix PRECHECKS
# them rather than creating them (spec §4.8.5 gives role DDL to Pulumi, and a throwaway
# container has no Pulumi). `packages/test-postgres` does the same for every suite.
for role in agent_svc catalog_svc jobs_svc readonly users_svc; do
  docker exec "$cid" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE \"$role\" NOLOGIN" >/dev/null
done

DO_NOT_TRACK=1 pnpm --filter @animichi/pi-session-neon exec prisma db migrate \
  --db "postgresql://postgres:gate@127.0.0.1:${port}/gate?sslmode=disable"
echo "fresh-schema apply: OK"
