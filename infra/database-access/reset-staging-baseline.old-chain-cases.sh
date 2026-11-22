# shellcheck shell=bash
# The old-chain arm of reset-staging-baseline.test.sh: a Prisma app marker that is no node of the
# committed migration graph, with no Atlas ledger — the state a regenerated chain leaves staging in.
# It is refused, printing every marker row and every table in `public` with its row count, unless
# the owner's record names each line; then the rebuild takes a backup named after that marker,
# drops the chain's schema as `migrator` and rebuilds `public` as `neondb_owner`, and every later
# run is a named no-op. Sourced by reset-staging-baseline.test.sh, which owns the harness, the
# container and the seeds.

# An old chain's head, which no committed migration starts or ends at, and an earlier node of the
# committed graph, which the migrator moves forward.
OLD_HASH="$(printf 'e%.0s' {1..64})"
OLD_AT="2026-11-20T03:55:12.345678Z"
OLD_BACKUP="staging-before-rebuild-${OLD_HASH:0:12}"
CHAIN_FIRST="$(jq -r .to "$(printf '%s\n' "$ROOT"/packages/pi-session-neon/migrations/app/*/migration.json | head -1)")"
# The directory of the edge into the committed head, the edge today's marker stands at.
HEAD_STEP="$(basename "$(dirname "$(printf '%s\n' "$ROOT"/packages/pi-session-neon/migrations/app/*/migration.json | tail -1)")")"
# What staging's `public` holds since the chain built it (#1915): the chain's tables, migrator's, in
# the schema the September rebuild recreated as neondb_owner's, with rows in a table the 2026-09-18
# approval never named — so the Atlas path's approved rows would refuse them.
CHAIN_PUBLIC="GRANT USAGE, CREATE ON SCHEMA public TO migrator WITH GRANT OPTION;
  SET ROLE migrator;
  CREATE TABLE public.works (id text PRIMARY KEY); INSERT INTO public.works VALUES ('w1'), ('w2');
  CREATE TABLE public.sessions (id text);
  RESET ROLE;"
OLD_CHAIN="$(prisma_contract "$OLD_HASH" "$OLD_AT" 0) $CHAIN_PUBLIC"
# What the refusal prints for that state, last, and so what the owner's record names.
OLD_LINES="prisma_contract.marker space=app updated_at=$OLD_AT core_hash=$OLD_HASH
public.sessions 0 rows
public.works 2 rows"

record_of() { # record_of <lines>: the owner's dated record of them, in a file of the case's own
  printf '# Approved on 2026-11-21: rebuild staging.\n%s\n' "$1" > "$WORK/record-$CASE_DB"
  echo "$WORK/record-$CASE_DB"
}

new_case "an old chain's marker, with no record" "$OLD_CHAIN"
run_script 1
expect "and it refuses by name" yes "$(said "refusing reset: the Prisma app marker is no node of the repository's migration graph")"
expect "and it ends with the marker row and every table in public with its rows" "$OLD_LINES" "$(tail -3 <<<"$OUT")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and the marker schema stands" prisma_contract "$(marker_schema)"
expect "and nothing is dropped" works "$(relation public.works)"

new_case "an old chain's marker, with a record one row off" "$OLD_CHAIN"
run_script_recorded 1 "$(record_of "${OLD_LINES/works 2 rows/works 1 rows}")"
expect "and it refuses as though there were no record" yes "$(said "refusing reset: the Prisma app marker is no node")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and nothing is dropped" works "$(relation public.works)"

# The Atlas rebuild's own branch, taken in September, is older than every write the chain made since;
# reused, it would refuse this rebuild for good, so this one takes a backup named after its marker.
new_case "an old chain's marker, with a record naming every printed line" "$OLD_CHAIN"
expect "and public's tables belong to migrator, as the chain built them" migrator "$(table_owner public works)"
RECORD="$(record_of "$OLD_LINES")"
BRANCH_LIST='[{"name":"staging-before-prisma-baseline","created_at":"2026-09-19T00:00:00Z"}]' run_script_recorded 0 "$RECORD"
expect "and it quotes the record it acted on" yes "$(said "the old chain's rebuild approved by $RECORD; backup=$OLD_BACKUP")"
expect "and it records the ledger it will drop" yes "$(said "pre-state: prisma_contract.ledger 2 rows")"
expect "and it takes a backup of its own" 1 "$(backups_taken)"
expect "and the backup saw the marker schema" prisma_contract "$(cat "$CALL_LOG.backup-saw")"
expect "and the backup precedes both drops" "$(printf 'branches create\npsql migrator -f\npsql neondb_owner -f')" "$(tail -3 "$CALL_LOG")"
expect "and the marker schema is gone" absent "$(marker_schema)"
expect "and public holds no table, migrator's included" 0 "$(public_table_count)"
expect "and the migrator can build the chain" t "$(admin "$CASE_DB" "SELECT has_schema_privilege('migrator', 'public', 'CREATE')")"
expect "and it names the backup it took" yes "$(said "staging reset complete; backup=$OLD_BACKUP")"
run_script 0
expect "and the run after it is a named no-op" yes "$(said "skip: staging holds no Atlas leftovers")"
admin "$CASE_DB" "$(prisma_contract "$CHAIN_HEAD" 2026-11-22T00:00:00Z 0)" >/dev/null
run_script 0
expect "and once the migrator has applied the chain, so is every run" yes "$(said "skip: the staging baseline is already applied")"
expect "and no run after the rebuild took a second backup" 1 "$(backups_taken)"

