#!/usr/bin/env bash
# Rebuild a staging schema stranded on the retired Atlas chain, once (#1625, spec §2.6).
#
# CD's staging job runs this on every deploy, before the migrator's preview. It acts on exactly
# one state — Atlas leftovers in `public`, rows only in tables the owner approved by name, and no
# Prisma app marker other than one the owner's record names as stale — and on every other state
# it is a named no-op or a named refusal.
# reset-staging-baseline.test.sh drives each.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAGING_YAML="$ROOT/infra/database-access/Pulumi.staging.yaml"
PRODUCTION_YAML="$ROOT/infra/database-access/Pulumi.prod.yaml"
RESET_SQL="$ROOT/infra/database-access/reset-staging-baseline.sql"
APPROVED_ROWS="$ROOT/infra/database-access/reset-staging-baseline.approved-rows"
APPROVED_MARKER="$ROOT/infra/database-access/reset-staging-baseline.approved-marker"
# The one schema identity the Prisma chain writes (#1636). A staging database that carries a
# marker and no Atlas ledger has been migrated by the chain and must not be dropped; one that
# carries none is either empty or still on the retired Atlas chain, and is what this reset exists
# for. A marker beside the ledger is neither (#1781): the migrator refuses to migrate while the
# ledger stands, so no CD migration wrote that marker, and nothing here may decide which is stale.
# Only the owner's record of that exact marker may, and then the reset drops the whole schema —
# its three tables, named in reset-staging-baseline.sql — as `migrator`, and rebuilds `public`
# without it.
MARKER_SCHEMA="prisma_contract"
ATLAS_LEDGER="public.atlas_schema_revisions"
DROP_MARKER_SCHEMA=false
# How a marker row is quoted, by the refusal and by the record alike. Microseconds are printed
# whenever they are not zero, so no two instants share a rendering.
MARKER_IDENTITY="'$MARKER_SCHEMA.marker space=' || space || ' updated_at=' || replace(to_char(
  updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US'), '.000000', '') || 'Z'"
BACKUP_NAME="staging-before-prisma-baseline"
# The role that reads staging's state and rebuilds `public`. Neon gives every role it creates
# `neon_superuser`, which reads all tables whoever owns them — and, staging proved on 2026-09-24
# (#1949), no power to drop what it does not own.
OWNER_ROLE="neondb_owner"
# The marker schema and its three tables belong to `migrator` — the Prisma chain created them as
# itself (#1915) — and `neondb_owner` is no member of `migrator`, so the drop the owner's record
# approves runs as the schema's owner: `migrator` is a Neon-API role, so neonctl reaches it as it
# reaches the owner. Two transactions, one per role, never a shared seat: granting `neondb_owner`
# membership in `migrator` would widen back the roles #1915 narrowed.
MARKER_DROP_ROLE="migrator"
PROJECT_ID=""
BRANCH_ID=""

# What the reset destroys is `public`, so that is the whole scope of the reads below. A
# relation an extension owns (PostGIS's `spatial_ref_sys`) comes back with its extension and is
# nobody's data; `atlas_schema_revisions` is the retired chain's ledger.
PUBLIC_TABLES="FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')"
MARKER_TABLES="FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = '$MARKER_SCHEMA' AND c.relkind IN ('r', 'p')"
NOT_EXTENSION="NOT EXISTS (SELECT 1 FROM pg_depend d
  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')"
ROW_COUNT="(xpath('/row/n/text()', query_to_xml(
  format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint"

fail() { printf '%s\n' "$@" >&2; exit 1; }

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
# unapplied" (the query itself ran and returned f; psql exits 1 on a failed -c statement and
# 2 on a dead connection, and neonctl propagates both). The answer lands in ROWS rather than
# on stdout: read through a command substitution, `fail` would end only that subshell. Only
# stdout lands there (#1793): neonctl announces every connection on stderr ("INFO: Connecting
# to the database using psql..."), and folded into ROWS it rode beside every row — the marker
# approval then compared the connection log against the owner's record and could never match,
# and the business-rows read took the diagnostic for an unapproved table. Stderr is quoted
# into the failure message, so "cannot confirm" still says why.
# The file outlives neither ending of a read (#1796): `fail` ends the script, and a relay that
# cannot reach stderr is a status `set -e` acts on, so a removal on the last line alone is
# skipped by both — and CD runs this on every deploy, where a state that refuses every run
# would leave one file per deploy. Each ending therefore takes the file with it: the refusal
# by `fail_unconfirmed`, the relay by its own removal, and the relay's status is what `query`
# returns so that a broken stderr still fails the run rather than passing silently.
ROWS=""
query() {
  local out err rc=0 relay=0
  err="$(mktemp)"
  out="$(staging_psql "$OWNER_ROLE" -tAc "$1" 2>"$err")" || rc=$?
  ROWS="$out"
  [[ "$rc" -eq 0 ]] || fail_unconfirmed "$err" "$out"
  cat "$err" >&2 || relay=$?
  rm -f "$err"
  return "$relay"
}

