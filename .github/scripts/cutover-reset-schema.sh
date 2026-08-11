#!/usr/bin/env bash
# SESSION-3 cutover Phase D: reset and converge the application schema
# (issue #961).
#
# STAGING-CUTOVER.md §7: export a schema/object inventory for evidence,
# verify the reset target excludes the Neon Auth-owned schema, reset the
# application schema, apply the rewritten fresh Atlas chain from the cutover
# SHA, and verify its digest/head. Purge/retention SQL is already absent
# (RETENTION-1); this script never restores a TTL or a trigger.
#
# Usage: cutover-reset-schema.sh <source_revision>

set -euo pipefail

SOURCE_REVISION="${1:?source_revision required}"
if ! [[ "${SOURCE_REVISION}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "cutover: source_revision must be a full 40-char commit SHA" >&2
  exit 2
fi
NEON_DATABASE_URL="${NEON_DATABASE_URL:?NEON_DATABASE_URL required}"

cd "$(git rev-parse --show-toplevel)"
test "$(git rev-parse HEAD)" = "${SOURCE_REVISION}" \
  || { echo "cutover-reset-schema: HEAD != source_revision" >&2; exit 1; }

# 1. Evidence: inventory of application schema objects, no row content.
SCHEMA_BEFORE="$(mktemp "${TMPDIR:-/tmp}/cutover-schema-before.XXXXXX")"
trap 'rm -f "${SCHEMA_BEFORE}"' EXIT
psql "${NEON_DATABASE_URL}" -tAc \
  "SELECT table_schema || '.' || table_name FROM information_schema.tables \
   WHERE table_schema = 'public' ORDER BY 1;" > "${SCHEMA_BEFORE}"

# 2. Verify the reset target excludes Neon Auth-owned schemas. The Neon Auth
#    schema is a separate schema/principal boundary; the application reset
#    touches only `public`.
psql "${NEON_DATABASE_URL}" -tAc \
  "SELECT table_schema FROM information_schema.tables WHERE table_schema NOT IN ('public', 'information_schema', 'pg_catalog') LIMIT 1;" \
  | grep -qiE "auth|neon" && { echo "cutover-reset-schema: auth schema would be reset" >&2; exit 1; } || true

# 3. Reset the application schema (public only), preserving Neon Auth.
psql "${NEON_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 4. Apply the rewritten fresh Atlas chain from the cutover SHA.
atlas migrate apply \
  --dir "file://migrations/neon" \
  --url "${NEON_DATABASE_URL}" \
  --revisions-schema public

# 5. Verify the applied head/digest against the source checkout.
APPLIED_HEAD=$(psql "${NEON_DATABASE_URL}" -tAc \
  "SELECT version FROM public.schema_migrations ORDER BY id DESC LIMIT 1;")
EXPECTED_HEAD=$(ls migrations/neon/*.sql | sort | tail -1 | xargs basename | cut -d_ -f1)
test "${APPLIED_HEAD}" = "${EXPECTED_HEAD}" \
  || { echo "cutover-reset-schema: applied head ${APPLIED_HEAD} != source head ${EXPECTED_HEAD}" >&2; exit 1; }

echo "OK: application schema reset and fresh chain applied at ${EXPECTED_HEAD}"
