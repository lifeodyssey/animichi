#!/usr/bin/env bash
# SESSION-3 staging cutover phase-state recorder (issue #961).
#
# Every cutover phase records its public state fields so the cutover is
# machine-auditable. State contains component/resource names, phase markers,
# and reason classes ONLY — never a token, cookie, DSN, user identity,
# Message, prompt, SavedRoute content, or provider key.
#
# Records are appended to a per-run state JSONL (`cutover-state.jsonl` in the
# workspace) and mirrored to the GitHub step summary. The allowed field names
# are the STAGING-CUTOVER.md declarative state model plus evidence counters.
#
# Usage:
#   cutover-state.sh record <field>=<value> [<field>=<value> ...]
#   cutover-state.sh read   # print the accumulated JSONL

set -euo pipefail

STATE_FILE="${CUTOVER_STATE_FILE:-cutover-state.jsonl}"

# Allowed state fields per STAGING-CUTOVER.md §3 (plus evidence counters).
ALLOWED_FIELDS="source_revision|ingress|retention_execution|auth_boundary|application_schema|consumers|verdict|retained_table|phase|deployed_sha|smoke_result|reason"

record() {
  local entry="{"
  local first=1
  for kv in "$@"; do
    local field="${kv%%=*}"
    local value="${kv#*=}"
    if [[ ! "${field}" =~ ^${ALLOWED_FIELDS}$ ]]; then
      echo "cutover-state: disallowed state field: ${field}" >&2
      exit 2
    fi
    if [[ "${value}" =~ [\"\\] ]]; then
      echo "cutover-state: state value must not contain quotes or backslashes" >&2
      exit 2
    fi
    [[ ${first} -eq 0 ]] && entry+=","
    first=0
    entry+="\"${field}\":\"${value}\""
  done
  entry+="}"
  printf '%s\n' "${entry}" >> "${STATE_FILE}"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '| %s |\n' "${entry//|/\\|}" >> "${GITHUB_STEP_SUMMARY}"
  fi
  printf '%s\n' "${entry}"
}

read_state() {
  if [[ -f "${STATE_FILE}" ]]; then
    cat "${STATE_FILE}"
  fi
}

case "${1:-}" in
  record) shift; [[ $# -ge 1 ]] || { echo "usage: cutover-state.sh record <field>=<value> ..." >&2; exit 2; }; record "$@" ;;
  read) read_state ;;
  *) echo "usage: cutover-state.sh record|read" >&2; exit 2 ;;
esac
