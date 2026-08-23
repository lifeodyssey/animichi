#!/usr/bin/env bash
# Fail-closed status contract for the Security required check.
#
# The top-level CI job supplies the reusable workflow result. The reusable
# workflow's own summary supplies every child result, so a skipped, cancelled,
# failed, unreadable, or head-mismatched scan cannot become green.
set -euo pipefail

fail() {
  echo "Security aggregate: $1" >&2
  exit 1
}

record_failure() {
  [[ -n "${failure_message}" ]] || failure_message="$1"
}

expected_sha="${EXPECTED_SHA:-}"
actual_sha="${ACTUAL_SHA:-}"
security_result="${SECURITY_RESULT:-}"
require_children="${REQUIRE_CHILD_RESULTS:-false}"
failure_message=""

[[ "${expected_sha}" =~ ^[0-9a-f]{40}$ ]] || record_failure "expected head SHA is missing or malformed"
[[ "${actual_sha}" =~ ^[0-9a-f]{40}$ ]] || record_failure "observed head SHA is missing or malformed"
if [[ -z "${failure_message}" && "${expected_sha}" != "${actual_sha}" ]]; then
  record_failure "scan head ${actual_sha} differs from expected ${expected_sha}"
fi
[[ "${security_result}" == "success" ]] || record_failure "underlying workflow result is ${security_result:-unavailable}"

if [[ "${require_children}" == "true" ]]; then
  child_results="${SECURITY_RESULTS:-}"
  if [[ -z "${child_results}" ]]; then
    record_failure "underlying child results are unavailable"
  else
    while IFS='=' read -r child result; do
      if [[ -z "${child}" || -z "${result}" ]]; then
        record_failure "malformed child result"
      elif [[ "${result}" != "success" ]]; then
        record_failure "${child} result is ${result}"
      fi
    done <<< "${child_results}"
  fi
fi

summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"
summary_result="success"
[[ -z "${failure_message}" ]] || summary_result="failure"
{
  echo "## Security"
  echo "- Head: \`${actual_sha:-unavailable}\`"
  echo "- Result: \`${summary_result}\`"
  if [[ "${require_children}" == "true" ]]; then
    echo "- Underlying checks:"
    if [[ -n "${SECURITY_RESULTS:-}" ]]; then
      while IFS='=' read -r child result; do
        echo "  - \`${child:-unavailable}\`: \`${result:-unavailable}\`"
      done <<< "${SECURITY_RESULTS}"
    else
      echo "  - unavailable"
    fi
  fi
} >> "${summary_file}"

[[ -z "${failure_message}" ]] || fail "${failure_message}"
