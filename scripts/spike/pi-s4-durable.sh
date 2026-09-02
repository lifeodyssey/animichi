#!/usr/bin/env bash
set -euo pipefail

# scripts/spike/pi-s4-durable.sh — W0-S4 (#1247) measurement harness for the
# deployed pi probe Worker's Durable Object state machine
# (workers/edge/spike/pi, class DurableTurnSession).
#
# It answers the S4 acceptance criteria against a REAL deployment, because the
# questions are all about a real alarm handler, a real eviction/retry and real
# Neon rows — none of which wrangler dev can answer (spec §四). The unit tests
# cover the same state machine over doubles; this script is the deployed run.
#
# Cases:
#   long   a five-minute turn with three tool calls. The client is hung up on
#          deliberately (curl --max-time well below the turn), then the run is
#          polled through GET /runs/:id until it reaches a terminal state. The
#          hard condition is run=succeeded with a complete transcript.
#   busy   a second turn on the same session while the first is running, which
#          must lose to runs_one_running_per_session and come back 409.
#   crash  a turn with the crash injected between "tool returned" and "step row
#          written". The alarm dies with an uncaught exception; Cloudflare's own
#          at-least-once alarm retry replays it. The proof is toolCalls =
#          toolCalls+1, i.e. the settled steps were replayed rather than re-run.
#
# Usage:
#   scripts/spike/pi-s4-durable.sh all   --url <worker-url> [--out DIR]
#   scripts/spike/pi-s4-durable.sh long  --url <worker-url> [--hold-ms N]
#   scripts/spike/pi-s4-durable.sh busy  --url <worker-url>
#   scripts/spike/pi-s4-durable.sh crash --url <worker-url>
#   scripts/spike/pi-s4-durable.sh format < "$OUT/results.txt"
#
# The Worker needs its SPIKE_DATABASE_URL secret set to a throwaway Neon branch
# carrying the migrations/neon chain; GET /healthz reports `database` as a
# boolean so you can check that before spending five minutes.
#
# Records accumulate in "$OUT/results.txt" as `name|label|ms|status|detail`
# lines — the same shape scripts/spike/pi-s1-measure.sh writes, so the spec
# appendix keeps one table format. Response bodies land next to them as evidence.

URL=""
OUT="${PWD}/.local/spike/pi-s4"
LONG_HOLD_MS=100000
LONG_DEADLINE_MS=420000
SHORT_HOLD_MS=2000
SHORT_DEADLINE_MS=360000
TOOL_CALLS=3
HANGUP_SECONDS=5
POLL_TIMEOUT_SECONDS=900
POLL_INTERVAL_SECONDS=5

usage() {
  sed -n '4,40p' "$0" >&2
  exit 64
}

fail() {
  echo "pi-s4-durable: $1" >&2
  exit 1
}

parse_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --url) URL="${2:-}"; shift 2 ;;
      --out) OUT="${2:-}"; shift 2 ;;
      --hold-ms) LONG_HOLD_MS="${2:-}"; shift 2 ;;
      --deadline-ms) LONG_DEADLINE_MS="${2:-}"; shift 2 ;;
      *) usage ;;
    esac
  done
}

require_url() {
  [ -n "${URL}" ] || fail "--url is required (the deployed Worker's base URL)"
  mkdir -p "${OUT}"
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

json_string() {
  sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" "$1" | head -1
}

json_number() {
  sed -n "s/.*\"$2\":\([0-9][0-9]*\).*/\1/p" "$1" | head -1
}

count_steps() {
  grep -o '"stepIndex"' "$1" 2>/dev/null | wc -l | tr -d ' '
}

turn_body() {
  local hold="$1" deadline="$2" extra="$3"
  printf '{"holdMs":%s,"deadlineMs":%s,"toolCalls":%s%s}' \
    "${hold}" "${deadline}" "${TOOL_CALLS}" "${extra}"
}

# Opens a turn and hangs up on it. Prints the run id the Worker assigned.
open_turn() {
  local session="$1" body="$2" headers="${OUT}/$3-open.headers"
  curl -sS -N -D "${headers}" -o "${OUT}/$3-open.sse" --max-time "${HANGUP_SECONDS}" \
    -H 'content-type: application/json' -d "${body}" \
    "${URL}/turn/long?session=${session}" >/dev/null 2>&1 || true
  tr -d '\r' < "${headers}" | sed -n 's/^[Xx]-[Ss]pike-[Rr]un-[Ii]d: //p' | head -1
}

# Polls GET /runs/:id until the run leaves `running`. Leaves the body at $4.
poll_run() {
  local session="$1" run_id="$2" evidence="$3" waited=0 status=""
  while [ "${waited}" -lt "${POLL_TIMEOUT_SECONDS}" ]; do
    curl -sS -o "${evidence}" "${URL}/runs/${run_id}?session=${session}" || true
    status="$(json_string "${evidence}" status)"
    case "${status}" in succeeded|failed) echo "${status}"; return 0 ;; esac
    sleep "${POLL_INTERVAL_SECONDS}"
    waited=$(( waited + POLL_INTERVAL_SECONDS ))
  done
  echo "timeout"
}

long_case() {
  require_url
  local session="s4-long" evidence="${OUT}/long-run.json" run_id status started elapsed
  started="$(date +%s)"
  run_id="$(open_turn "${session}" "$(turn_body "${LONG_HOLD_MS}" "${LONG_DEADLINE_MS}" "")" long)"
  [ -n "${run_id}" ] || fail "the Worker did not return a run id; check GET /healthz database"
  status="$(poll_run "${session}" "${run_id}" "${evidence}")"
  elapsed=$(( $(date +%s) - started ))
  record "long-turn" "5-minute turn, client hung up after ${HANGUP_SECONDS}s" \
    "$(( elapsed * 1000 ))" "${status}" \
    "steps=$(count_steps "${evidence}") tools=$(json_number "${evidence}" toolCalls) billedMs=$(json_number "${evidence}" billedMs)"
}

busy_case() {
  require_url
  local session="s4-busy" code
  open_turn "${session}" "$(turn_body "${SHORT_HOLD_MS}" "${SHORT_DEADLINE_MS}" "")" busy >/dev/null
  code="$(curl -sS -o "${OUT}/busy-second.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "$(turn_body "${SHORT_HOLD_MS}" "${SHORT_DEADLINE_MS}" "")" \
    "${URL}/turn/long?session=${session}")"
  record "concurrent-turn" "second turn on a running session" "0" "${code}" \
    "expected=409 body=$(json_string "${OUT}/busy-second.json" error)"
}

crash_case() {
  require_url
  local session="s4-crash" evidence="${OUT}/crash-run.json" run_id status expected
  expected=$(( TOOL_CALLS + 1 ))
  run_id="$(open_turn "${session}" \
    "$(turn_body "${SHORT_HOLD_MS}" "${SHORT_DEADLINE_MS}" ',"crashBeforePersistStep":1')" crash)"
  [ -n "${run_id}" ] || fail "the Worker did not return a run id for the crash case"
  status="$(poll_run "${session}" "${run_id}" "${evidence}")"
  record "crash-replay" "crash between tool return and step write" "0" "${status}" \
    "steps=$(count_steps "${evidence}") tools=$(json_number "${evidence}" toolCalls) expected=${expected}"
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
  busy_case
  crash_case
  long_case
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
    long) long_case ;;
    busy) busy_case ;;
    crash) crash_case ;;
    format) format_case ;;
    *) usage ;;
  esac
}

main "$@"
