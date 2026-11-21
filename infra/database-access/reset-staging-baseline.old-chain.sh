# shellcheck shell=bash
# The staging reset's old-chain path: a Prisma app marker that is no node of the repository's
# migration graph, with no Atlas ledger beside it. A regenerated chain leaves staging there — the
# Prisma 8 upgrade the owner decided on 2026-11-21 changes every hash — and the migrator's Prisma
# refuses a marker outside its graph (MIGRATION.MARKER_MISMATCH) before any DDL, so no migration the
# chain carries can move it. The owner decided the same day to rebuild staging instead, since it
# holds no real user. Without the owner's dated record the path refuses, printing every marker row
# and every table in `public` with its row count; with a record of exactly those lines it rebuilds,
# under a backup of its own, dropping the whole marker schema with them. Sourced by
# reset-staging-baseline.sh, which owns the reads, the backup and the two transactions;
# reset-staging-baseline.old-chain-cases.sh drives it.

APPROVED_OLD_CHAIN="$ROOT/infra/database-access/reset-staging-baseline.approved-old-chain"
# The app space's graph, read as Prisma's planner builds it (`readMigrationsDir`, `reconstructGraph`
# and the manifest's schema, read in the rc.23 toolchain): each directory holding a `migration.json`
# is one edge, and its `from` and `to` are nodes — `from` is null on a baseline, which starts from
# no marker at all. A directory without a manifest (rc.23's `refs/`) is no edge, and an extension's
# space keeps a directory of its own beside this one. A regenerated chain keeps the manifest, with
# new hashes under the same two keys, so this reads it unchanged.
GRAPH_DIR="$ROOT/packages/pi-session-neon/migrations/app"
# Each manifest, slurped, must hold exactly one JSON value, whose non-null `from` and whose `to` are
# strings. An empty or blank file, a second value or a missing hash is no edge to skip but a graph
# that cannot be read.
GRAPH_EDGE='if length != 1 then error("not one migration edge") else .[0] end
  | (.from | values), .to | if type == "string" then . else error("not a migration edge") end'
# The printed lines: each marker row, in the stale-marker record's rendering with its hash after
# it, then each table in `public` with its rows. The marker schema's `ledger` and `contract` go with
# the marker; the refusal names them, and the rebuild's pre-state counts them.
OLD_CHAIN_MARKER_LINE="$MARKER_IDENTITY || ' core_hash=' || core_hash"
OLD_CHAIN_MARKER_ROW="$MARKER_SCHEMA\\.marker space=[a-z][a-z0-9_-]* updated_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{6})?Z core_hash=[0-9a-f]{64}"
OLD_CHAIN_TABLE_ROW='public\.[a-z_][a-z0-9_]* [0-9]+ rows'
OLD_CHAIN_APPROVED=false

