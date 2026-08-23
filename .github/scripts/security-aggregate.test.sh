#!/usr/bin/env bash
# Red / restore / green tests for security-aggregate.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/security-aggregate.sh"
SHA="0123456789abcdef0123456789abcdef01234567"
RESULTS=$'gitleaks=success\ncodeql=success\nsemgrep=success'

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

run_case() {
  local label="$1" expected="$2" actual="$3" result="$4" children="$5" rc=0
  local summary
  summary="$(mktemp)"
  EXPECTED_SHA="${expected}" ACTUAL_SHA="${actual}" SECURITY_RESULT="${result}" \
    REQUIRE_CHILD_RESULTS=true SECURITY_RESULTS="${children}" GITHUB_STEP_SUMMARY="${summary}" \
    bash "${SCRIPT}" >/tmp/security-aggregate.out 2>&1 || rc=$?
  if [[ "${label}" == "green" ]]; then
    [[ "${rc}" -eq 0 ]] || fail_test "green case failed: $(cat /tmp/security-aggregate.out)"
    grep -q "Head:.*${actual}" "${summary}" || fail_test "green case omitted head evidence"
  else
    [[ "${rc}" -ne 0 ]] || fail_test "${label} case passed unexpectedly"
    if [[ "${label}" == "failed child" ]]; then
      grep -q 'gitleaks.*failure' "${summary}" || fail_test "failed child evidence was not retained"
    fi
  fi
  rm -f "${summary}"
  echo "PASS: ${label} (exit ${rc})"
}

run_case "green" "${SHA}" "${SHA}" success "${RESULTS}"
run_case "failed child" "${SHA}" "${SHA}" success $'gitleaks=failure\ncodeql=success\nsemgrep=success'
run_case "cancelled workflow" "${SHA}" "${SHA}" cancelled "${RESULTS}"
run_case "stale head" "${SHA}" "fedcba9876543210fedcba9876543210fedcba98" success "${RESULTS}"
run_case "missing child evidence" "${SHA}" "${SHA}" success ""

echo "All security-aggregate.sh tests passed."
