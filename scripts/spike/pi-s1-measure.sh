#!/usr/bin/env bash
set -euo pipefail

# scripts/spike/pi-s1-measure.sh — W0-S1 (#1244) measurement harness for the
# deployed pi probe Worker (workers/edge/spike/pi).
#
# It answers the three S1 acceptance criteria against a REAL deployment: one
# real round trip per provider, the three abort break points, and the cold and
# warm wake-up times. Provider calls are never mocked here — that is the whole
# point of the card; the doubles live in the unit tests.
#
# Usage:
#   scripts/spike/pi-s1-measure.sh all   --url <worker-url> [--out DIR]
#   scripts/spike/pi-s1-measure.sh cold  --url <worker-url> [--out DIR]
#   scripts/spike/pi-s1-measure.sh warm  --url <worker-url> [--out DIR]
#   scripts/spike/pi-s1-measure.sh turn  --url <worker-url> --provider mimo|anthropic|gemini
#   scripts/spike/pi-s1-measure.sh abort --url <worker-url> \
#                                        --point provider_stream|tool_call|final_frame
#   scripts/spike/pi-s1-measure.sh format < "$OUT/results.txt"
#
# `cold` is only honest when the Worker has been idle for at least
# COLD_IDLE_SECONDS. The script records its own last contact in
# "$OUT/last-touch" and refuses to call a request cold when that marker is too
# fresh; it never polls or pings in the meantime, so it cannot keep the Worker
# warm by accident. With no marker at all (a fresh deploy, a fresh --out) the
# row is written with `idle=unverified` rather than a fabricated number.
#
# Records accumulate in "$OUT/results.txt" as `name|label|ms|status|detail`
# lines; `format` turns them into the markdown table for the spec appendix.
# Response bodies land next to it as evidence.

COLD_IDLE_SECONDS=600
URL=""
OUT="${PWD}/.local/spike/pi-s1"
PROVIDER=""
POINT=""

usage() {
  sed -n '4,30p' "$0" >&2
  exit 64
}

fail() {
  echo "pi-s1-measure: $1" >&2
  exit 1
}

parse_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --url) URL="${2:-}"; shift 2 ;;
      --out) OUT="${2:-}"; shift 2 ;;
      --provider) PROVIDER="${2:-}"; shift 2 ;;
      --point) POINT="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
}

require_url() {
  [ -n "${URL}" ] || fail "--url is required (the deployed Worker's base URL)"
  mkdir -p "${OUT}"
}

now_seconds() {
  date +%s
}

idle_seconds() {
  local marker="${OUT}/last-touch"
  [ -f "${marker}" ] || { echo "unverified"; return; }
  echo "$(( $(now_seconds) - $(cat "${marker}") ))"
}

mark_touched() {
  now_seconds > "${OUT}/last-touch"
}

to_ms() {
  awk '{ printf "%.0f", $1 * 1000 }' <<< "$1"
}

sanitize() {
  tr '|' '/' <<< "$1" | tr -d '\n'
}

record() {
  local line
  line="$(sanitize "$1")|$(sanitize "$2")|$(sanitize "$3")|$(sanitize "$4")|$(sanitize "$5")"
  echo "${line}" >> "${OUT}/results.txt"
  echo "${line}"
}

# Prints "<http_code> <seconds>" and leaves the body in $2.
probe_healthz() {
  curl -sS -o "$1" -w '%{http_code} %{time_total}' "${URL}/healthz"
}

measure_wake() {
  local name="$1" label="$2" detail="$3" result code seconds
  result="$(probe_healthz "${OUT}/${name}-healthz.json")"
  mark_touched
  code="${result%% *}"
  seconds="${result##* }"
  record "${name}" "${label}" "$(to_ms "${seconds}")" "${code}" "${detail}"
}

cold_case() {
  require_url
  local idle
  idle="$(idle_seconds)"
  if [ "${idle}" != "unverified" ] && [ "${idle}" -lt "${COLD_IDLE_SECONDS}" ]; then
    fail "last contact was ${idle}s ago; wait $(( COLD_IDLE_SECONDS - idle ))s for a cold read"
  fi
  measure_wake "cold" "cold wake-up (GET /healthz)" "idle=${idle}"
}

warm_case() {
  require_url
  measure_wake "warm" "warm wake-up (GET /healthz)" "idle=$(idle_seconds)"
}

post_turn() {
  local path="$1" body="$2" evidence="$3"
  curl -sS -N -o "${evidence}" -w '%{http_code} %{time_total}' \
    -H 'content-type: application/json' -d "${body}" "${URL}${path}"
}

outcome_flag() {
  local evidence="$1" key="$2"
  if grep -q "\"${key}\":true" "${evidence}" 2>/dev/null; then echo "yes"; else echo "no"; fi
}

turn_case() {
  require_url
  [ -n "${PROVIDER}" ] || fail "--provider is required for the turn case"
  local evidence="${OUT}/turn-${PROVIDER}.sse" result code seconds
  result="$(post_turn "/turn" "{\"provider\":\"${PROVIDER}\"}" "${evidence}")"
  mark_touched
  code="${result%% *}"
  seconds="${result##* }"
  record "turn-${PROVIDER}" "round trip via ${PROVIDER}" "$(to_ms "${seconds}")" "${code}" \
    "clean=$(outcome_flag "${evidence}" clean) evidence=$(basename "${evidence}")"
}

abort_case() {
  require_url
  [ -n "${POINT}" ] || fail "--point is required for the abort case"
  local evidence="${OUT}/abort-${POINT}.sse" result code seconds
  result="$(post_turn "/turn/abort" \
    "{\"provider\":\"${PROVIDER:-mimo}\",\"abortPoint\":\"${POINT}\"}" "${evidence}")"
  mark_touched
  code="${result%% *}"
  seconds="${result##* }"
  record "abort-${POINT}" "abort at ${POINT}" "$(to_ms "${seconds}")" "${code}" \
    "aborted=$(outcome_flag "${evidence}" abortFired) clean=$(outcome_flag "${evidence}" clean)"
}

format_case() {
  echo '| case | label | ms | status | detail |'
  echo '| --- | --- | --- | --- | --- |'
  while IFS='|' read -r name label ms status detail; do
    [ -n "${name}" ] || continue
    case "${name}" in \#*) continue ;; esac
    printf '| %s | %s | %s | %s | %s |\n' "${name}" "${label}" "${ms}" "${status}" "${detail}"
  done
}

all_cases() {
  require_url
  cold_case
  warm_case
  for provider in mimo anthropic gemini; do
    PROVIDER="${provider}"; turn_case
  done
  PROVIDER="mimo"
  for point in provider_stream tool_call final_frame; do
    POINT="${point}"; abort_case
  done
  echo
  format_case < "${OUT}/results.txt"
}

main() {
  local command="${1:-}"
  [ -n "${command}" ] || usage
  shift
  parse_options "$@"
  case "${command}" in
    all) all_cases ;;
    cold) cold_case ;;
    warm) warm_case ;;
    turn) turn_case ;;
    abort) abort_case ;;
    format) format_case ;;
    *) usage ;;
  esac
}

main "$@"
