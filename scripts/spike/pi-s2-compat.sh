#!/usr/bin/env bash
set -euo pipefail

# scripts/spike/pi-s2-compat.sh — W0-S2 (#1245) compat switch matrix for the
# deployed pi probe Worker (workers/edge/spike/pi).
#
# One measured turn per switch value against the REAL mimo gateway, so the
# dialect table in spec §四 is evidence rather than a reading of pi's source.
# Nothing here is mocked; the doubles live in the unit tests.
#
# Usage:
#   scripts/spike/pi-s2-compat.sh --url <worker-url> [--route direct|zen] [--out DIR]
#   scripts/spike/pi-s2-compat.sh case --url <worker-url> --route direct \
#                                      [--switch supportsStrictMode --value false]
#   scripts/spike/pi-s2-compat.sh format < "$OUT/results.txt"
#
# With no --route the script runs both. A route whose key is missing on the
# deployed Worker (GET /healthz reports `mimoRoutes`) is SKIPPED with a row
# saying so — it never fails the run, because only the owner can add a secret.
#
# The matrix is: the all-defaults case (pi's own auto-detection from the
# baseUrl), then every switch at each of its two values, one switch at a time.
# That is 1 + 18 turns per route; at the S1 mimo baseline of ~52 s a round trip
# (spec appendix A) one route takes roughly 17 minutes, so run it detached or
# one `case` at a time.
#
# Records accumulate in "$OUT/results.txt" as
# `route|switch|value|tool|usage|wall_ms|first_token_ms|note` lines; `format`
# turns them into the markdown table for the spec. Response bodies land next to
# it as evidence.

URL=""
OUT="${PWD}/.local/spike/pi-s2"
ROUTE=""
SWITCH=""
VALUE=""
# A round trip is ~52 s at the S1 baseline; Workers themselves impose no
# wall-clock limit on an HTTP request
# (developers.cloudflare.com/workers/platform/limits/ — "Duration: HTTP
# request: No limit"), so this ceiling is ours, to keep a hung gateway from
# stalling the matrix.
MAX_SECONDS=300

# The source of truth for these names is
# `workers/edge/spike/pi/src/compat-switch.ts`; the Worker rejects any name it
# does not know with a 400. The two lists cannot drift silently: the matrix test
# (`workers/edge/test/pi-spike-compat-matrix.test.ts`) imports the TS constants
# and asserts the exact request bodies this script sends.
BOOLEAN_SWITCHES=(
  supportsStore
  supportsDeveloperRole
  supportsReasoningEffort
  supportsUsageInStreaming
  supportsFinishReason
  supportsStrictMode
  requiresToolResultName
  requiresAssistantAfterToolResult
)
MAX_TOKENS_FIELDS=(max_tokens max_completion_tokens)

usage() {
  sed -n '4,30p' "$0" >&2
  exit 64
}

fail() {
  echo "pi-s2-compat: $1" >&2
  exit 1
}

parse_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --url) URL="${2:-}"; shift 2 ;;
      --out) OUT="${2:-}"; shift 2 ;;
      --route) ROUTE="${2:-}"; shift 2 ;;
      --switch) SWITCH="${2:-}"; shift 2 ;;
      --value) VALUE="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
}

require_url() {
  [ -n "${URL}" ] || fail "--url is required (the deployed Worker's base URL)"
  command -v jq >/dev/null 2>&1 || fail "jq is required to read the /compat response"
  mkdir -p "${OUT}"
}

# `printf` rather than a here-string: a here-string appends a newline, which
# `tr` would turn into a trailing space inside every recorded field.
sanitize() {
  printf '%s' "$1" | tr '|\n' '/ ' | cut -c1-160
}

record() {
  local line
  line="$(sanitize "$1")|$(sanitize "$2")|$(sanitize "$3")|$(sanitize "$4")|$(sanitize "$5")"
  line="${line}|$(sanitize "$6")|$(sanitize "$7")|$(sanitize "$8")"
  echo "${line}" >> "${OUT}/results.txt"
  echo "${line}"
}

# `{}` means "no overrides" — pi auto-detects the dialect from the baseUrl.
compat_json() {
  local name="$1" value="$2"
  [ -n "${name}" ] || { printf '{}'; return; }
  case "${name}" in
    maxTokensField) printf '{"%s":"%s"}' "${name}" "${value}" ;;
    *) printf '{"%s":%s}' "${name}" "${value}" ;;
  esac
}

