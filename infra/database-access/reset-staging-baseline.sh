#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAGING_YAML="$ROOT/infra/database-access/Pulumi.staging.yaml"
PRODUCTION_YAML="$ROOT/infra/database-access/Pulumi.prod.yaml"
RESET_SQL="$ROOT/infra/database-access/reset-staging-baseline.sql"
BASELINE_VERSION="20260826000005"
BACKUP_NAME="staging-before-${BASELINE_VERSION}-baseline"
PROJECT_ID=""
BRANCH_ID=""

required() {
  [[ -n "${!1:-}" ]] || { echo "$1 is required" >&2; exit 1; }
}

yaml_value() {
  local yaml="$1" key="$2"
  sed -n "s/^  animichi-neon-secrets:${key}: //p" "$yaml"
}

load_target() {
  local production_branch
  PROJECT_ID="$(yaml_value "$STAGING_YAML" neonProjectId)"
  BRANCH_ID="$(yaml_value "$STAGING_YAML" neonBranchId)"
  production_branch="$(yaml_value "$PRODUCTION_YAML" neonBranchId)"
  [[ -n "$PROJECT_ID" && -n "$BRANCH_ID" && -n "$production_branch" ]] || return 1
  [[ "$BRANCH_ID" != "$production_branch" ]] || return 1
}

staging_psql() {
  local role="$1"
  shift
  npx --yes neonctl@3.6.0 psql "$BRANCH_ID" --project-id "$PROJECT_ID" \
    --role-name "$role" --database-name neondb -- "$@"
}

ledger_exists() {
  staging_psql migrator -tAc \
    "SELECT to_regclass('public.atlas_schema_revisions') IS NOT NULL" | grep -qx t
}

baseline_applied() {
  ledger_exists || return 1
  staging_psql migrator -tAc \
    "SELECT EXISTS (SELECT 1 FROM public.atlas_schema_revisions WHERE version = '$BASELINE_VERSION' AND applied >= total)" | grep -qx t
}

backup_exists() {
  npx --yes neonctl@3.6.0 branches list --project-id "$PROJECT_ID" --output json \
    | jq -e --arg name "$BACKUP_NAME" 'any(.[]; .name == $name)' >/dev/null
}

ensure_backup() {
  if backup_exists; then return 0; fi
  npx --yes neonctl@3.6.0 branches create --project-id "$PROJECT_ID" \
    --parent "$BRANCH_ID" --name "$BACKUP_NAME" --no-compute --output json >/dev/null
}

reset_schema() {
  staging_psql neondb_owner -v ON_ERROR_STOP=1 -f "$RESET_SQL"
}

main() {
  required NEON_API_KEY
  load_target || { echo "refusing reset: staging target is invalid" >&2; exit 1; }
  if baseline_applied; then echo "staging baseline already applied"; return 0; fi
  ensure_backup
  reset_schema
  echo "staging reset complete; backup=$BACKUP_NAME"
}

main "$@"
