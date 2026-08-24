#!/usr/bin/env bash
# Fail-closed exact-head aggregation for the PR Verification check.
set -euo pipefail

REPOSITORY="${GITHUB_REPOSITORY:-}"
HEAD_SHA="${PR_VERIFICATION_HEAD_SHA:-${GITHUB_SHA:-}}"
EXPECTED_PACKAGES="${PR_VERIFICATION_PACKAGES:-}"
ROUTE_RESULT="${PR_VERIFICATION_ROUTE_RESULT:-}"
MATRIX_RESULT="${PR_VERIFICATION_MATRIX_RESULT:-}"
QUALITY_RESULT="${PR_VERIFICATION_QUALITY_RESULT:-}"
LANES="${PR_VERIFICATION_LANES:-[]}"
CROSS_STACK_RESULT="${PR_VERIFICATION_CROSS_STACK_RESULT:-}"
SECRET_DIFF_RESULT="${PR_VERIFICATION_SECRET_DIFF_RESULT:-}"
SECURITY_RESULT="${PR_VERIFICATION_SECURITY_RESULT:-}"
COVERAGE_AGENT_RESULT="${PR_VERIFICATION_COVERAGE_AGENT_RESULT:-}"
COVERAGE_WEB_RESULT="${PR_VERIFICATION_COVERAGE_WEB_RESULT:-}"
COVERAGE_CATALOG_RESULT="${PR_VERIFICATION_COVERAGE_CATALOG_RESULT:-}"
COVERAGE_USERS_RESULT="${PR_VERIFICATION_COVERAGE_USERS_RESULT:-}"
CHECK_PREFIX="CI / affected"

fail() {
  printf '::error title=PR Verification::%s\n' "$1" >&2
  exit 1
}

lane_selected() {
  printf '%s' "$LANES" | jq -e --arg lane "$1" 'index($lane) != null' >/dev/null
}

require_lane() {
  local lane="$1" result="$2"
  if lane_selected "$lane"; then
    [ "$result" = success ] || fail "$lane did not complete successfully (result=$result)"
  elif [ "$result" != skipped ]; then
    fail "$lane ran outside the selected change plan (result=$result)"
  fi
}

[[ "$REPOSITORY" =~ ^[^/]+/[^/]+$ ]] || fail "missing or invalid repository"
[[ "$HEAD_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "missing or invalid current-head SHA"
[ "$ROUTE_RESULT" = success ] || fail "affected-package routing did not complete successfully (result=$ROUTE_RESULT)"
require_lane static-quality "$QUALITY_RESULT"
require_lane cross-stack "$CROSS_STACK_RESULT"
[ "$SECRET_DIFF_RESULT" = success ] || fail "changed-commit secret scan failed (result=$SECRET_DIFF_RESULT)"
[ "$SECURITY_RESULT" = success ] || fail "affected security aggregation failed (result=$SECURITY_RESULT)"

printf '%s' "$EXPECTED_PACKAGES" | jq -e 'type == "array" and all(.[]; type == "string" and length > 0)' >/dev/null || fail "affected-package matrix is malformed"
package_count="$(printf '%s' "$EXPECTED_PACKAGES" | jq 'length')"

require_component_job() {
  local component="$1" result="$2"
  if printf '%s' "$EXPECTED_PACKAGES" | jq -e --arg component "$component" 'index($component) != null' >/dev/null; then
    [ "$result" = success ] || fail "$component coverage upload failed (result=$result)"
  elif [ "$result" != skipped ]; then
    fail "$component coverage ran outside the affected plan (result=$result)"
  fi
}

require_component_job agent "$COVERAGE_AGENT_RESULT"
require_component_job web "$COVERAGE_WEB_RESULT"
require_component_job catalog "$COVERAGE_CATALOG_RESULT"
require_component_job users "$COVERAGE_USERS_RESULT"

if [ "$package_count" -eq 0 ]; then
  [ "$MATRIX_RESULT" = skipped ] || fail "empty affected plan unexpectedly ran a package matrix (result=$MATRIX_RESULT)"
  printf 'PR Verification: repository gates passed for %s; no product package changed.\n' "$HEAD_SHA"
  exit 0
fi

CHECK_RUNS="$(gh api "repos/$REPOSITORY/commits/$HEAD_SHA/check-runs?per_page=100")" || fail "GitHub check-run query failed"
printf '%s' "$CHECK_RUNS" | jq -e 'type == "object" and (.check_runs | type == "array")' >/dev/null || fail "GitHub returned malformed check-run data"

packages="$(printf '%s' "$EXPECTED_PACKAGES" | jq -r '.[]')"
failed=0
while IFS= read -r package; do
  [ -n "$package" ] || continue
  name="$CHECK_PREFIX ($package)"
  matches="$(printf '%s' "$CHECK_RUNS" | jq -c --arg name "$name" --arg sha "$HEAD_SHA" '[.check_runs[] | select(.name == $name and .head_sha == $sha)]')"
  count="$(printf '%s' "$matches" | jq 'length')"
  if [ "$count" -eq 0 ]; then
    stale="$(printf '%s' "$CHECK_RUNS" | jq -r --arg name "$name" '[.check_runs[] | select(.name == $name) | .head_sha] | unique | join(", ")')"
    printf '::error title=PR Verification / %s::package gate is missing or stale for %s (observed heads: %s)\n' "$package" "$HEAD_SHA" "${stale:-none}" >&2
    failed=1
    continue
  fi
  # A manual rerun can leave more than one check-run for the same head. The
  # newest run is authoritative; a different head is never eligible.
  match="$(printf '%s' "$matches" | jq -c 'sort_by(.started_at // .completed_at // "") | .[-1]')"
  status="$(printf '%s' "$match" | jq -r '.status')"
  conclusion="$(printf '%s' "$match" | jq -r '.conclusion // empty')"
  details="$(printf '%s' "$match" | jq -r '.details_url // .html_url // "unavailable"')"
  [ "$status" = completed ] && [ "$conclusion" = success ] || {
    printf '::error title=PR Verification / %s::package gate is %s/%s; details: %s\n' "$package" "$status" "$conclusion" "$details" >&2
    failed=1
  }
done <<< "$packages"

[ "$MATRIX_RESULT" = success ] || {
  printf '::error title=PR Verification::one or more selected package gates did not complete successfully (result=%s)\n' "$MATRIX_RESULT" >&2
  failed=1
}
[ "$failed" -eq 0 ] || exit 1

printf 'PR Verification: %s package gate(s) passed for %s.\n' "$(printf '%s' "$EXPECTED_PACKAGES" | jq 'length')" "$HEAD_SHA"
