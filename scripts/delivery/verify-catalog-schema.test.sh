#!/usr/bin/env bash
# SUT: scripts/delivery/verify-catalog-schema.sh
# Behaviour tests for verify-catalog-schema.sh (#1230 Phase 1).
#
# The claim this script gates on is "these three tables exist in the
# environment that just migrated", and the failure that motivated it — a
# production branch with no catalog at all — passes every check written over
# the migration's own report. So the cases below drive the shipped script
# against a `curl` stub that answers with each shape the migrator can produce,
# and assert the exit code and the message that NAMES the missing table. The
# protocol refusal uses the real curl, as migrate-through-worker.test.sh does.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/delivery/verify-catalog-schema.sh"
REAL_CURL="$(command -v curl)"
export REAL_CURL
WORKSPACE=""

fail() { echo "FAIL: $*" >&2; exit 1; }

# `curl` reaches two endpoints: the OIDC mint, and /catalog-schema with `-o`
# which receives the canned body below while stdout carries the canned code.
make_curl_stub() {
  cat > "$WORKSPACE/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
# The transport decision is NOT faked: the real curl is handed this call's own
# argv and only its verdict is honoured, so a plain-http URL is still refused
# with curl's own words. Any other exit means curl would carry this call.
verdict=0
refusal="$("${REAL_CURL:?}" "$@" 2>&1 >/dev/null)" || verdict=$?
if [ "$verdict" = 1 ]; then
  echo "$refusal" >&2
  exit 1
fi
case "$args" in
  *"/catalog-schema"*)
    echo catalog-schema >> "${CALL_LOG:?}"
    out="${args#*-o }"; out="${out%% *}"
    printf '%s' "${STUB_BODY:?}" > "$out"
    printf '%s' "${STUB_CODE:?}"
    ;;
  *)
    echo token >> "${CALL_LOG:?}"
    echo '{"value":"oidc-token"}'
    ;;
esac
STUB
  chmod +x "$WORKSPACE/bin/curl"
}

setup() {
  WORKSPACE="$(mktemp -d)"
  mkdir -p "$WORKSPACE/bin"
  make_curl_stub
  export PATH="$WORKSPACE/bin:$PATH"
  export CALL_LOG="$WORKSPACE/calls" RUNNER_TEMP="$WORKSPACE"
  export MIGRATOR_URL="https://127.0.0.1:1"
  export ACTIONS_ID_TOKEN_REQUEST_URL="https://127.0.0.1:1/token?a=1"
  export ACTIONS_ID_TOKEN_REQUEST_TOKEN="request-token"
  export STUB_CODE=200 STUB_BODY='{"status":"ok","tables":{"bangumi":true,"points":true,"ingest_jobs":true},"missing":[]}'
  : > "$CALL_LOG"
}

teardown() { rm -rf "$WORKSPACE"; }

run_script() { bash "$SCRIPT" "${1:-production}" 2>&1; }

calls() { tr '\n' ' ' < "$CALL_LOG"; }

case_green_when_all_three_tables_exist() {
  setup
  run_script > "$WORKSPACE/out" || fail "a complete catalog must pass"
  grep -q "catalog schema verified in production: bangumi points ingest_jobs" "$WORKSPACE/out" || fail "wrong message: $(cat "$WORKSPACE/out")"
  [ "$(calls)" = "token catalog-schema " ] || fail "wrong calls: $(calls)"
  teardown
}

case_names_a_table_the_migrator_reports_false() {
  setup
  STUB_CODE=422 STUB_BODY='{"status":"incomplete","tables":{"bangumi":true,"points":false,"ingest_jobs":true},"missing":["points"]}'
  run_script > "$WORKSPACE/out" && fail "a missing table must fail the release"
  grep -q "production is missing catalog table(s): points" "$WORKSPACE/out" || fail "must name points: $(cat "$WORKSPACE/out")"
  teardown
}

