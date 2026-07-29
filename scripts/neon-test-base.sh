#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly API_BASE="https://console.neon.tech/api/v2"
readonly PINNED_ATLAS_VERSION="0.30.0"
readonly REQUIRED_BRANCH_NAME="test-base"

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

safe_identifier() {
  [[ "$1" =~ ^[A-Za-z0-9_-]+$ ]]
}

safe_identity() {
  local requested_name="$1" expected_project="$2" expected_id="$3"
  local actual_project="$4" actual_id="$5" actual_name="$6"
  [[ "$requested_name" == "$REQUIRED_BRANCH_NAME" ]] &&
    [[ "$actual_project" == "$expected_project" ]] &&
    [[ "$actual_id" == "$expected_id" ]] &&
    [[ "$actual_name" == "$REQUIRED_BRANCH_NAME" ]]
}

self_test() {
  local cases actual expected failures=0
  cases=(
    'test-base|project-a|branch-a|project-a|branch-a|test-base|pass'
    'staging|project-a|branch-a|project-a|branch-a|test-base|fail'
    'test-base|project-a|branch-a|project-b|branch-a|test-base|fail'
    'test-base|project-a|branch-a|project-a|branch-b|test-base|fail'
    'test-base|project-a|branch-a|project-a|branch-a|staging|fail'
  )
  for case in "${cases[@]}"; do
    IFS='|' read -r name project id got_project got_id got_name expected <<<"$case"
    actual=fail
    safe_identity "$name" "$project" "$id" "$got_project" "$got_id" "$got_name" && actual=pass
    [[ "$actual" == "$expected" ]] || failures=$((failures + 1))
  done
  [[ "$failures" -eq 0 ]] || die "$failures safety-rail table tests failed"
  printf 'PASS safety-rail table tests\n  evidence: 5 identity cases matched expected outcomes\n'
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit 0
fi

readonly MODE="${1:-}"
readonly BRANCH_NAME="${2:-}"
[[ "$MODE" == "provision" || "$MODE" == "refresh" ]] ||
  die "usage: $0 {provision|refresh} test-base"
[[ "$BRANCH_NAME" == "$REQUIRED_BRANCH_NAME" ]] ||
  die "refusing branch name '$BRANCH_NAME'; only literal test-base is allowed"

: "${NEON_API_KEY:?NEON_API_KEY is required}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID is required}"
: "${ATLAS_VERSION:?ATLAS_VERSION is required and must equal ${PINNED_ATLAS_VERSION}}"
[[ "$ATLAS_VERSION" == "$PINNED_ATLAS_VERSION" ]] ||
  die "ATLAS_VERSION must equal the repository pin ${PINNED_ATLAS_VERSION}"
safe_identifier "$NEON_PROJECT_ID" || die "NEON_PROJECT_ID has an invalid format"

readonly DATABASE_NAME="neondb"
readonly DATABASE_ROLE="neondb_owner"

for command in atlas curl psql python3; do
  need_command "$command"
done

ATLAS_OUTPUT="$(atlas version 2>&1)" || die "unable to execute atlas version"
if [[ "$ATLAS_OUTPUT" =~ v?([0-9]+\.[0-9]+\.[0-9]+) ]]; then
  INSTALLED_ATLAS_VERSION="${BASH_REMATCH[1]}"
else
  die "unable to parse the installed Atlas version"
fi
[[ "$INSTALLED_ATLAS_VERSION" == "$PINNED_ATLAS_VERSION" ]] ||
  die "installed Atlas is ${INSTALLED_ATLAS_VERSION}; expected ${PINNED_ATLAS_VERSION}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly MIGRATIONS_DIR="$ROOT/db/migrations"
readonly SEED_FILE="$ROOT/apps/agent/agent/tests/fixtures/seed.sql"
[[ -d "$MIGRATIONS_DIR" ]] || die "migration directory not found"
[[ -f "$SEED_FILE" ]] || die "seed file not found"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
AUTH_HEADER_FILE="$TMP_DIR/neon-auth-header"
PGSERVICEFILE="$TMP_DIR/pg_service.conf"
PGPASSFILE="$TMP_DIR/pgpass"
printf 'Authorization: Bearer %s\n' "$NEON_API_KEY" >"$AUTH_HEADER_FILE"
: >"$PGSERVICEFILE"
: >"$PGPASSFILE"
chmod 600 "$AUTH_HEADER_FILE" "$PGSERVICEFILE" "$PGPASSFILE"
export PGSERVICEFILE PGPASSFILE

api_request() {
  local method="$1" path="$2" output="$3" body="${4:-}" status
  local args=(--silent --show-error --request "$method" --output "$output"
    --write-out '%{http_code}' --header "@${AUTH_HEADER_FILE}"
    --header 'Accept: application/json' --proto '=https' --tlsv1.2)
  [[ -z "$body" ]] || args+=(--header 'Content-Type: application/json' --data-binary "@$body")
  status="$(curl "${args[@]}" "${API_BASE}/${path}")" || die "Neon API transport failure"
  [[ "$status" =~ ^2[0-9][0-9]$ ]] || die "Neon API request failed with HTTP ${status}"
}

write_pg_service() {
  local dsn="$1" service="$2"
  SOURCE_DATABASE_URL="$dsn" python3 - "$service" "$PGSERVICEFILE" "$PGPASSFILE" <<'PY'
import os
import pathlib
import sys
import urllib.parse

service, service_path, pass_path = sys.argv[1:]
parsed = urllib.parse.urlparse(os.environ["SOURCE_DATABASE_URL"])
host = parsed.hostname or ""
port = parsed.port or 5432
database = urllib.parse.unquote(parsed.path.lstrip("/"))
user = urllib.parse.unquote(parsed.username or "")
password = urllib.parse.unquote(parsed.password or "")
query = urllib.parse.parse_qs(parsed.query)
sslmode = query.get("sslmode", ["require"])[0]
if not all((host, database, user, password)):
    raise SystemExit("database URI omitted a required connection field")
with pathlib.Path(service_path).open("a", encoding="utf-8") as config:
    config.write(
        f"[{service}]\nhost={host}\nport={port}\ndbname={database}\n"
        f"user={user}\nsslmode={sslmode}\n"
    )
escape = lambda value: value.replace("\\", "\\\\").replace(":", "\\:")
with pathlib.Path(pass_path).open("a", encoding="utf-8") as password_file:
    fields = (host, str(port), database, user, password)
    password_file.write(":".join(escape(value) for value in fields) + "\n")
PY
}

json_value() {
  python3 -c 'import json,sys
value=json.load(open(sys.argv[1], encoding="utf-8"))
for key in sys.argv[2].split("."):
    value=value[key]
print("" if value is None else value)' "$1" "$2"
}

resolve_named_branch() {
  python3 -c 'import json,sys
branches=[b for b in json.load(open(sys.argv[1], encoding="utf-8"))["branches"] if b["name"] == sys.argv[2]]
if len(branches) > 1: raise SystemExit("duplicate exact branch names")
if branches:
    b=branches[0]
    print("\t".join((b["id"], b["project_id"], b.get("parent_id") or "")))' "$1" "$2"
}

resolve_default_branch() {
  python3 -c 'import json,sys
branches=[b for b in json.load(open(sys.argv[1], encoding="utf-8"))["branches"] if b.get("default") is True]
if len(branches) != 1: raise SystemExit("expected exactly one default branch")
print(branches[0]["id"])' "$1"
}

PROJECT_JSON="$TMP_DIR/project.json"
BRANCHES_JSON="$TMP_DIR/branches.json"
DETAIL_JSON="$TMP_DIR/branch-detail.json"
CONNECTION_JSON="$TMP_DIR/connection.json"
MAINTENANCE_JSON="$TMP_DIR/maintenance-connection.json"
REQUEST_JSON="$TMP_DIR/create.json"
COMMAND_LOG="$TMP_DIR/command.log"

api_request GET "projects/${NEON_PROJECT_ID}" "$PROJECT_JSON"
API_PROJECT_ID="$(json_value "$PROJECT_JSON" project.id)"
[[ "$API_PROJECT_ID" == "$NEON_PROJECT_ID" ]] ||
  die "configured project id does not match the Neon API project"

api_request GET "projects/${NEON_PROJECT_ID}/branches?limit=100" "$BRANCHES_JSON"
DEFAULT_BRANCH_ID="$(resolve_default_branch "$BRANCHES_JSON")"
safe_identifier "$DEFAULT_BRANCH_ID" || die "default branch id has an invalid format"

BRANCH_RECORD="$(resolve_named_branch "$BRANCHES_JSON" "$BRANCH_NAME")"
if [[ -z "$BRANCH_RECORD" ]]; then
  [[ "$MODE" == "provision" ]] || die "test-base does not exist; refresh cannot create it"
  python3 -c 'import json,sys
json.dump({"branch":{"name":"test-base","parent_id":sys.argv[1]},
           "endpoints":[{"type":"read_write"}]}, open(sys.argv[2], "w", encoding="utf-8"))' \
    "$DEFAULT_BRANCH_ID" "$REQUEST_JSON"
  api_request POST "projects/${NEON_PROJECT_ID}/branches" "$TMP_DIR/create-response.json" "$REQUEST_JSON"
  for _ in {1..30}; do
    api_request GET "projects/${NEON_PROJECT_ID}/branches?limit=100" "$BRANCHES_JSON"
    BRANCH_RECORD="$(resolve_named_branch "$BRANCHES_JSON" "$BRANCH_NAME")"
    [[ -n "$BRANCH_RECORD" ]] && break
    sleep 2
  done
  [[ -n "$BRANCH_RECORD" ]] || die "created test-base was not observable within 60 seconds"
fi

IFS=$'\t' read -r BRANCH_ID BRANCH_PROJECT_ID BRANCH_PARENT_ID <<<"$BRANCH_RECORD"
safe_identifier "$BRANCH_ID" || die "resolved branch id has an invalid format"
[[ "$BRANCH_PROJECT_ID" == "$NEON_PROJECT_ID" ]] || die "resolved branch belongs to another project"
[[ "$BRANCH_PARENT_ID" == "$DEFAULT_BRANCH_ID" ]] || die "test-base is not parented to the default branch"

# Re-fetch by ID. This check is deliberately adjacent to the first possible DDL.
api_request GET "projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}" "$DETAIL_JSON"
DETAIL_ID="$(json_value "$DETAIL_JSON" branch.id)"
DETAIL_NAME="$(json_value "$DETAIL_JSON" branch.name)"
DETAIL_PROJECT_ID="$(json_value "$DETAIL_JSON" branch.project_id)"
safe_identity "$BRANCH_NAME" "$NEON_PROJECT_ID" "$BRANCH_ID" \
  "$DETAIL_PROJECT_ID" "$DETAIL_ID" "$DETAIL_NAME" ||
  die "name-on-id/project re-verification failed before DDL"

api_request GET "projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${BRANCH_ID}&database_name=${DATABASE_NAME}&role_name=${DATABASE_ROLE}&pooled=false" "$CONNECTION_JSON"
DATABASE_URL="$(json_value "$CONNECTION_JSON" uri)"
[[ "$DATABASE_URL" == postgres://* || "$DATABASE_URL" == postgresql://* ]] ||
  die "Neon API returned an invalid database connection URI"
DATABASE_HOST="$(DATABASE_URL="$DATABASE_URL" python3 -c 'import os,urllib.parse
print(urllib.parse.urlparse(os.environ["DATABASE_URL"]).hostname or "unknown")')"
readonly DATABASE_URL DATABASE_HOST
write_pg_service "$DATABASE_URL" database

if [[ "$MODE" == "provision" ]]; then
  api_request GET "projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${BRANCH_ID}&database_name=postgres&role_name=${DATABASE_ROLE}&pooled=false" "$MAINTENANCE_JSON"
  MAINTENANCE_URL="$(json_value "$MAINTENANCE_JSON" uri)"
  [[ "$MAINTENANCE_URL" == postgres://* || "$MAINTENANCE_URL" == postgresql://* ]] ||
    die "Neon API returned an invalid maintenance connection URI"
  readonly MAINTENANCE_URL
  write_pg_service "$MAINTENANCE_URL" maintenance
fi

run_db_step() {
  local label="$1"
  shift
  if "$@" >"$COMMAND_LOG" 2>&1; then
    printf 'PASS %s\n  evidence: database host %s\n' "$label" "$DATABASE_HOST"
    return
  fi
  die "${label} failed for database host ${DATABASE_HOST}; command output withheld to protect credentials"
}

cd "$ROOT"
if [[ "$MODE" == "provision" ]]; then
  run_db_step "guarded target-database wipe" psql -X --set=ON_ERROR_STOP=1 "service=maintenance" \
    --command="DROP DATABASE IF EXISTS \"${DATABASE_NAME}\" WITH (FORCE);"
  run_db_step "deterministic empty database create" psql -X --set=ON_ERROR_STOP=1 "service=maintenance" \
    --command="CREATE DATABASE \"${DATABASE_NAME}\" OWNER \"${DATABASE_ROLE}\";"
fi
# `run_db_step` is a shell function, so a `VAR=… run_db_step …` prefix assigns in
# the current shell rather than a subprocess — which aborts on the readonly
# DATABASE_URL above, and would silently leak PYTHONPATH into every later step.
# `env` keeps the assignments scoped to the python process.
run_db_step "Atlas ${PINNED_ATLAS_VERSION} migration apply" \
  env PYTHONPATH="$ROOT/apps/agent" DATABASE_URL="$DATABASE_URL" ATLAS_VERSION="$ATLAS_VERSION" \
  python3 -m agent.tests.atlas_helper apply
run_db_step "idempotent fixture seed" psql -X --set=ON_ERROR_STOP=1 "service=database" \
  --file="$SEED_FILE"
run_db_step "service-role membership grant" psql -X --set=ON_ERROR_STOP=1 "service=database" \
  --command='GRANT catalog_svc, agent_svc TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;'

printf 'PASS test-base %s complete\n  evidence: verified branch name %s on database host %s\n' \
  "$MODE" "$BRANCH_NAME" "$DATABASE_HOST"
