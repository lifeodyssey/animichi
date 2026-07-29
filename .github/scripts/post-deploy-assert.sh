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

# Seconds multiplied by attempt number for retry backoff (attempt * base), so
# the total possible wait across the 4 retries in `fetch` is base*(1+2+3+4) =
# 10*base. Overridable via env ONLY so tests can shrink real wall-clock sleeps
# to a couple of seconds instead of the real ~50s budget — this is the one
# place in this script that is allowed to depend on wall-clock time at all,
# and per this repo's "mock the clock" test-quality rule
# (AGENTS.md#cross-stack-guardrails) the actual test assertions must NOT
# depend on how long that sleep took, only on how many requests were made.
# Validated as a positive integer with a safe fallback so a blank/garbage/zero
# env value can never silently turn into "no backoff at all" in a real
# deploy — the default (5) applies whenever the override is unset, empty, or
# not a positive integer.
RETRY_BACKOFF_BASE_SECONDS="${POST_DEPLOY_ASSERT_RETRY_BACKOFF_BASE_SECONDS:-5}"
case "${RETRY_BACKOFF_BASE_SECONDS}" in
  '' | *[!0-9]* | 0)
    if [ -n "${POST_DEPLOY_ASSERT_RETRY_BACKOFF_BASE_SECONDS:-}" ]; then
      echo "::warning::POST_DEPLOY_ASSERT_RETRY_BACKOFF_BASE_SECONDS='${POST_DEPLOY_ASSERT_RETRY_BACKOFF_BASE_SECONDS}' is not a positive integer — falling back to the default (5)." >&2
    fi
    RETRY_BACKOFF_BASE_SECONDS=5
    ;;
esac

# #522: a brand-new workers.dev hostname's first request(s) can come back as
# a 404 that is actually CLOUDFLARE's OWN edge response, not the deployed
# app's (observed body: `error code: 1042`) — indistinguishable from a REAL
# 404 (this app's own branded 404 page, or a genuinely broken route) by
# status code alone.
#
# The observed timeline (CI got 404 at deploy time, a human got a real 200
# probing the same URL ~2 minutes later) is CONSISTENT with a DNS/edge-
# propagation window on a first-ever deploy to this hostname, and 1042 is
# documented by Cloudflare as belonging to the "Worker script errors" family
# rather than the 5xx origin-unreachable family — but propagation is a
# HYPOTHESIS, not a confirmed root cause. The alternative worth ruling out is
# that 1042 came from something apps/web's own SSR did (e.g. a same-zone
# self-fetch during error handling — 1042 is Cloudflare's code for exactly
# that pattern), which would make this retry paper over a real intermittent
# bug instead of a one-time propagation delay. Next time this fires in CI,
# capture the full response headers (`curl -sSD -`), specifically `cf-ray`
# and `server`, before concluding again that it's "just" propagation.
#
# Do not grep the body for the literal string "error code: 1042" to detect
# this: that plaintext shape is undocumented, varies by the client's `Accept`
# header, and is specific to today's error code — a different edge-error
# family on a future first-deploy would silently bypass a hardcoded match.
# Instead, every request in this script asks for `Accept: application/json`
# (see the `fetch` args below). Cloudflare's documented error-response
# contract (https://developers.cloudflare.com/fundamentals/reference/error-responses/)
# renders ANY edge/network error it generates itself — 1xxx client/DNS-side,
# 5xx origin-side alike — as an RFC-9457-shaped JSON body carrying a
# top-level `"cloudflare_error": true` field when JSON is requested; an
# origin/application response (this app's real JSON error envelopes, or its
# branded HTML 404 — apps/web does not content-negotiate on `Accept`, so it
# renders the same HTML regardless) never emits that field. Checking
# BODY_FILE from THIS SAME request — not firing a second, separate request —
# matters: two requests to a workers.dev hostname mid-propagation can land on
# two different edge PoPs (one still stale, one already updated), so a
# second request's verdict would not actually describe the first request's
# response.
is_cloudflare_edge_error() {
  grep -q '"cloudflare_error"[[:space:]]*:[[:space:]]*true' "${BODY_FILE}"
}

# Issues a request and prints only the HTTP status code; the body lands in
# BODY_FILE for the caller to inspect. Bounded retry/backoff on TRANSPORT
# failures, Cloudflare edge errors (521-524 — "origin unreachable", the
# shape of a workers.dev DNS-propagation window or a cold container start),
# and a 404 that `is_cloudflare_edge_error` confirms (from this same
# response's body) is Cloudflare's own edge output rather than the
# application's. Never retries any OTHER ordinary application status
# (200/401/403/a real 404/…): those are real, final answers from a live app,
# not a "not ready yet" signal, and several callers below assert on non-2xx
# by design — a 404 that is NOT confirmed as Cloudflare's own is one of those
# real, final answers too (it is exactly what a genuinely broken route, or
# this app's own branded 404 page, returns).
fetch() {
  local method="$1" url="$2" auth_header="${3:-}" body="${4:-}"
  local args=(-sS -o "${BODY_FILE}" -w '%{http_code}' --connect-timeout 10 --max-time 20 -X "${method}" "${url}" -H 'Accept: application/json')
  [ -n "${auth_header}" ] && args+=(-H "Authorization: ${auth_header}")
  [ -n "${body}" ] && args+=(-H "Content-Type: application/json" -d "${body}")
  local attempt status rc retry_reason
  for attempt in 1 2 3 4 5; do
    status="$(curl "${args[@]}")" && rc=0 || rc=$?
    retry_reason=""
    case "${rc}.${status}" in
      0.521 | 0.522 | 0.523 | 0.524) retry_reason="Cloudflare edge-origin error ${status}" ;;
      [1-9]*.*) retry_reason="transport failure rc=${rc}" ;;
      0.404)
        if is_cloudflare_edge_error; then
          retry_reason="Cloudflare edge 404 (cloudflare_error:true body)"
        else
          echo "${status}"; return 0 # a real application 404 — final, do not retry
        fi
        ;;
      *) echo "${status}"; return 0 ;;
    esac
    if [ "${attempt}" -eq 5 ]; then break; fi
    echo "attempt ${attempt}/5: ${retry_reason} (status=${status:-n/a}) for ${method} ${url} — retrying (workers.dev DNS propagation / container cold start window)" >&2
    sleep $((attempt * RETRY_BACKOFF_BASE_SECONDS))
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
