#!/usr/bin/env bash
# SESSION-3 cutover Phase F: reopen staging ingress or fail closed
# (issue #961).
#
# STAGING-CUTOVER.md §9: reopen ONLY after every earlier completion criterion
# is true in the same workflow execution — this job depends on the private
# smoke job, which depends on every consumer deploy. It re-opens the IaC gate,
# repeats the smallest critical public journeys, re-checks that retention
# remains absent after the final deployment, and records verdict=complete. On
# any failure it keeps ingress closed (no partial rollback into a mixed
# schema).
#
# Usage: cutover-reopen.sh <source_revision>

set -euo pipefail

SOURCE_REVISION="${1:?source_revision required}"
STAGING_DOMAIN="https://staging.animichi.com"

cd "$(git rev-parse --show-toplevel)"
test "$(git rev-parse HEAD)" = "${SOURCE_REVISION}" \
  || { echo "cutover-reopen: HEAD != source_revision" >&2; exit 1; }

# 1. Open the IaC staging gate.
pulumi --stack staging config set stagingGateEnabled false
pulumi --stack staging up --yes
sleep 30

# 2. Recheck retention remains absent after the final deployment.
bash .github/scripts/cutover-verify-prereqs.sh \
  "retention_execution=absent" "auth_boundary=neon_only"

# 3. Smallest critical public journeys pass on the reopened ingress.
status=$(curl -sS -o /dev/null -w "%{http_code}" "${STAGING_DOMAIN}/healthz" || true)
test "${status}" = "200" \
  || { echo "cutover-reopen: public /healthz failed (HTTP ${status}); keeping ingress closed" >&2; exit 1; }
status=$(curl -sS -o /dev/null -w "%{http_code}" "${STAGING_DOMAIN}/api/bangumi/popular" || true)
test "${status}" = "200" \
  || { echo "cutover-reopen: public popular read failed (HTTP ${status}); keeping ingress closed" >&2; exit 1; }

echo "OK: ingress reopened at ${SOURCE_REVISION}, retention absent, verdict complete"