# What a read that could not be answered refuses with, and the file the read was written to:
# `fail` exits the script, so the file is read for the reason and removed here — `query`'s own
# last line is never reached on this path.
fail_unconfirmed() {
  local diagnostic="$1" partial="$2" why
  why="$(cat "$diagnostic")"
  rm -f "$diagnostic"
  fail "cannot confirm staging state: $why$partial"
}

# Matches stay line-based (`grep -qx`): what `query` relays to stderr — neonctl's connection
# notice, a psql NOTICE — never enters ROWS, so it cannot defeat a real `t`.
query_bool() {
  query "$1"
  grep -qx t <<<"$ROWS"
}

marker_schema_exists() {
  query_bool "SELECT to_regnamespace('$MARKER_SCHEMA') IS NOT NULL"
}

app_marker_present() {
  marker_schema_exists || return 1
  query_bool "SELECT EXISTS (SELECT 1 FROM $MARKER_SCHEMA.marker WHERE space = 'app')"
}

atlas_ledger_present() {
  query_bool "SELECT to_regclass('$ATLAS_LEDGER') IS NOT NULL"
}

describe_marker_beside_ledger() {
  query "SELECT (SELECT string_agg($MARKER_IDENTITY, ', ' ORDER BY space) FROM $MARKER_SCHEMA.marker)
    || '; ' || (SELECT count(*) FROM $ATLAS_LEDGER) || ' Atlas revisions, '
    || (SELECT count(*) $PUBLIC_TABLES AND $NOT_EXTENSION) || ' tables in public'"
}

refuse_marker_beside_ledger() {
  describe_marker_beside_ledger
  fail "refusing reset: a Prisma app marker stands beside the Atlas ledger ($ROWS)." \
    "The migrator refuses this database as atlas_leftovers_present, and never migrates it, while" \
    "$ATLAS_LEDGER stands, so no CD migration wrote this marker. If the owner decides it is stale," \
    "name each marker row above in $APPROVED_MARKER; the rebuild then drops the whole $MARKER_SCHEMA" \
    "schema (marker, ledger, contract) in one transaction of its own, as migrator, the schema's" \
    "owner, after its backup branch; public is rebuilt in a second transaction, as neondb_owner."
}

# The record is read, never interpreted: one marker row per line, in the rendering the refusal
# quotes. A line that is not exactly one row — no space, no instant, a pattern — refuses the reset.
APPROVED_MARKER_ROWS=""
read_approved_marker() {
  [[ -e "$APPROVED_MARKER" ]] || return 1
  [[ -r "$APPROVED_MARKER" ]] || fail "refusing reset: cannot read $APPROVED_MARKER"
  APPROVED_MARKER_ROWS="$(grep -vE '^(#|$)' "$APPROVED_MARKER" || true)"
  local malformed
  malformed="$(grep -vxE "$MARKER_SCHEMA\\.marker space=[a-z][a-z0-9_-]* updated_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{6})?Z" <<<"$APPROVED_MARKER_ROWS" || true)"
  [[ -z "$malformed" ]] || fail "refusing reset: $APPROVED_MARKER names something that is not one marker row: $malformed"
  [[ -n "$APPROVED_MARKER_ROWS" ]]
}

# The reset drops the whole marker schema, so the record must name every marker row, no more and
# no fewer (#1781); the ledger and contract tables beside them go with it, unenumerated. Absent or
# approving nothing, the record approves nothing.
stale_marker_approved() {
  read_approved_marker || return 1
  query "SELECT $MARKER_IDENTITY FROM $MARKER_SCHEMA.marker"
  [[ "$(LC_ALL=C sort -u <<<"$ROWS")" == "$(LC_ALL=C sort -u <<<"$APPROVED_MARKER_ROWS")" ]] || return 1
  DROP_MARKER_SCHEMA=true
  echo "stale marker approved by $APPROVED_MARKER: ${ROWS//$'\n'/, }"
}

# Leftovers are the ledger or any table the retired chain left for the baseline to collide with.
atlas_leftovers_present() {
  query_bool "SELECT EXISTS (SELECT 1 $PUBLIC_TABLES AND $NOT_EXTENSION)"
}

# Four states (#1781). Marker without ledger: Prisma owns it. Marker beside ledger: refused,
# unless the owner's record names that marker as stale. No marker: the Atlas chain's tables are
# what this reset exists for; none at all is a no-op.
stranded_on_atlas() {
  if app_marker_present; then
    atlas_ledger_present || { echo "skip: the staging baseline is already applied"; return 1; }
    stale_marker_approved || refuse_marker_beside_ledger
    return 0
  fi
  atlas_leftovers_present && return 0
  echo "skip: staging holds no Atlas leftovers"; return 1
}

record_pre_state() {
  query "SELECT 'pre-state: public.' || c.relname || ' ' || $ROW_COUNT || ' rows' $PUBLIC_TABLES ORDER BY c.relname"
  printf '%s\n' "$ROWS"
  [[ "$DROP_MARKER_SCHEMA" == true ]] || return 0
  query "SELECT 'pre-state: $MARKER_SCHEMA.' || c.relname || ' ' || $ROW_COUNT || ' rows' $MARKER_TABLES ORDER BY c.relname"
  printf '%s\n' "$ROWS"
}

