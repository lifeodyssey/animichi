#!/usr/bin/env bash
# Rebuild a staging schema stranded on the retired Atlas chain, once (#1625, spec §2.6).
#
# CD's staging job runs this on every deploy, before the migrator's preview. It acts on exactly
# one state — no Prisma app marker, Atlas leftovers in `public`, no business rows — and on every
# other state it is a named no-op or a named refusal. reset-staging-baseline.test.sh drives each.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAGING_YAML="$ROOT/infra/database-access/Pulumi.staging.yaml"
PRODUCTION_YAML="$ROOT/infra/database-access/Pulumi.prod.yaml"
RESET_SQL="$ROOT/infra/database-access/reset-staging-baseline.sql"
# The one schema identity the Prisma chain writes (#1636). A staging database that already
# carries a marker has been migrated by the chain and must not be dropped; one that carries none
# is either empty or still on the retired Atlas chain, and is what this reset exists for.
MARKER_SCHEMA="prisma_contract"
BACKUP_NAME="staging-before-prisma-baseline"
# The role that performs the drop is the one that reads what it would drop. Neon gives every
# role it creates `neon_superuser`, which reads all tables whoever owns them.
OWNER_ROLE="neondb_owner"
PROJECT_ID=""
BRANCH_ID=""

# What the reset destroys is `public`, so that is the whole scope of the reads below. A
# relation an extension owns (PostGIS's `spatial_ref_sys`) comes back with its extension and is
# nobody's data; `atlas_schema_revisions` is the retired chain's ledger.
PUBLIC_TABLES="FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')"
NOT_EXTENSION="NOT EXISTS (SELECT 1 FROM pg_depend d
  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')"
ROW_COUNT="(xpath('/row/n/text()', query_to_xml(
  format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text::bigint"

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
# unapplied" (the query itself ran and returned f). The answer lands in ROWS rather than on
# stdout: read through a command substitution, `fail` would end only that subshell.
ROWS=""
query() {
  ROWS="$(staging_psql "$OWNER_ROLE" -tAc "$1" 2>&1)" || fail "cannot confirm staging state: $ROWS"
}

# Success-path match stays line-based (`grep -qx`): stderr is folded into ROWS for the
# failure message above, so an incidental psql NOTICE must not defeat a real `t`.
query_bool() {
  query "$1"
  grep -qx t <<<"$ROWS"
}

marker_schema_exists() {
  query_bool "SELECT to_regnamespace('$MARKER_SCHEMA') IS NOT NULL"
}

baseline_applied() {
  marker_schema_exists || return 1
  query_bool "SELECT EXISTS (SELECT 1 FROM $MARKER_SCHEMA.marker WHERE space = 'app')"
}

# Leftovers are the ledger or any table the retired chain left for the baseline to collide with.
atlas_leftovers_present() {
  query_bool "SELECT EXISTS (SELECT 1 $PUBLIC_TABLES AND $NOT_EXTENSION)"
}

record_pre_state() {
  query "SELECT 'pre-state: public.' || c.relname || ' ' || $ROW_COUNT || ' rows' $PUBLIC_TABLES ORDER BY c.relname"
  printf '%s\n' "$ROWS"
}

# The owner approved rebuilding an empty staging (spec §2.6); a row in any table the drop would
# take, other than an extension's or the ledger's, means that premise no longer holds.
refuse_business_rows() {
  query "SELECT string_agg('public.' || c.relname, ', ' ORDER BY c.relname) $PUBLIC_TABLES
    AND $NOT_EXTENSION AND c.relname <> 'atlas_schema_revisions' AND $ROW_COUNT > 0"
  [[ -z "$ROWS" ]] || fail "refusing reset: business rows in $ROWS"
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
  staging_psql "$OWNER_ROLE" -1 -v ON_ERROR_STOP=1 -f "$RESET_SQL"
}

main() {
  required NEON_API_KEY
  load_target || fail "refusing reset: staging target is invalid"
  if baseline_applied; then echo "skip: the staging baseline is already applied"; return 0; fi
  if ! atlas_leftovers_present; then echo "skip: staging holds no Atlas leftovers"; return 0; fi
  record_pre_state
  refuse_business_rows
  ensure_backup
  reset_schema
  echo "staging reset complete; backup=$BACKUP_NAME"
}

main "$@"
