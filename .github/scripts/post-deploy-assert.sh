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
# BODY_FILE for the caller to inspect. Bounded retry/backoff on TRANSPORT
# failures and Cloudflare edge errors (521-524 — "origin unreachable", the
# shape of a workers.dev DNS-propagation window or a cold container start)
# only. Never retries on an ordinary application status (200/401/403/404/…):
# those are real, final answers from a live app, not a "not ready yet" signal,
# and several callers below assert on non-2xx by design.
fetch() {
  local method="$1" url="$2" auth_header="${3:-}" body="${4:-}"
  local args=(-sS -o "${BODY_FILE}" -w '%{http_code}' --connect-timeout 10 --max-time 20 -X "${method}" "${url}")
  [ -n "${auth_header}" ] && args+=(-H "Authorization: ${auth_header}")
  [ -n "${body}" ] && args+=(-H "Content-Type: application/json" -d "${body}")
  local attempt status rc
  for attempt in 1 2 3 4 5; do
    status="$(curl "${args[@]}")" && rc=0 || rc=$?
    case "${rc}.${status}" in
      0.521 | 0.522 | 0.523 | 0.524 | [1-9]*.*) : ;; # transport failure or CF edge-origin error — retry
      *) echo "${status}"; return 0 ;;
    esac
    echo "attempt ${attempt}/5: transport rc=${rc} status=${status:-n/a} for ${method} ${url} — retrying (workers.dev DNS propagation / container cold start window)" >&2
    sleep $((attempt * 5))
  done
  echo "${status:-000}"
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
    echo "::warning title=post-deploy healthz::git_branch reports 'unknown' — the container image does not embed .git (Dockerfile has no GIT_SHA build arg). Known gap, tracked separately; not asserted on here (see docs/ops/deployment.md)."
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

# Anonymous chat on staging (ANON_ACCESS_ENABLED=true) MUST come back
# 403 turnstile_required. The gate is armed in code (issue #447,
# worker/app.ts handleAnonymousV1 -> guardTurnstile) and fails CLOSED — if
# TURNSTILE_SECRET itself is missing, guardTurnstile still returns 403
# turnstile_required (worker/turnstile.ts usableSecret/rejection), it does
# NOT let the request through. So a 403 here does not require the Cloudflare
# secret to be provisioned yet.
#
# The one precondition this DOES have is ANON_ID_SECRET (issue #492):
# resolveAnonymous (worker/auth.ts) returns null before guardTurnstile is
# ever reached when that secret is absent, and handleAnonymousV1 then falls
# through to the ordinary 401 path. So a 401 here is a distinct, expected-
# until-#492 failure mode ("anonymous identity isn't enabled yet"), not
# evidence the Turnstile gate itself is broken. Any OTHER status (200 above
# all — a served anonymous chat turn with no challenge) is the critical case:
# the gate is bypassed in a live environment with anonymous access on.
cmd_anon_gate_staging() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch POST "${ROOT_URL}/v1/chat" "" '{}')"
  diag "${status}"
  if [ "${status}" = "403" ] && jq -e '.error.code == "turnstile_required"' "${BODY_FILE}" >/dev/null 2>&1; then
    echo "Turnstile gate is armed on staging (403 turnstile_required)."
    return 0
  fi
  if [ "${status}" = "401" ]; then
    fail "anonymous POST ${ROOT_URL}/v1/chat on staging expected 403 turnstile_required, got 401. The gate itself (worker/app.ts handleAnonymousV1 -> guardTurnstile, issue #447) is wired and fails closed even without TURNSTILE_SECRET — a 401 instead means resolveAnonymous returned null before guardTurnstile ran, i.e. ANON_ID_SECRET is not yet injected into the staging Worker (issue #492 is the prerequisite for this check to pass). This is a real, expected failure until #492 lands — not evidence the Turnstile wiring is broken."
  fi
  fail "anonymous POST ${ROOT_URL}/v1/chat on staging (ANON_ACCESS_ENABLED=true) expected 403 turnstile_required, got ${status}. Unlike a 401, this status means the request did NOT hit the expected gated path at all — if this is 200, anonymous chat was served with no Turnstile challenge, which is the exact security gap this check exists to catch. Investigate worker/app.ts handleAnonymousV1 / worker/turnstile.ts guardTurnstile directly; do not assume #492 (ANON_ID_SECRET) is the cause."
}

cmd_anon_disabled_production() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch POST "${ROOT_URL}/v1/chat" "" '{}')"
  diag "${status}"
  [ "${status}" = "401" ] || fail "anonymous POST ${ROOT_URL}/v1/chat on production (ANON_ACCESS_ENABLED=false) expected 401 unauthorized, got ${status}"
  jq -e '.error.code == "unauthorized"' "${BODY_FILE}" >/dev/null || fail "production anon /v1/chat 401 body missing error.code=unauthorized"
}

