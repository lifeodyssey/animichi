#!/usr/bin/env bash
# #1198 park lifted by owner decision (docs/specs/2026-08-26-system-health-audit.md §6.3):
# staging deploys were verified only by exit code, never by an actual request. This checks
# the two surfaces a broken staging deploy breaks first — the agent healthz probe (via the
# edge worker) and the SSR shell — with retries for deploy propagation, and fails closed so
# a broken staging blocks promote-production instead of silently passing it on.
set -euo pipefail

BASE_URL="${1:?staging edge base URL required}"
# The web app lives on its own worker: the zone hostname routes `/` to it,
# but on workers.dev each worker only answers for itself — so the SSR-shell
# probe needs the web worker's own origin, not the edge's.
WEB_URL="${2:-$BASE_URL}"
ATTEMPTS="${SMOKE_ATTEMPTS:-3}"
RETRY_DELAY="${SMOKE_RETRY_DELAY:-10}"

fail() { echo "::error title=staging smoke::$*"; exit 1; }

http_body_and_code() {
  curl -sS --max-time 15 -w '\n%{http_code}' "$1"
}

healthz_ok() {
  local response code body
  response="$(http_body_and_code "$BASE_URL/healthz")" || return 1
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [ "$code" = "200" ] || { echo "healthz returned HTTP $code: $body" >&2; return 1; }
  jq -e '.status == "ok"' <<<"$body" >/dev/null 2>&1 || { echo "healthz body missing status=ok: $body" >&2; return 1; }
}

shell_ok() {
  local response code body
  response="$(http_body_and_code "$WEB_URL/")" || return 1
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [ "$code" = "200" ] || { echo "/ returned HTTP $code" >&2; return 1; }
  grep -q 'app-splash' <<<"$body" || { echo "/ body is missing the app-splash SSR marker" >&2; return 1; }
}

run_checks() { healthz_ok && shell_ok; }

main() {
  local attempt=1
  while ! run_checks; do
    [ "$attempt" -lt "$ATTEMPTS" ] || fail "staging smoke check failed after $ATTEMPTS attempts"
    echo "staging smoke check attempt $attempt failed; retrying in ${RETRY_DELAY}s" >&2
    sleep "$RETRY_DELAY"
    attempt=$((attempt + 1))
  done
  echo "staging smoke check passed on attempt $attempt"
}

main
