#!/usr/bin/env bash
# Red / restore / green tests for security-aggregate.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${SCRIPT_DIR}/security-aggregate.sh"
SHA="0123456789abcdef0123456789abcdef01234567"
TOOLS='["codeql-python","semgrep"]'
TEST_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/security-aggregate-test.XXXXXX")"

cleanup() {
  rm -f "${TEST_TMP_DIR}/summary" "${TEST_TMP_DIR}/output"
  rmdir "${TEST_TMP_DIR}"
}

trap cleanup EXIT

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

run_case() {
  local label="$1" expected="$2" actual="$3" route="$4" secrets="$5" tools="$6" matrix="$7" rc=0
  local summary="${TEST_TMP_DIR}/summary" output="${TEST_TMP_DIR}/output"
  : >"${summary}"
  : >"${output}"
  EXPECTED_SHA="${expected}" ACTUAL_SHA="${actual}" ROUTE_RESULT="${route}" \
    SECRET_SCANS_RESULT="${secrets}" SECURITY_TOOLS="${tools}" SECURITY_MATRIX_RESULT="${matrix}" \
    GITHUB_STEP_SUMMARY="${summary}" \
    GITHUB_SERVER_URL="https://github.com" GITHUB_REPOSITORY="lifeodyssey/animichi" GITHUB_RUN_ID="12345" \
    bash "${SCRIPT}" >"${output}" 2>&1 || rc=$?
  if [[ "${label}" == "green" || "${label}" == "empty plan" ]]; then
    [[ "${rc}" -eq 0 ]] || fail_test "green case failed: $(cat "${output}")"
    grep -q "Head:.*${actual}" "${summary}" || fail_test "green case omitted head evidence"
    grep -q 'https://github.com/lifeodyssey/animichi/actions/runs/12345' "${summary}" || fail_test "green case omitted run-log link"
    grep -q "https://github.com/lifeodyssey/animichi/commit/${actual}/checks" "${summary}" || fail_test "green case omitted check-run link"
  else
    [[ "${rc}" -ne 0 ]] || fail_test "${label} case passed unexpectedly"
    if [[ "${label}" == "failed matrix" ]]; then
      grep -q 'Tool matrix:.*failure' "${summary}" || fail_test "failed matrix evidence was not retained"
    fi
  fi
  echo "PASS: ${label} (exit ${rc})"
}

run_case "green" "${SHA}" "${SHA}" success success "${TOOLS}" success
run_case "empty plan" "${SHA}" "${SHA}" success success '[]' skipped
run_case "failed secrets" "${SHA}" "${SHA}" success failure "${TOOLS}" success
run_case "failed matrix" "${SHA}" "${SHA}" success success "${TOOLS}" failure
run_case "cancelled routing" "${SHA}" "${SHA}" cancelled success "${TOOLS}" success
run_case "stale head" "${SHA}" "fedcba9876543210fedcba9876543210fedcba98" success success "${TOOLS}" success
run_case "malformed tools" "${SHA}" "${SHA}" success success "" success

echo "All security-aggregate.sh tests passed."
