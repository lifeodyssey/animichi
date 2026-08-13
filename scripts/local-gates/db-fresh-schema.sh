#!/usr/bin/env bash
# Disposable fresh-schema apply (#1003, AC3/AC6).
#
# Boots a throwaway postgres container (the same offline postgis+pgvector
# image the agent integration arm uses), applies the full migration chain to
# the pristine schema, and tears the container down. Never points atlas at
# shared Neon. The image build command is the documented prerequisite.
#
# The postgis image pre-initialises POSTGRES_DB (here the `postgres` admin
# database) with the tiger/topology objects, so Atlas must never be applied
# to that database — a clean-schema test needs a database created from
# pristine template1, exactly as conftest_db.py does. The gate waits for the
# admin database, creates the target `gate` database from template1, and only
# then runs Atlas against `gate`.
#
# AC6: this is a REQUIRED local Docker-backed gate — it fails closed with an
# actionable message when Docker (or the offline image) is unavailable; it
# never silently skips.
#
# Behavioral tests: db-fresh-schema.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
IMAGE="animichi-test-postgres:18-3.6-pgvector-0.8.5"
BUILD_CMD="docker build -f apps/agent/docker/test-postgres/Dockerfile -t $IMAGE ."

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

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "missing offline test image; build it first (one-time, needs network):" >&2
  echo "  $BUILD_CMD" >&2
  exit 1
fi

cid=""
trap 'test -z "$cid" || docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
# POSTGRES_DB names the ADMIN database (the image pre-initialises it with the
# postgis/tiger/topology extensions). The target `gate` database is created
# from pristine template1 below; Atlas never touches this admin database.
cid="$(docker run -d -e POSTGRES_PASSWORD=gate -e POSTGRES_DB=postgres -p 127.0.0.1::5432 "$IMAGE")"
port="$(docker port "$cid" 5432/tcp | sed 's/.*://')"
for _ in $(seq 1 30); do
  docker exec "$cid" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break
  sleep 1
done

# Create the pristine target database from template1 (conftest_db.py's exact
# clean-schema semantics: the image-preinitialised database is never a clean
# schema). Fail closed if the create does not complete.
if ! docker exec "$cid" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE gate TEMPLATE template1' >/dev/null; then
  echo "fresh-schema: failed to create the pristine target database from template1" >&2
  exit 1
fi

set -f
atlas migrate apply --dir "file://migrations/neon" --url postgresql://postgres:gate@127.0.0.1:${port}/gate?sslmode=disable --revisions-schema public
set +f
echo "fresh-schema apply: OK"
