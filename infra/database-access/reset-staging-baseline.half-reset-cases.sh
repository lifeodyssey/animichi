# shellcheck shell=bash
# The half-reset arm of reset-staging-baseline.test.sh (#1949): what the owner's step dying after
# the migrator's drop has committed strands, and the re-run that finishes it. The fail-owner flag
# is the harness stub's — a flag beside the call log naming the run whose second transaction dies
# — and this file owns the case that drives it. Sourced by reset-staging-baseline.test.sh, which
# owns the harness, the container and the seeds these cases run on.

# #1949: the reset is one transaction per role now, and the failure the card names — the owner's
# step dying after the migrator's drop has committed — leaves a half-reset. A re-run finishes it:
# with no marker schema left, the re-run takes the leftovers path, whose reset is the owner's
# step alone, and the backup the failed run took is reused, not taken again.
new_case "a half-reset: the owner's step failed after the migrator's drop" "$(recorded_marker '0') $ATLAS $APPROVED"
touch "$CALL_LOG.fail-owner"
run_script 3
expect "and the migrator's drop stands committed" absent "$(marker_schema)"
expect "and public is not yet rebuilt" atlas_schema_revisions "$(relation public.atlas_schema_revisions)"
BRANCH_LIST='[{"name":"staging-before-prisma-baseline","created_at":"2026-09-24T00:00:00Z"}]' run_script 0
expect "and the re-run leaves no marker schema" absent "$(marker_schema)"
expect "and public is empty" 0 "$(public_table_count)"
expect "and the re-run reused the backup, taking no second" 1 "$(backups_taken)"
expect "and the migrator can build the chain" t "$(admin "$CASE_DB" "SELECT has_schema_privilege('migrator', 'public', 'CREATE')")"