# The graph's nodes, or a refusal by name: a graph that cannot be read places no marker either way.
GRAPH_NODES=""
read_graph_nodes() {
  local manifests=("$GRAPH_DIR"/*/migration.json) manifest
  [[ -f "${manifests[0]}" ]] \
    || fail "refusing reset: $GRAPH_DIR holds no migration, so the live marker cannot be placed in its graph"
  GRAPH_NODES=""
  for manifest in "${manifests[@]}"; do
    GRAPH_NODES+="$(jq -rs "$GRAPH_EDGE" "$manifest")"$'\n' \
      || fail "refusing reset: $manifest is not one migration edge, so the live marker cannot be placed in its graph"
  done
}

# Membership is exact, and decided in the shell: the marker's hash as Prisma wrote it, against each
# node. A hash that is not 64 hex characters is no node of any graph Prisma writes.
app_marker_in_graph() {
  read_graph_nodes
  query "SELECT core_hash FROM $MARKER_SCHEMA.marker WHERE space = 'app'"
  [[ "$ROWS" =~ ^[0-9a-f]{64}$ ]] && grep -qxF "$ROWS" <<<"$GRAPH_NODES"
}

describe_old_chain() {
  query "SELECT line FROM (SELECT 1 AS part, space AS key, $OLD_CHAIN_MARKER_LINE AS line
      FROM $MARKER_SCHEMA.marker
    UNION ALL SELECT 2, c.relname, $TABLE_ROWS $PUBLIC_TABLES) lines ORDER BY part, key"
}

# The refusal ends with those lines, so what follows its explanation is exactly what the owner's
# record must name.
refuse_old_chain_marker() {
  describe_old_chain
  fail "refusing reset: the Prisma app marker is no node of the repository's migration graph" \
    "($GRAPH_DIR), and no Atlas ledger stands beside it, so the migrator refuses this database" \
    "(MIGRATION.MARKER_MISMATCH) before any DDL. If the owner decides to rebuild staging, name every" \
    "line below in $APPROVED_OLD_CHAIN, with the date of that decision; the rebuild then takes a" \
    "backup branch named after the marker, drops the whole $MARKER_SCHEMA schema (marker, ledger," \
    "contract) in one transaction as migrator, and rebuilds public in a second, as neondb_owner:" \
    "$ROWS"
}

# The record is read, never interpreted: one printed line per line, so no pattern can approve a
# row it does not spell out, and a line that is not exactly one refuses the reset. Absent, or
# approving nothing, it approves nothing.
OLD_CHAIN_RECORD=""
read_old_chain_record() {
  [[ -e "$APPROVED_OLD_CHAIN" ]] || return 1
  [[ -r "$APPROVED_OLD_CHAIN" ]] || fail "refusing reset: cannot read $APPROVED_OLD_CHAIN"
  OLD_CHAIN_RECORD="$(grep -vE '^(#|$)' "$APPROVED_OLD_CHAIN" || true)"
  local malformed
  malformed="$(grep -vxE "$OLD_CHAIN_MARKER_ROW|$OLD_CHAIN_TABLE_ROW" <<<"$OLD_CHAIN_RECORD" || true)"
  [[ -z "$malformed" ]] || fail "refusing reset: $APPROVED_OLD_CHAIN names something that is not one printed line: $malformed"
  [[ -n "$OLD_CHAIN_RECORD" ]]
}

# What a matched record approves: the rows it names, under a backup named after the app marker it
# names. A retry of this rebuild reuses that branch. The Atlas rebuild's branch, or an earlier old
# chain's, predates this marker schema's last write, and backup_holds_marker would refuse it for good.
approve_old_chain() { # approve_old_chain <what the record approves>
  local hash
  hash="$(sed -nE "s/^$MARKER_SCHEMA\\.marker space=app .* core_hash=([0-9a-f]{64})\$/\\1/p" <<<"$OLD_CHAIN_RECORD")"
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || return 1
  OLD_CHAIN_APPROVED=true
  BACKUP_NAME="staging-before-rebuild-${hash:0:12}"
  echo "$1 approved by $APPROVED_OLD_CHAIN; backup=$BACKUP_NAME"
}

# The record approves the rebuild when it names every line the refusal would print, in any order.
old_chain_approved() {
  read_old_chain_record || return 1
  describe_old_chain
  [[ "$(LC_ALL=C sort -u <<<"$ROWS")" == "$(LC_ALL=C sort -u <<<"$OLD_CHAIN_RECORD")" ]] || return 1
  approve_old_chain "the old chain's rebuild"
}

# A marker without the ledger is Prisma's. While the repository's graph carries it, the migrator
# moves it forward and this is a no-op; one the graph does not carry is an old chain's, refused
# unless the owner's record names every line the refusal prints.
stranded_on_old_chain() {
  if app_marker_in_graph; then echo "skip: the staging baseline is already applied"; return 1; fi
  old_chain_approved || refuse_old_chain_marker
}

# Whether the record, rather than the Atlas path's approved rows, stands for `public`'s rows: once
# it has approved the whole rebuild, and after a half-reset — the migrator's drop committed, the
# owner's did not — when no marker schema is left and `public` is exactly what the record names.
old_chain_rows_approved() {
  [[ "$OLD_CHAIN_APPROVED" == true ]] && return 0
  read_old_chain_record || return 1
  marker_schema_exists && return 1
  query "SELECT $TABLE_ROWS $PUBLIC_TABLES"
  [[ "$(LC_ALL=C sort -u <<<"$ROWS")" == "$(grep '^public\.' <<<"$OLD_CHAIN_RECORD" | LC_ALL=C sort -u)" ]] || return 1
  approve_old_chain "a half-reset of the old chain's rebuild"
}
