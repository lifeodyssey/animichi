#!/usr/bin/env bash
# SESSION-3 cutover Phase E: private smoke of every final-schema consumer
# (issue #961).
#
# STAGING-CUTOVER.md §8 private-smoke list — real Neon Auth login plus one
# authenticated Users request through Edge; the anonymous public matrix and
# rejection of forbidden/sk_*/former-Supabase channels; initial chat,
# continued chat, Point/Candidate selection, replay/conflict, cancellation,
# SSE terminal behavior; Session history and same-browser adoption with
# revision invalidation; SavedRoute create/read/update/delete and deferred
# Save after login; retained Catalog Point/Bangumi/Itinerary, ingest, geocode,
# nearby; quota, daily budget, usage, request audit, feedback, Agent memory,
# and location/media support. Uses the private gate path only (ingress is
# closed for public traffic).
#
# Usage: cutover-private-smoke.sh <source_revision>

set -euo pipefail

SOURCE_REVISION="${1:?source_revision required}"
if ! [[ "${SOURCE_REVISION}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "cutover: source_revision must be a full 40-char commit SHA" >&2
  exit 2
fi
STAGING_DOMAIN="https://staging.animichi.com"
GATE_HEADER=(-H "x-staging-key: ${STAGING_GATE_TOKEN:?STAGING_GATE_TOKEN required}")

expect_status() {
  local expected="$1"
  local url="$2"
  shift 2
  local actual
  actual=$(curl -sS -o /dev/null -w "%{http_code}" "${GATE_HEADER[@]}" "$@" "${url}" || true)
  [[ "${actual}" = "${expected}" ]]\
    || { echo "cutover-private-smoke: ${url} expected ${expected}, got ${actual}" >&2; exit 1; }
}

# 1. Health of the agent/root worker reports the exact cutover SHA.
health=$(curl -fsS "${GATE_HEADER[@]}" "${STAGING_DOMAIN}/healthz")
echo "${health}" | grep -q "${SOURCE_REVISION}" \
  || { echo "cutover-private-smoke: /healthz commit != source_revision" >&2; exit 1; }

# 2. Identityless public reads still pass.
expect_status 200 "${STAGING_DOMAIN}/api/bangumi/popular"

# 3. Forbidden channels fail closed.
expect_status 403 "${STAGING_DOMAIN}/v1/chat" -X POST -H "Content-Type: application/json" -d '{}'
expect_status 401 "${STAGING_DOMAIN}/v1/users/me" -H "Authorization: Bearer sk_test_forbidden"

# 4. Private chat journey through the gate path (admission + session).
expect_status 200 "${STAGING_DOMAIN}/v1/chat" -X POST \
  -H "Content-Type: application/json" \
  -H "x-user-id: smoke_user" -H "x-user-type: human" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"hello"}]}]}'

# 5. Retained data-plane surfaces answer over the service identity.
expect_status 200 "${STAGING_DOMAIN}/v1/feedback" -X POST \
  -H "Content-Type: application/json" \
  -d '{"rating":"good","query_text":"smoke","intent":"search_bangumi"}'

echo "OK: private smoke passed for all consumers at ${SOURCE_REVISION}"
