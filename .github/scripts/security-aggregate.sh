#!/usr/bin/env bash
# Fail-closed status contract for the Security required check.
#
# The top-level CI job supplies the changed-secret result plus the result of the
# affected security-tool matrix. A skipped, cancelled, failed, malformed, or
# head-mismatched selected check cannot become green.
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
route_result="${ROUTE_RESULT:-}"
secret_scans_result="${SECRET_SCANS_RESULT:-}"
security_tools="${SECURITY_TOOLS:-}"
security_matrix_result="${SECURITY_MATRIX_RESULT:-}"
failure_message=""

[[ "${expected_sha}" =~ ^[0-9a-f]{40}$ ]] || record_failure "expected head SHA is missing or malformed"
[[ "${actual_sha}" =~ ^[0-9a-f]{40}$ ]] || record_failure "observed head SHA is missing or malformed"
if [[ -z "${failure_message}" && "${expected_sha}" != "${actual_sha}" ]]; then
  record_failure "scan head ${actual_sha} differs from expected ${expected_sha}"
fi
[[ "${route_result}" == "success" ]] || record_failure "change routing result is ${route_result:-unavailable}"
[[ "${secret_scans_result}" == "success" ]] || record_failure "changed-secret scans result is ${secret_scans_result:-unavailable}"
if ! jq -e 'type == "array" and length == (unique | length) and all(.[]; type == "string" and length > 0)' \
  <<< "${security_tools}" >/dev/null 2>&1; then
  record_failure "selected security tools are missing or malformed"
  tool_count=-1
else
  tool_count="$(jq 'length' <<< "${security_tools}")"
fi
if [[ "${tool_count}" -eq 0 ]]; then
  [[ "${security_matrix_result}" == "skipped" ]] || record_failure "empty security plan ran a matrix (${security_matrix_result:-unavailable})"
elif [[ "${tool_count}" -gt 0 ]]; then
  [[ "${security_matrix_result}" == "success" ]] || record_failure "selected security matrix result is ${security_matrix_result:-unavailable}"
fi

summary_file="${GITHUB_STEP_SUMMARY:-/dev/null}"
summary_result="success"
[[ -z "${failure_message}" ]] || summary_result="failure"
server_url="${GITHUB_SERVER_URL:-https://github.com}"
repository="${GITHUB_REPOSITORY:-}"
run_id="${GITHUB_RUN_ID:-}"
run_url=""
checks_url=""
if [[ "${repository}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "${run_id}" =~ ^[0-9]+$ ]]; then
  run_url="${server_url%/}/${repository}/actions/runs/${run_id}"
fi
if [[ "${repository}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && "${actual_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  checks_url="${server_url%/}/${repository}/commit/${actual_sha}/checks"
fi
{
  echo "## Security"
  echo "- Head: \`${actual_sha:-unavailable}\`"
  echo "- Result: \`${summary_result}\`"
  [[ -z "${run_url}" ]] || echo "- Run logs: [workflow run](${run_url})"
  [[ -z "${checks_url}" ]] || echo "- Child check runs: [commit checks](${checks_url})"
  echo "- Changed-secret scans: \`${secret_scans_result:-unavailable}\`"
  echo "- Selected tools: \`${security_tools:-unavailable}\`"
  echo "- Tool matrix: \`${security_matrix_result:-unavailable}\`"
} >> "${summary_file}"

[[ -z "${failure_message}" ]] || fail "${failure_message}"