# One pre-flight read, so "this route has no key" is never confused with "the
# Worker is unreachable" — the first is a skip, the second is a failed run.
fetch_health() {
  curl -sS --max-time 30 -o "${OUT}/healthz.json" "${URL}/healthz" \
    || fail "cannot reach ${URL}/healthz"
  jq -e 'has("mimoRoutes")' "${OUT}/healthz.json" >/dev/null \
    || fail "healthz reports no mimoRoutes; the deployed Worker predates #1245"
}

route_available() {
  [ "$(jq -r --arg r "$1" '.mimoRoutes[$r]' "${OUT}/healthz.json")" = "true" ]
}

require_known_route() {
  case "$1" in
    direct|zen) ;;
    *) fail "--route must be direct or zen" ;;
  esac
}

flag_of() {
  local evidence="$1" field="$2"
  if [ "$(jq -r ".${field}" "${evidence}")" = "true" ]; then echo "yes"; else echo "no"; fi
}

note_of() {
  local evidence="$1"
  jq -r '.error // ("events=" + (.events | length | tostring))' "${evidence}"
}

# Prints the http code and leaves the JSON body in $1.
post_compat() {
  local evidence="$1" body="$2"
  curl -sS -o "${evidence}" -w '%{http_code}' --max-time "${MAX_SECONDS}" \
    -H 'content-type: application/json' -d "${body}" "${URL}/compat"
}

record_failed_case() {
  local route="$1" name="$2" value="$3" code="$4" evidence="$5"
  record "${route}" "${name}" "${value}" "no" "no" "-" "-" \
    "http ${code}: $(head -c 120 "${evidence}")"
}

run_case() {
  local route="$1" name="${2:-}" value="${3:-}" evidence code
  evidence="${OUT}/${route}-${name:-defaults}-${value:-auto}.json"
  code="$(post_compat "${evidence}" \
    "$(printf '{"route":"%s","compat":%s}' "${route}" "$(compat_json "${name}" "${value}")")")"
  if [ "${code}" != "200" ]; then
    record_failed_case "${route}" "${name:-(defaults)}" "${value:-auto}" "${code}" "${evidence}"
    return
  fi
  record "${route}" "${name:-(defaults)}" "${value:-auto}" \
    "$(flag_of "${evidence}" toolRoundTrip)" "$(flag_of "${evidence}" streamingUsage)" \
    "$(jq -r '.wallMs' "${evidence}")" "$(jq -r '.firstTokenMs // "none"' "${evidence}")" \
    "$(note_of "${evidence}")"
}

single_case() {
  require_url
  [ -n "${ROUTE}" ] || fail "--route is required for a single case"
  require_known_route "${ROUTE}"
  run_case "${ROUTE}" "${SWITCH}" "${VALUE}"
}

matrix_for_route() {
  local route="$1" name
  if ! route_available "${route}"; then
    record "${route}" "-" "-" "skipped" "skipped" "-" "-" \
      "no key for this route on the deployed Worker"
    return
  fi
  run_case "${route}"
  for name in "${BOOLEAN_SWITCHES[@]}"; do
    run_case "${route}" "${name}" true
    run_case "${route}" "${name}" false
  done
  for name in "${MAX_TOKENS_FIELDS[@]}"; do
    run_case "${route}" maxTokensField "${name}"
  done
}

format_case() {
  echo '| route | switch | value | tool round trip | streaming usage | wall ms | first token ms | note |'
  echo '| --- | --- | --- | --- | --- | --- | --- | --- |'
  while IFS='|' read -r route name value tool usage wall first note; do
    [ -n "${route}" ] || continue
    case "${route}" in \#*) continue ;; esac
    printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' \
      "${route}" "${name}" "${value}" "${tool}" "${usage}" "${wall}" "${first}" "${note}"
  done
}

matrix_cases() {
  require_url
  local route routes=(direct zen)
  if [ -n "${ROUTE}" ]; then
    require_known_route "${ROUTE}"
    routes=("${ROUTE}")
  fi
  fetch_health
  for route in "${routes[@]}"; do
    matrix_for_route "${route}"
  done
  echo
  format_case < "${OUT}/results.txt"
}

main() {
  local command="matrix"
  case "${1:-}" in
    matrix|case|format) command="$1"; shift ;;
    "") usage ;;
  esac
  parse_options "$@"
  case "${command}" in
    matrix) matrix_cases ;;
    case) single_case ;;
    format) format_case ;;
    *) usage ;;
  esac
}

main "$@"