# The probe could drift and stop reporting a table at all; the absence has to
# read as missing, not as "not false".
case_names_a_table_the_migrator_never_reports() {
  setup
  STUB_BODY='{"status":"ok","tables":{"bangumi":true},"missing":[]}'
  run_script > "$WORKSPACE/out" && fail "an unreported table must fail the release"
  grep -q "is missing catalog table(s): points ingest_jobs" "$WORKSPACE/out" || fail "must name both: $(cat "$WORKSPACE/out")"
  teardown
}

case_fails_on_an_unreadable_answer() {
  setup
  STUB_BODY='not json'
  run_script > "$WORKSPACE/out" && fail "an unreadable answer must fail the release"
  grep -q "is missing catalog table(s): bangumi points ingest_jobs" "$WORKSPACE/out" || fail "must claim nothing: $(cat "$WORKSPACE/out")"
  teardown
}

case_reports_a_refusal_code() {
  setup
  STUB_CODE=503 STUB_BODY='{"error":"schema_probe_unavailable"}'
  run_script > "$WORKSPACE/out" && fail "an unavailable probe must fail the release"
  grep -q "migrator answered HTTP 503" "$WORKSPACE/out" || fail "must name the status: $(cat "$WORKSPACE/out")"
  grep -q "schema_probe_unavailable" "$WORKSPACE/out" || fail "must carry the stable code: $(cat "$WORKSPACE/out")"
  teardown
}

# A 200 that claims ok while its table map is short must still go red: the check
# is the three names, not the endpoint's own verdict.
case_ignores_an_ok_status_over_an_incomplete_map() {
  setup
  STUB_CODE=200 STUB_BODY='{"status":"ok","tables":{"bangumi":true,"points":false,"ingest_jobs":true},"missing":[]}'
  run_script > "$WORKSPACE/out" && fail "a partial catalog must fail the release"
  grep -q "is missing catalog table(s): points" "$WORKSPACE/out" || fail "must name points: $(cat "$WORKSPACE/out")"
  teardown
}

case_refuses_an_unknown_environment() {
  setup
  run_script preproduction > "$WORKSPACE/out" && fail "an unknown environment must be refused"
  grep -q "unknown environment preproduction" "$WORKSPACE/out" || fail "wrong message: $(cat "$WORKSPACE/out")"
  [ -z "$(calls)" ] || fail "nothing may be dialled: $(calls)"
  teardown
}

# CWE-319: the minted OIDC token rides this call, so a plain-http migrator URL
# must stop the release before the token is even minted.
case_refuses_a_plaintext_migrator_url() {
  setup
  MIGRATOR_URL="http://127.0.0.1:1"
  run_script > "$WORKSPACE/out" && fail "a plain-http migrator must fail the release"
  grep -q "migrator must use HTTPS" "$WORKSPACE/out" || fail "wrong refusal: $(cat "$WORKSPACE/out")"
  [ -z "$(calls)" ] || fail "nothing may be dialled after the refusal: $(calls)"
  teardown
}

# The same property on the other leg: the request token is itself a credential,
# so a plain-http token endpoint is refused by the SHIPPED curl with its own
# words, and the catalog is never asked.
case_refuses_a_plaintext_token_endpoint() {
  setup
  ACTIONS_ID_TOKEN_REQUEST_URL="http://127.0.0.1:1/token?a=1"
  run_script > "$WORKSPACE/out" && fail "a plain-http token endpoint must fail the release"
  grep -q 'Protocol "http"' "$WORKSPACE/out" || fail "wrong refusal: $(cat "$WORKSPACE/out")"
  grep -q catalog-schema "$CALL_LOG" && fail "must never ask the catalog after the refusal"
  teardown
}

for test_case in \
  case_green_when_all_three_tables_exist \
  case_names_a_table_the_migrator_reports_false \
  case_names_a_table_the_migrator_never_reports \
  case_fails_on_an_unreadable_answer \
  case_reports_a_refusal_code \
  case_ignores_an_ok_status_over_an_incomplete_map \
  case_refuses_an_unknown_environment \
  case_refuses_a_plaintext_migrator_url \
  case_refuses_a_plaintext_token_endpoint; do
  "$test_case"
done

echo "PASS: verify-catalog-schema.sh"
