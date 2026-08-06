#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
f=$(ls "$ROOT"/db/migrations/*role_matrix*.sql | head -1)
test -f "$f"
for role in catalog_svc agent_svc users_svc jobs_svc readonly; do
  grep -q "$role" "$f"
done
grep -q 'CREATE ROLE' "$f"
echo "OK: role matrix migration present ($f)"
