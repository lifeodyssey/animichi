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

fail() { echo "$*" >&2; exit 1; }

required() {
  [[ -n "${!1:-}" ]] || fail "$1 is required"
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

# audit §2.6: a failed psql connection or a permission error previously produced the same
# empty stdout as a successful query answering "false" — both fell through `grep -qx t` to
# "not applied" and triggered `DROP SCHEMA CASCADE`. Capture staging_psql's own exit status
# so "cannot confirm" (fail closed, refuse the reset) is distinguishable from "confirmed
# unapplied" (the query itself ran and returned f).
query_bool() {
  local output
  output="$(staging_psql migrator -tAc "$1" 2>&1)" || fail "cannot confirm staging state: $output"
  # Success-path match stays line-based (`grep -qx`): stderr is folded into $output for
  # the failure message above, so an incidental psql NOTICE must not defeat a real `t`.
  grep -qx t <<<"$output"
}

ledger_exists() {
  query_bool "SELECT to_regclass('public.atlas_schema_revisions') IS NOT NULL"
}

baseline_applied() {
  ledger_exists || return 1
  query_bool "SELECT EXISTS (SELECT 1 FROM public.atlas_schema_revisions WHERE version = '$BASELINE_VERSION' AND applied >= total)"
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
  # -1: run the reset SQL's three statements as a single transaction (audit §2.6) — a
  # mid-script failure must not leave the schema dropped but not yet recreated/granted.
  staging_psql neondb_owner -1 -v ON_ERROR_STOP=1 -f "$RESET_SQL"
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
