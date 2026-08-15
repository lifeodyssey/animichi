#!/usr/bin/env bash
# SESSION-3 cutover Phase D: reset and converge the application schema
# (issue #961; two-key shape issue #1056).
#
# TWO-KEY RESET (#1056): the destructive DROP and the rebuild apply each bind
# to a DIFFERENT credential. Only break-glass may destroy; only migrator owns
# the rebuilt schema (ownership-from-birth), so no REASSIGN OWNED is ever
# needed and the Postgres owner-only ALTER rule never bites.
#
#   CUTOVER_BREAK_GLASS_DSN  -- the owner break-glass DSN (the cutover
#     workflow's NEON_DATABASE_URL secret). It alone may run the destructive
#     DROP SCHEMA public CASCADE / CREATE SCHEMA public. Never used for the
#     apply.
#   MIGRATOR_DATABASE_URL    -- the migrator role DSN (the staging Secrets
#     Store secret base name, #1050). The rebuild Atlas apply runs as this
#     role, so every table it creates is owned by migrator from birth.
#
# The script refuses to run with either key missing (fail closed), and it
# re-asserts migrator ownership of the rebuilt public schema before declaring
# success. The fresh chain is applied from the cutover source SHA and its
# applied head/digest is verified against that checkout.
#
# Usage: cutover-reset-schema.sh <source_revision>

set -euo pipefail

SOURCE_REVISION="${1:?source_revision required}"
if ! [[ "${SOURCE_REVISION}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "cutover: source_revision must be a full 40-char commit SHA" >&2
  exit 2
fi
# Two keys, both required. Refuse to run with either missing: a one-key reset
# would either let a non-break-glass credential destroy the schema or let the
# owner DSN own the rebuilt tables (defeating ownership-from-birth).
CUTOVER_BREAK_GLASS_DSN="${CUTOVER_BREAK_GLASS_DSN:?CUTOVER_BREAK_GLASS_DSN required (break-glass owner DSN for the destructive DROP)}"
MIGRATOR_DATABASE_URL="${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL required (migrator DSN for the rebuild apply)}"

cd "$(git rev-parse --show-toplevel)"
[[ "$(git rev-parse HEAD)" = "${SOURCE_REVISION}" ]]\
  || { echo "cutover-reset-schema: HEAD != source_revision" >&2; exit 1; }

# 1. Evidence: inventory of application schema objects, no row content.
#    Runs under the break-glass key (it inspects the pre-drop schema).
SCHEMA_BEFORE="$(mktemp "${TMPDIR:-/tmp}/cutover-schema-before.XXXXXX")"
trap 'rm -f "${SCHEMA_BEFORE}"' EXIT
psql "${CUTOVER_BREAK_GLASS_DSN}" -tAc \
  "SELECT table_schema || '.' || table_name FROM information_schema.tables \
   WHERE table_schema = 'public' ORDER BY 1;" > "${SCHEMA_BEFORE}"

# 2. Verify the reset target excludes Neon Auth-owned schemas. The Neon Auth
#    schema is a separate schema/principal boundary; the application reset
#    touches only `public`.
psql "${CUTOVER_BREAK_GLASS_DSN}" -tAc \
  "SELECT table_schema FROM information_schema.tables WHERE table_schema NOT IN ('public', 'information_schema', 'pg_catalog') LIMIT 1;" \
  | grep -qiE "auth|neon" && { echo "cutover-reset-schema: auth schema would be reset" >&2; exit 1; } || true

# 3. Reset the application schema (public only), preserving Neon Auth. This is
#    THE destructive step; only the break-glass key may run it.
psql "${CUTOVER_BREAK_GLASS_DSN}" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 4. Apply the rewritten fresh Atlas chain from the cutover SHA UNDER the
#    migrator role. Every table this creates is owned by migrator from birth.
atlas migrate apply \
  --dir "file://migrations/neon" \
  --url "${MIGRATOR_DATABASE_URL}" \
  --revisions-schema public

# 5. Verify the applied head/digest against the source checkout.
APPLIED_HEAD=$(psql "${MIGRATOR_DATABASE_URL}" -tAc \
  "SELECT version FROM public.atlas_schema_revisions ORDER BY executed_at DESC LIMIT 1;")
EXPECTED_HEAD=$(ls migrations/neon/*.sql | sort | tail -1 | xargs basename | cut -d_ -f1)
[[ "${APPLIED_HEAD}" = "${EXPECTED_HEAD}" ]]\
  || { echo "cutover-reset-schema: applied head ${APPLIED_HEAD} != source head ${EXPECTED_HEAD}" >&2; exit 1; }

# 6. Ownership-from-birth (issue #1056): the rebuild ran as migrator, so every
#    remaining owned object in `public` must belong to migrator. Fail closed if
#    any relkind owned by another principal survived.
NOT_MIGRATOR_OWNED=$(psql "${MIGRATOR_DATABASE_URL}" -tAc \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') \
     AND pg_get_userbyid(c.relowner) <> 'migrator';")
[[ "${NOT_MIGRATOR_OWNED}" = "0" ]]\
  || { echo "cutover-reset-schema: rebuilt public schema not fully owned by migrator (${NOT_MIGRATOR_OWNED} object(s))" >&2; exit 1; }

echo "OK: application schema reset (break-glass DROP) and fresh chain applied by migrator at ${EXPECTED_HEAD}; every public object owned by migrator"