new_case "a marker at an earlier node of the committed graph" "$(prisma_contract "$CHAIN_FIRST" 2026-09-24T00:00:00Z 0) $CHAIN_PUBLIC"
run_script 0
expect "and it is the migrator's to move forward: a named no-op" yes "$(said "skip: the staging baseline is already applied")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and the chain's table stands" works "$(relation public.works)"

# A manifest the graph cannot read is a refusal by name, not an edge to skip. Skipped, the emptied
# edge into today's head would make today's marker look like an old chain's, and the run would offer
# the owner's rebuild record for the wrong reason.
new_case "today's marker, with the manifest of the edge into it emptied" "$(prisma_contract "$CHAIN_HEAD" 2026-11-20T03:55:00Z 0) $CHAIN_PUBLIC"
GRAPH="$WORK/graph-$CASE_DB"
cp -R "$ROOT/packages/pi-session-neon/migrations/app" "$GRAPH"
: > "$GRAPH/$HEAD_STEP/migration.json"
run_script_recorded 1 "$WORK/no-record-$CASE_DB" "$GRAPH"
expect "and it names the manifest it cannot read" yes "$(said "refusing reset: $GRAPH/$HEAD_STEP/migration.json is not one migration edge")"
expect "and the marker is not taken for an old chain's" no "$(said "no node of the repository's migration graph")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and the marker schema stands" prisma_contract "$(marker_schema)"

# Staging's marker on 2026-11-22 is the rc.9 chain's head. The Prisma rc.24 upgrade rewrote every
# stored contract, so no committed edge names that hash, and the owner's rebuild is the way out. The
# committed graph has to place it as an old chain's; a manifest the reader cannot parse would refuse
# for the graph instead, and no record could clear that.
STAGING_MARKER=efbac76665a59889ae66de0502ef143733f844ce2545017c54dfd4a8ff1e27c5
new_case "staging's rc.9 marker against the committed graph" "$(prisma_contract "$STAGING_MARKER" "$OLD_AT" 0) $CHAIN_PUBLIC"
run_script 1
expect "and it refuses it as an old chain's marker" yes "$(said "refusing reset: the Prisma app marker is no node of the repository's migration graph")"
expect "and every committed manifest is one edge" no "$(said "is not one migration edge")"
expect "and it takes no backup" no "$(backup_taken)"

# The ledger decides first (#1781), whatever the graph says.
new_case "an old chain's marker beside the Atlas ledger" "$(prisma_contract "$OLD_HASH" "$OLD_AT" 0) $ATLAS"
run_script 1
expect "and the ledger's refusal is the one it gives" yes "$(said "refusing reset: a Prisma app marker stands beside the Atlas ledger")"
expect "and not the old chain's" no "$(said "no node of the repository's migration graph")"
expect "and it takes no backup" no "$(backup_taken)"

new_case "an old chain's marker, with its backup taken before the marker's last write" "$OLD_CHAIN"
BRANCH_LIST="[{\"name\":\"$OLD_BACKUP\",\"created_at\":\"2026-11-01T00:00:00Z\"}]" run_script_recorded 1 "$(record_of "$OLD_LINES")"
expect "and it names the backup that cannot restore the marker" yes "$(said "$OLD_BACKUP was taken at 2026-11-01T00:00:00Z, before the prisma_contract writes it would have to restore")"
expect "and it takes no new backup" no "$(backup_taken)"
expect "and the marker schema stands" prisma_contract "$(marker_schema)"

# The owner's step dies after the migrator's drop has committed (#1949's failure, on this path): the
# re-run finds no marker and the chain's tables, which the Atlas path's approved rows refuse, and
# the record's `public` lines are what let it finish, reusing the backup the failed run took.
new_case "an old chain's half-reset: the owner's step failed after the migrator's drop" "$OLD_CHAIN"
RECORD="$(record_of "$OLD_LINES")"
touch "$CALL_LOG.fail-owner"
run_script_recorded 3 "$RECORD"
expect "and the migrator's drop stands committed" absent "$(marker_schema)"
expect "and public is not yet rebuilt" works "$(relation public.works)"
TAKEN="[{\"name\":\"$OLD_BACKUP\",\"created_at\":\"2026-11-21T00:00:00Z\"}]"
BRANCH_LIST="$TAKEN" run_script 1
expect "and without the record, the Atlas path refuses the chain's rows" yes "$(said "refusing reset: business rows in public.works")"
BRANCH_LIST="$TAKEN" run_script_recorded 0 "$RECORD"
expect "and with it, the re-run names the half-reset it finishes" yes "$(said "a half-reset of the old chain's rebuild approved by $RECORD; backup=$OLD_BACKUP")"
expect "and public is empty" 0 "$(public_table_count)"
expect "and the re-run reused the backup, taking no second" 1 "$(backups_taken)"
