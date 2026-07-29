#!/usr/bin/env bash
# Real HTTP assertions against a deployed environment for the post-deploy
# promotion gate (issue #484). Every subcommand prints a diagnostic (status
# code + response body head, never a secret) on failure and exits non-zero.
# No continue-on-error, no lenient pass: an unreachable or misbehaving
# surface is a real gate failure.
set -euo pipefail

BODY_FILE="$(mktemp)"
trap 'rm -f "${BODY_FILE}"' EXIT

fail() {
  echo "::error title=post-deploy-assert::$1" >&2
  exit 1
}

# Issues a request and prints only the HTTP status code; the body lands in
# BODY_FILE for the caller to inspect.
fetch() {
  local method="$1" url="$2" auth_header="${3:-}" body="${4:-}"
  local args=(-sS -o "${BODY_FILE}" -w '%{http_code}' -X "${method}" "${url}")
  [ -n "${auth_header}" ] && args+=(-H "Authorization: ${auth_header}")
  [ -n "${body}" ] && args+=(-H "Content-Type: application/json" -d "${body}")
  curl "${args[@]}"
}

diag() {
  echo "status=$1"
  echo "body (first 500 chars):"
  head -c 500 "${BODY_FILE}"
  echo
}

cmd_healthz() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch GET "${ROOT_URL}/healthz")"
  diag "${status}"
  [ "${status}" = "200" ] || fail "GET ${ROOT_URL}/healthz expected 200, got ${status}"
  jq -e '.status == "ok"' "${BODY_FILE}" >/dev/null || fail "GET ${ROOT_URL}/healthz body missing status:\"ok\""
  local git_branch
  git_branch="$(jq -r '.git_branch // "unknown"' "${BODY_FILE}")"
  if [ "${git_branch}" = "unknown" ]; then
    echo "::warning title=post-deploy healthz::git_branch reports 'unknown' — the container image does not embed .git (Dockerfile has no GIT_SHA build arg), a known gap; not asserted on here, see PR notes"
  fi
}

cmd_auth_probe() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch POST "${ROOT_URL}/v1/chat" "Bearer not-a-real-token" '{"message":"ping"}')"
  diag "${status}"
  [ "${status}" = "401" ] || fail "POST ${ROOT_URL}/v1/chat with an invalid bearer token expected 401, got ${status} — the edge auth gate may be down"
  jq -e '.error.code == "unauthorized"' "${BODY_FILE}" >/dev/null || fail "POST /v1/chat 401 body missing error.code=unauthorized"
}

cmd_users_probe() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch GET "${ROOT_URL}/v1/users/post-deploy-probe-484")"
  diag "${status}"
  [ "${status}" = "401" ] || fail "GET ${ROOT_URL}/v1/users/post-deploy-probe-484 with no credentials expected 401 (proves the USERS service binding is reachable through the edge), got ${status}"
  jq -e '.error.code == "unauthorized"' "${BODY_FILE}" >/dev/null || fail "users probe 401 body missing error.code=unauthorized"
}

cmd_anon_gate_staging() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch POST "${ROOT_URL}/v1/chat" "" '{}')"
  diag "${status}"
  if [ "${status}" = "403" ] && jq -e '.error.code == "turnstile_required"' "${BODY_FILE}" >/dev/null 2>&1; then
    echo "Turnstile gate is armed on staging."
    return 0
  fi
  fail "anonymous POST ${ROOT_URL}/v1/chat on staging (ANON_ACCESS_ENABLED=true) expected 403 turnstile_required, got ${status}. The Turnstile gate (worker/turnstile.ts, guardTurnstile) is either not wired into the anonymous branch yet or TURNSTILE_SECRET is not injected into the staging Worker (see #484, #281). This is a REAL failure, not a false negative: shipping anonymous chat access without the gate armed is exactly the risk this check exists to catch."
}

cmd_anon_disabled_production() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch POST "${ROOT_URL}/v1/chat" "" '{}')"
  diag "${status}"
  [ "${status}" = "401" ] || fail "anonymous POST ${ROOT_URL}/v1/chat on production (ANON_ACCESS_ENABLED=false) expected 401 unauthorized, got ${status}"
  jq -e '.error.code == "unauthorized"' "${BODY_FILE}" >/dev/null || fail "production anon /v1/chat 401 body missing error.code=unauthorized"
}

cmd_web_landing() {
  : "${WEB_URL:?WEB_URL is required}"
  local status
  status="$(fetch GET "${WEB_URL}/")"
  diag "${status}"
  [ "${status}" = "200" ] || fail "GET ${WEB_URL}/ expected 200, got ${status}"
  grep -qi "Animichi" "${BODY_FILE}" || fail "GET ${WEB_URL}/ response did not contain the expected 'Animichi' title marker"
}

cmd_catalog_probe() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch GET "${ROOT_URL}/catalog/public/anime-overview/1")"
  diag "${status}"
  case "${status}" in
    200 | 404) : ;;
    *) fail "GET ${ROOT_URL}/catalog/public/anime-overview/1 expected 200 or 404 (catalog reachable via the CATALOG service binding), got ${status}" ;;
  esac
  jq -e '. != null' "${BODY_FILE}" >/dev/null || fail "catalog probe response is not valid JSON"
}

main() {
  local cmd="${1:?usage: post-deploy-assert.sh <healthz|auth-probe|users-probe|anon-gate-staging|anon-disabled-production|web-landing|catalog-probe>}"
  case "${cmd}" in
    healthz) cmd_healthz ;;
    auth-probe) cmd_auth_probe ;;
    users-probe) cmd_users_probe ;;
    anon-gate-staging) cmd_anon_gate_staging ;;
    anon-disabled-production) cmd_anon_disabled_production ;;
    web-landing) cmd_web_landing ;;
    catalog-probe) cmd_catalog_probe ;;
    *) fail "unknown check: ${cmd}" ;;
  esac
}

main "$@"