# NOTE: the marker below is a structural class from apps/web/src/components/
# landing/LandingPage.tsx (`<main className="landing">`), NOT the page
# `<title>`. The `<title>Animichi</title>` meta lives on the ROOT route
# (apps/web/src/routes/__root.tsx) and renders on every page including the
# branded 404 (NotFound.tsx also literally contains the text "Animichi") and
# any SSR error boundary rendered inside the same root shell — so a plain
# `grep -qi "Animichi"` would pass even when the real landing content failed
# to render. The `landing` class only exists on LandingPage's own <main>.
cmd_web_landing() {
  : "${WEB_URL:?WEB_URL is required}"
  local status
  status="$(fetch GET "${WEB_URL}/")"
  diag "${status}"
  [ "${status}" = "200" ] || fail "GET ${WEB_URL}/ expected 200, got ${status}"
  grep -q 'class="landing"' "${BODY_FILE}" || fail "GET ${WEB_URL}/ response did not contain LandingPage's structural marker (<main class=\"landing\">) — this would also fail on a 200 SSR error page or the branded 404, which is the point of asserting on this instead of the page <title>"
}

cmd_catalog_probe() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch GET "${ROOT_URL}/catalog/public/anime-overview/1")"
  diag "${status}"
  case "${status}" in
    200)
      jq -e '.points_length | type == "number"' "${BODY_FILE}" >/dev/null \
        || fail "GET ${ROOT_URL}/catalog/public/anime-overview/1 returned 200 but body is missing the points_length field the catalog Worker always emits (see workers/catalog/src/api/anime-overview.ts) — the CATALOG binding responded, but not with catalog's own shape"
      ;;
    404)
      echo "::warning title=post-deploy catalog-probe::bangumi_id=1 returned 404 (AnimeOverviewNotFoundError) — this still proves the edge -> CATALOG service binding -> Neon round-trip completed (a DB/connectivity failure would surface as 500, not 404; see workers/catalog/src/router.ts callAnimeOverview), but confirm bangumi_id=1 is expected to be absent from this environment's seed data rather than assuming this branch is always benign"
      jq -e '. != null' "${BODY_FILE}" >/dev/null || fail "catalog probe 404 response is not valid JSON"
      ;;
    *)
      fail "GET ${ROOT_URL}/catalog/public/anime-overview/1 expected 200 or 404 (catalog reachable via the CATALOG service binding), got ${status} — a DB/connection misconfiguration surfaces as 500 here, not 404 (workers/catalog/src/router.ts only translates AnimeOverviewNotFoundError to 404; every other error rethrows)"
      ;;
  esac
}

# Data-plane connectivity probe (issue #484 P1-3): healthz only proves the
# container process is up; catalog-probe covers the Neon-backed catalog
# Worker specifically. Neither exercises the agent container's OWN Postgres
# connection (env.SUPABASE_DB_URL — despite the name, a plain asyncpg DSN;
# see apps/agent/agent/infrastructure/supabase/client.py). GET /v1/bangumi/
# popular is in PUBLIC_V1 (no auth, no LLM call, zero cost) and reads through
# that connection via BangumiRepository — a misconfigured/unreachable DSN
# there throws and surfaces as a non-200, not a silent empty success.
cmd_data_plane_probe() {
  : "${ROOT_URL:?ROOT_URL is required}"
  local status
  status="$(fetch GET "${ROOT_URL}/v1/bangumi/popular?limit=3")"
  diag "${status}"
  [ "${status}" = "200" ] || fail "GET ${ROOT_URL}/v1/bangumi/popular expected 200 (proves edge -> container -> agent Postgres [SUPABASE_DB_URL] round-trip), got ${status}"
  jq -e '.bangumi | type == "array"' "${BODY_FILE}" >/dev/null || fail "bangumi/popular response missing a bangumi array — response shape changed or the query failed in a way that didn't surface as a non-200"
  jq -e '.bangumi | length > 0' "${BODY_FILE}" >/dev/null || fail "bangumi/popular returned an empty array — either this environment's seed data is genuinely empty (adjust this check if so) or the query silently returned nothing"
}

main() {
  local cmd="${1:?usage: post-deploy-assert.sh <healthz|auth-probe|users-probe|anon-gate-staging|anon-disabled-production|web-landing|catalog-probe|data-plane-probe>}"
  case "${cmd}" in
    healthz) cmd_healthz ;;
    auth-probe) cmd_auth_probe ;;
    users-probe) cmd_users_probe ;;
    anon-gate-staging) cmd_anon_gate_staging ;;
    anon-disabled-production) cmd_anon_disabled_production ;;
    web-landing) cmd_web_landing ;;
    catalog-probe) cmd_catalog_probe ;;
    data-plane-probe) cmd_data_plane_probe ;;
    *) fail "unknown check: ${cmd}" ;;
  esac
}

main "$@"
