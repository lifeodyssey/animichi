#!/usr/bin/env bash
# Verify one environment's promoted catalog: `bangumi`, `points` and
# `ingest_jobs` must exist once the selected migration chain has applied
# (#1230 Phase 1, whose observed fact was a production branch holding none of
# them). CD runs this immediately after the apply, so a promotion that leaves
# the catalog incomplete fails the release rather than the next reader.
#
# CI holds no database credential — decision 6 of the CD redesign — so it
# cannot read the target itself. The migrator holds the DSN and answers a signed
# read-only question about the schema it just migrated; this script asks it and
# fails when the answer names a missing table.
#
# Usage: MIGRATOR_URL=… verify-catalog-schema.sh <environment>
set -euo pipefail

TARGET_ENVIRONMENT="${1:?target environment required}"
case "$TARGET_ENVIRONMENT" in
  staging|production) ;;
  *) echo "::error title=catalog-schema::unknown environment $TARGET_ENVIRONMENT"; exit 1 ;;
esac
# The three tables this check owns, named here as well as in the migrator: a
# probe that quietly stopped reporting one would otherwise satisfy an assertion
# written over whatever it still reports.
REQUIRED_TABLES="bangumi points ingest_jobs"
RESPONSE="${RUNNER_TEMP:-/tmp}/catalog-schema-$TARGET_ENVIRONMENT.json"

fail() { echo "::error title=catalog-schema::$*"; exit 1; }
required() { [ -n "${!1:-}" ] || fail "$1 is required for $TARGET_ENVIRONMENT"; }

# The OIDC request token and the minted token both ride on these calls, so the
# transport is pinned to TLS: curl refuses a plain-http URL — and a redirect
# that leaves https — instead of sending a credential over it (CWE-319).
https_only() { curl --proto '=https' --proto-redir '=https' "$@"; }

# `audience` scopes the token to the migrator alone, as the migration call does.
oidc_token() {
  required ACTIONS_ID_TOKEN_REQUEST_URL
  required ACTIONS_ID_TOKEN_REQUEST_TOKEN
  https_only -sSfL -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=animichi:github-actions:migrator" | jq -r .value
}

# What the target lacks, per the migrator's answer; empty means the schema is
# whole. An unreadable answer is "every table is unproven", never "none missing".
missing_tables() {
  jq -r --arg names "$REQUIRED_TABLES" \
    '(.tables // {}) as $tables | ($names | split(" ")) | map(select($tables[.] != true)) | join(" ")' \
    "$RESPONSE" 2> /dev/null || echo "$REQUIRED_TABLES"
}

# The endpoint's failures are stable codes, never driver text: print those two
# fields rather than a body that could carry something else (#1216's lesson).
answer() { jq -c '{error: (.error // null), missing: (.missing // null)}' "$RESPONSE" 2> /dev/null || echo unreadable; }

main() {
  required MIGRATOR_URL
  [[ "$MIGRATOR_URL" == https://* ]] || fail "migrator must use HTTPS"
  local token code missing
  token="$(oidc_token)"
  code="$(https_only -sS -o "$RESPONSE" -w '%{http_code}' --max-time 60 \
    -H "Authorization: Bearer $token" "${MIGRATOR_URL%/}/catalog-schema")"
  # 422 is this endpoint's "the schema is incomplete" answer, and its body names
  # what is missing; every other non-200 is a failure to answer at all, reported
  # with its own stable code rather than as a claim about the schema.
  case "$code" in
    200) ;;
    422) fail "$TARGET_ENVIRONMENT is missing catalog table(s): $(missing_tables)" ;;
    *) fail "migrator answered HTTP $code for the $TARGET_ENVIRONMENT catalog: $(answer)" ;;
  esac
  missing="$(missing_tables)"
  [ -z "$missing" ] || fail "$TARGET_ENVIRONMENT is missing catalog table(s): $missing"
  echo "catalog schema verified in $TARGET_ENVIRONMENT: $REQUIRED_TABLES"
}

main
