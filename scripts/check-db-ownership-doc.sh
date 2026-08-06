#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
f="$ROOT/db/AGENTS.md"
test -f "$f"
for role in migrator catalog_svc agent_svc users_svc jobs_svc readonly; do
  grep -q "$role" "$f" || { echo "FAIL: missing role $role"; exit 1; }
done
grep -q 'Table ownership' "$f"
grep -q 'RLS stance' "$f"
echo "OK: db ownership + role matrix doc"