# The record is read, never interpreted: one literal `public.<table>` per line, so no pattern
# in it can approve a table it does not spell out, and a line that is not one refuses the reset.
APPROVED=""
read_approved_rows() {
  [[ -r "$APPROVED_ROWS" ]] || fail "refusing reset: cannot read $APPROVED_ROWS"
  APPROVED="$(grep -vE '^(#|$)' "$APPROVED_ROWS" || true)"
  local malformed
  malformed="$(grep -vxE 'public\.[a-z_][a-z0-9_]*' <<<"$APPROVED" || true)"
  [[ -z "$malformed" ]] || fail "refusing reset: $APPROVED_ROWS names something that is not a table: $malformed"
}

# The owner approved dropping the rows staging held on 2026-09-18, by table (#1781). A row in any
# other table the drop would take, other than an extension's or the ledger's, refuses by name.
refuse_business_rows() {
  read_approved_rows
  query "SELECT 'public.' || c.relname $PUBLIC_TABLES
    AND $NOT_EXTENSION AND c.relname <> 'atlas_schema_revisions' AND $ROW_COUNT > 0"
  local unapproved
  unapproved="$(LC_ALL=C comm -23 <(grep . <<<"$ROWS" | LC_ALL=C sort) <(LC_ALL=C sort <<<"$APPROVED"))"
  [[ -z "$unapproved" ]] || fail "refusing reset: business rows in ${unapproved//$'\n'/, }, which $APPROVED_ROWS does not approve"
}

BACKUP_CREATED_AT=""
backup_exists() {
  BACKUP_CREATED_AT="$(npx --yes neonctl@3.6.0 branches list --project-id "$PROJECT_ID" --output json \
    | jq -r --arg name "$BACKUP_NAME" 'first(.[] | select(.name == $name) | .created_at)')"
  [[ -n "$BACKUP_CREATED_AT" ]]
}

# A backup a retried run finds is reused, but one taken before the marker schema's last write
# cannot give that write back: dropping the schema under it would be a one-way door (#1781).
MARKER_SCHEMA_LAST_WRITE="greatest((SELECT max(updated_at) FROM $MARKER_SCHEMA.marker),
  (SELECT max(created_at) FROM $MARKER_SCHEMA.ledger), (SELECT max(created_at) FROM $MARKER_SCHEMA.contract))"
backup_holds_marker() {
  [[ "$DROP_MARKER_SCHEMA" == true ]] || return 0
  [[ "$BACKUP_CREATED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9:]+)$ ]] \
    || fail "refusing reset: cannot read when $BACKUP_NAME was taken: $BACKUP_CREATED_AT"
  query_bool "SELECT '$BACKUP_CREATED_AT'::timestamptz >= $MARKER_SCHEMA_LAST_WRITE" \
    || fail "refusing reset: $BACKUP_NAME was taken at $BACKUP_CREATED_AT, before the $MARKER_SCHEMA writes it would have to restore"
}

ensure_backup() {
  if backup_exists; then backup_holds_marker; return; fi
  npx --yes neonctl@3.6.0 branches create --project-id "$PROJECT_ID" \
    --parent "$BRANCH_ID" --name "$BACKUP_NAME" --no-compute --output json >/dev/null
}

# Two transactions, one per role (#1949): the marker schema's drop runs as its owner, then the
# owner-role step rebuilds `public` without it. -1 keeps each a single transaction (audit §2.6) —
# a mid-step failure leaves nothing half-done within the step. A failure between the steps
# strands a half-reset — no marker schema, `public` untouched — and a re-run finishes that: the
# markers' absence reroutes the run through stranded_on_atlas to the leftovers path, whose reset
# is the owner's step alone, and that step is idempotent (`DROP SCHEMA IF EXISTS`). The migrator's
# step runs only when the marker schema was just confirmed present, so it never meets its own
# work done, and the reused backup's staleness check rides `DROP_MARKER_SCHEMA`, false on that
# re-run because the marker it would have to restore is already gone.
reset_schema() {
  if [[ "$DROP_MARKER_SCHEMA" == true ]]; then
    staging_psql "$MARKER_DROP_ROLE" -1 -v ON_ERROR_STOP=1 -v drop_marker_schema=true -v public_reset=false -f "$RESET_SQL"
  fi
  staging_psql "$OWNER_ROLE" -1 -v ON_ERROR_STOP=1 -v drop_marker_schema=false -v public_reset=true -f "$RESET_SQL"
}

main() {
  required NEON_API_KEY
  load_target || fail "refusing reset: staging target is invalid"
  stranded_on_atlas || return 0
  record_pre_state
  refuse_business_rows
  ensure_backup
  reset_schema
  echo "staging reset complete; backup=$BACKUP_NAME"
}

# Sourced, it only defines the functions above, which is how workers/edge/test drives them one
# at a time.
[[ "${BASH_SOURCE[0]}" != "$0" ]] || main "$@"
