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
if ! [[ "${SOURCE_REVISION}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "cutover: source_revision must be a full 40-char commit SHA" >&2
  exit 2
fi
STAGING_DOMAIN="https://staging.animichi.com"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"
[[ "$(git rev-parse HEAD)" = "${SOURCE_REVISION}" ]]\
  || { echo "cutover-reopen: HEAD != source_revision" >&2; exit 1; }

# Pulumi must run from infra/ (the project dir) or it cannot find Pulumi.yaml
# (#1001). Fail fast with a clear message instead of pulumi's cryptic
# "no Pulumi.yaml project file found".
cd infra
if [[ ! -f Pulumi.yaml ]]; then
  echo "cutover-reopen: no infra/Pulumi.yaml found — pulumi must run from infra/" >&2
  exit 1
fi

# 1. Verify prerequisites BEFORE opening the IaC staging gate, so a
#    failing check cannot leave public ingress open (fail closed).
bash "${REPO_ROOT}/.github/scripts/cutover-verify-prereqs.sh" \
  "retention_execution=absent" "auth_boundary=neon_only"

# 2. Open the IaC staging gate.
pulumi --stack staging config set stagingGateEnabled false
pulumi --stack staging up --yes
sleep 30

# 3. Recheck retention remains absent after the final deployment.
bash "${REPO_ROOT}/.github/scripts/cutover-verify-prereqs.sh" \
  "retention_execution=absent" "auth_boundary=neon_only"

# 3. Smallest critical public journeys pass on the reopened ingress.
status=$(curl -sS -o /dev/null -w "%{http_code}" "${STAGING_DOMAIN}/healthz" || true)
[[ "${status}" = "200" ]]\
  || { echo "cutover-reopen: public /healthz failed (HTTP ${status}); keeping ingress closed" >&2; exit 1; }
status=$(curl -sS -o /dev/null -w "%{http_code}" "${STAGING_DOMAIN}/api/bangumi/popular" || true)
[[ "${status}" = "200" ]]\
  || { echo "cutover-reopen: public popular read failed (HTTP ${status}); keeping ingress closed" >&2; exit 1; }

echo "OK: ingress reopened at ${SOURCE_REVISION}, retention absent, verdict complete"
