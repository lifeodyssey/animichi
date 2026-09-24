# shellcheck shell=bash
# The marker arm of reset-staging-baseline.test.sh (#1781): a Prisma app marker beside the Atlas
# ledger is refused unless the owner's committed record names it, and the recorded marker's
# rebuild drops the chain's whole schema in `migrator`'s own transaction (#1949). Sourced by
# reset-staging-baseline.test.sh, which owns the harness, the container and the seeds these cases
# run on.

# #1781: a spike wrote the marker six days before the flip, and the Atlas chain's objects stayed.
new_case "a marker beside the Atlas ledger" "$MARKER $ATLAS"
run_script 1
expect "and it names the marker" yes "$(said "prisma_contract.marker space=app updated_at=2026-09-12T06:49:00Z")"
expect "and it counts what the Atlas chain left" yes "$(said "9 Atlas revisions, 3 tables in public")"
expect "and it points at the migrator's refusal" yes "$(said "atlas_leftovers_present")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

expect "the committed record names one app marker" "prisma_contract.marker space=app" "${RECORDED% updated_at=*}"

new_case "the marker the record names, beside the Atlas ledger" "$(recorded_marker '0') $ATLAS $APPROVED"
expect "and prisma_contract belongs to migrator, as staging holds it" migrator "$(owner_of prisma_contract)"
expect "and so does the marker table the drop names" migrator "$(table_owner prisma_contract marker)"
run_script 0
expect "and neonctl's connection diagnostic rode along, unread as data" yes "$(said "INFO: Connecting to the database using psql...")"
expect "and it quotes the record it acted on" yes "$(said "stale marker approved by $ROOT/infra/database-access/reset-staging-baseline.approved-marker: $RECORDED")"
expect "and it records the ledger it will drop" yes "$(said "pre-state: prisma_contract.ledger 2 rows")"
expect "and the contract it will drop" yes "$(said "pre-state: prisma_contract.contract 1 rows")"
expect "and it takes the backup branch" yes "$(backup_taken)"
expect "and the backup saw the marker schema" prisma_contract "$(cat "$CALL_LOG.backup-saw")"
expect "and the backup precedes both drops" "$(printf 'branches create\npsql migrator -f\npsql neondb_owner -f')" "$(tail -3 "$CALL_LOG")"
expect "and the marker schema is gone, with its three tables" absent "$(marker_schema)"
expect "and the ledger's sequence went with it" absent "$(relation prisma_contract.ledger_id_seq)"
expect "and the Atlas ledger is gone" absent "$(relation public.atlas_schema_revisions)"
expect "and the leftover table is gone" absent "$(relation public.bangumi)"
expect "and the approved table is gone" absent "$(relation public.sessions)"
expect "and public holds no table at all" 0 "$(public_table_count)"
expect "and the migrator can build the chain" t "$(admin "$CASE_DB" "SELECT has_schema_privilege('migrator', 'public', 'CREATE')")"

new_case "a marker one microsecond after the one the record names" "$(recorded_marker '1 microsecond') $ATLAS"
run_script 1
expect "and it refuses as though there were no record" yes "$(said "refusing reset: a Prisma app marker stands beside the Atlas ledger")"
expect "and it takes no backup" no "$(backup_taken)"
expect "and the marker schema stands, all three tables" contract,ledger,marker "$(marker_tables)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

new_case "the recorded marker, with a backup branch taken before it" "$(recorded_marker '0') $ATLAS"
BRANCH_LIST='[{"name":"staging-before-prisma-baseline","created_at":"2026-09-01T00:00:00Z"}]' run_script 1
expect "and it names the backup that cannot restore the marker" yes "$(said "was taken at 2026-09-01T00:00:00Z, before the prisma_contract writes it would have to restore")"
expect "and it takes no new backup" no "$(backup_taken)"
expect "and the marker schema stands" prisma_contract "$(marker_schema)"
expect "and nothing is dropped" bangumi "$(relation public.bangumi)"

# Every marker row is named or none is: a second space beside the recorded one is not approved.
new_case "a second space's marker beside the one the record names" "$(recorded_marker '0') $ATLAS
  INSERT INTO prisma_contract.marker VALUES ('geography', repeat('c', 64), repeat('d', 64), '$RECORDED_AT');"
run_script 1
expect "and it refuses as though there were no record" yes "$(said "refusing reset: a Prisma app marker stands beside the Atlas ledger")"
expect "and it names both rows" yes "$(said "space=app updated_at=$RECORDED_AT, prisma_contract.marker space=geography updated_at=$RECORDED_AT")"
expect "and it takes no backup" no "$(backup_taken)"

# The drop takes the ledger too, so a backup must post-date its last write, not only the marker's.
new_case "the recorded marker, with a backup branch taken before a later ledger write" "$(recorded_marker '0') $ATLAS
  INSERT INTO prisma_contract.ledger (created_at, space, migration_name) VALUES ('2026-09-13T00:00:00Z', 'app', 'late');"
BRANCH_LIST='[{"name":"staging-before-prisma-baseline","created_at":"2026-09-12T12:00:00Z"}]' run_script 1
expect "and it names the backup that cannot restore the ledger" yes "$(said "was taken at 2026-09-12T12:00:00Z, before the prisma_contract writes it would have to restore")"
expect "and the marker schema stands, all three tables" contract,ledger,marker "$(marker_tables)"

# The drop names three tables and no CASCADE: anything else in the schema is not approved, and
# Postgres refuses the schema drop, rolling the migrator's transaction back — `public`, rebuilt
# only in the owner's transaction after it, was never in it.
new_case "the recorded marker, with a fourth table in its schema" "$(recorded_marker '0') $ATLAS
  CREATE TABLE prisma_contract.unrecorded (id int); INSERT INTO prisma_contract.unrecorded VALUES (1);"
run_script 3
expect "and Postgres names what else the schema holds" yes "$(said "cannot drop schema prisma_contract because other objects depend on it")"
expect "and the three tables are back" contract,ledger,marker,unrecorded "$(marker_tables)"
expect "and public is back too" bangumi "$(relation public.bangumi)"
expect "and so is the Atlas ledger" atlas_schema_revisions "$(relation public.atlas_schema_revisions)"
