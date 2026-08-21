#!/usr/bin/env bash
# #1050 staging: owner GRANT so migrator can DDL on public. Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
YAML="$ROOT/infra/neon-secrets/Pulumi.staging.yaml"
SQL="$ROOT/infra/neon-secrets/grant-migrator-ddl.sql"

require_key() {
  [[ -n "${NEON_API_KEY:-}" ]] || { echo "NEON_API_KEY is required" >&2; exit 1; }
}

yaml_value() {
  sed -n "s/^  animichi-neon-secrets:${1}: //p" "$YAML"
}

apply_sql() {
  local project branch
  project="$(yaml_value neonProjectId)"
  branch="$(yaml_value neonBranchId)"
  if [[ -z "$project" || -z "$branch" ]]; then
    echo "Failed to read neonProjectId/neonBranchId from $YAML" >&2
    exit 1
  fi
  npx --yes neonctl@3.6.0 psql "$branch" --project-id "$project" --role-name neondb_owner \
    --database-name neondb -- -v ON_ERROR_STOP=1 -f "$SQL"
}

require_key
apply_sql
