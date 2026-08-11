#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
f="$ROOT/db/AGENTS.md"
test -f "$f"
# Require dedicated headings so a casual mention of a role name is not enough.
grep -qE '^## Table ownership' "$f" || { echo "FAIL: missing Table ownership heading"; exit 1; }
grep -qE '^## Intended role matrix' "$f" || { echo "FAIL: missing Intended role matrix heading"; exit 1; }
grep -qE '^### RLS stance' "$f" || { echo "FAIL: missing RLS stance heading"; exit 1; }
for role in migrator catalog_svc agent_svc users_svc readonly; do
  # Role must appear in a table cell-ish line under the matrix section
  grep -qE "\\*\\*${role}\\*\\*|\\\`${role}\\\`" "$f" || { echo "FAIL: missing role token $role"; exit 1; }
done
# Ownership table must name the three primary services
for svc in catalog agent users; do
  grep -qE "\\*\\*${svc}\\*\\*" "$f" || { echo "FAIL: missing owner service $svc"; exit 1; }
done
echo "OK: db ownership + role matrix doc"
