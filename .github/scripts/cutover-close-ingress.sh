#!/usr/bin/env bash
# SESSION-3 cutover Phase C: close staging ingress (issue #961).
#
# STAGING-CUTOVER.md §6: set the IaC staging gate to closed, wait for the
# edge configuration to converge, and prove public external traffic cannot
# reach the application during the cut. Private service identity (the
# STAGING_GATE_TOKEN path) remains available for deployment smokes.
#
# Usage: cutover-close-ingress.sh <source_revision>

set -euo pipefail

SOURCE_REVISION="${1:?source_revision required}"

cd "$(git rev-parse --show-toplevel)"
test "$(git rev-parse HEAD)" = "${SOURCE_REVISION}" \
  || { echo "cutover-close-ingress: HEAD != source_revision" >&2; exit 1; }

# 1. Close the IaC staging gate (the `stagingGateEnabled` flag IS the gate:
#    true = WAF blocks everything except the gate token exchange path).
pulumi --stack staging config set stagingGateEnabled true
pulumi --stack staging up --yes

# 2. Wait for the edge configuration to converge.
sleep 30

# 3. Probe that public unauthenticated traffic cannot reach the app.
STAGING_DOMAIN="https://staging.animichi.com"
for _ in 1 2 3; do
  status=$(curl -sS -o /dev/null -w "%{http_code}" "${STAGING_DOMAIN}/v1/chat" \
    -X POST -H "Content-Type: application/json" -d '{}' || true)
  if [[ "${status}" != "403" && "${status}" != "429" && "${status}" != "403" ]]; then
    echo "cutover-close-ingress: public ingress not closed (HTTP ${status})" >&2
    exit 1
  fi
  sleep 10
done

# 4. The gate-token (private CI) path still answers, so deployment smokes work.
status=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "x-staging-key: ${STAGING_GATE_TOKEN:?STAGING_GATE_TOKEN required}" \
  "${STAGING_DOMAIN}/healthz" || true)
if [[ "${status}" != "200" ]]; then
  echo "cutover-close-ingress: private gate path unavailable (HTTP ${status})" >&2
  exit 1
fi

echo "OK: staging ingress closed, private gate path available"
