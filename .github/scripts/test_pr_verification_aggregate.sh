#!/usr/bin/env bash
# Behavioral tests for exact-head PR Verification aggregation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGGREGATE="$SCRIPT_DIR/pr-verification-aggregate.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pr-verification-aggregate.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"

cat > "$MOCK_BIN/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "${MOCK_CASE:-success}" in
  success)
    printf '%s\n' '{"check_runs":[{"name":"CI / affected (agent)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","details_url":"https://checks/agent"},{"name":"CI / affected (web)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","details_url":"https://checks/web"}]}'
    ;;
  duplicate)
    printf '%s\n' '{"check_runs":[{"name":"CI / affected (agent)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"failure","started_at":"2026-08-23T00:00:00Z","details_url":"https://checks/old-agent"},{"name":"CI / affected (agent)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","started_at":"2026-08-23T00:01:00Z","details_url":"https://checks/new-agent"},{"name":"CI / affected (web)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","details_url":"https://checks/web"}]}'
    ;;
  failure)
    printf '%s\n' '{"check_runs":[{"name":"CI / affected (agent)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"failure","details_url":"https://checks/agent"},{"name":"CI / affected (web)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","details_url":"https://checks/web"}]}'
    ;;
  missing)
    printf '%s\n' '{"check_runs":[{"name":"CI / affected (agent)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","details_url":"https://checks/agent"}]}'
    ;;
  stale)
    printf '%s\n' '{"check_runs":[{"name":"CI / affected (agent)","head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","status":"completed","conclusion":"success","details_url":"https://checks/agent"},{"name":"CI / affected (web)","head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"completed","conclusion":"success","details_url":"https://checks/web"}]}'
    ;;
  malformed)
    printf '%s\n' '[]'
    ;;
esac
MOCK
chmod +x "$MOCK_BIN/gh"

run_case() {
  local name="$1" expected="$2" matrix_result="$3" quality_result="${4:-success}"
  local cross_result="${5:-success}" eval_result="${6:-skipped}" rc=0 output
  output="$(PATH="$MOCK_BIN:$PATH" MOCK_CASE="$name" GITHUB_REPOSITORY=lifeodyssey/animichi \
    PR_VERIFICATION_HEAD_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    PR_VERIFICATION_PACKAGES='["agent","web"]' \
    PR_VERIFICATION_ROUTE_RESULT=success PR_VERIFICATION_MATRIX_RESULT="$matrix_result" \
    PR_VERIFICATION_QUALITY_RESULT="$quality_result" \
    PR_VERIFICATION_SECRET_DIFF_RESULT=success \
    PR_VERIFICATION_SECURITY_RESULT=success \
    PR_VERIFICATION_AGENT_EVAL_RESULT="$eval_result" \
    PR_VERIFICATION_COVERAGE_AGENT_RESULT=success \
    PR_VERIFICATION_COVERAGE_WEB_RESULT=success \
    PR_VERIFICATION_COVERAGE_CATALOG_RESULT=skipped \
    PR_VERIFICATION_COVERAGE_USERS_RESULT=skipped \
    PR_VERIFICATION_LANES='["cross-stack","static-quality"]' \
    PR_VERIFICATION_CROSS_STACK_RESULT="$cross_result" \
    bash "$AGGREGATE" 2>&1)" || rc=$?
  [ "$rc" -eq "$expected" ] || { echo "FAIL $name: expected $expected, got $rc: $output" >&2; exit 1; }
  printf '%s\n' "$output"
}

run_case success 0 success
run_case duplicate 0 success
run_case success 0 success success success failure
run_case failure 1 success
run_case missing 1 success
run_case stale 1 success
run_case malformed 1 success
run_case success 1 cancelled
run_case success 1 success failure
run_case success 1 success success failure
echo "PR Verification aggregate tests: required lanes fail closed and agent eval remains report-only"
