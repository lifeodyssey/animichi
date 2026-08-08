#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
f=$(ls "$ROOT"/migrations/neon/*role_matrix*.sql | head -1)
test -f "$f"
for role in catalog_svc agent_svc users_svc jobs_svc readonly; do
  grep -q "$role" "$f"
done
grep -q 'CREATE ROLE' "$f"
grep -q 'pg_get_serial_sequence' "$f"
grep -q 'GRANT USAGE, SELECT ON SEQUENCE' "$f"
grep -q "'public.cluster_version'" "$f"
grep -q "'public.conversation_messages'" "$f"
echo "OK: role matrix migration present with SERIAL sequence grants ($f)"
