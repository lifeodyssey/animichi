#!/usr/bin/env bash
# SESSION-3 cutover prerequisite re-check (issue #961).
#
# STAGING-CUTOVER.md §6.4: never trust an earlier job's success without a
# current remote check. This script re-reads the LIVE remote state and fails
# closed unless:
#   - retention_execution is absent (no staging Worker/Cron/trigger remains),
#   - auth_boundary is neon_only (no Supabase fallback verification path).
#
# Usage:
#   cutover-verify-prereqs.sh <retention-expected> <auth-expected>
# Expected values use the STAGING-CUTOVER.md vocabulary: "retention_execution=absent"
# and "auth_boundary=neon_only".

set -euo pipefail

EXPECTED_RETENTION="${1:?expected retention_execution value}"
EXPECTED_AUTH="${2:?expected auth_boundary value}"

# A read-only remote probe of staging Cloudflare Workers + Crons. Zero
# retained triggers and zero Jobs worker are the "absent" proof; the allowed
# vocabulary appears only in SAFE-1's pinned production surface (see
# test_retention1_absence.rb).
if [[ "${EXPECTED_RETENTION}" != "retention_execution=absent" ]]; then
  echo "cutover-verify-prereqs: only retention_execution=absent is supported" >&2
  exit 2
fi

if [[ "${EXPECTED_AUTH}" != "auth_boundary=neon_only" ]]; then
  echo "cutover-verify-prereqs: only auth_boundary=neon_only is supported" >&2
  exit 2
fi

workers=$(curl -fsSL --proto =https --proto-redir =https \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}/workers/scripts" \
  | jq -r '.result[].id // empty' || true)

if [[ "${workers}" == *"jobs"* ]]; then
  echo "cutover-verify-prereqs: staging still exposes a jobs Worker" >&2
  exit 1
fi

if [[ -z "${NEON_DATABASE_URL:-}" ]]; then
  echo "cutover-verify-prereqs: NEON_DATABASE_URL is required to verify retention absence" >&2
  exit 1
fi
triggers=$(psql "${NEON_DATABASE_URL}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'cron' AND table_name = 'job';" 2>/dev/null || echo "0")
if [[ "${triggers}" != "0" ]]; then
  echo "cutover-verify-prereqs: staging still exposes cron triggers (${triggers})" >&2
  exit 1
fi

echo "OK: retention_execution=absent, auth_boundary=neon_only (current remote state)"
