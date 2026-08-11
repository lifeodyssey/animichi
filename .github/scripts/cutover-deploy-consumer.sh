#!/usr/bin/env bash
# SESSION-3 cutover Phase E: deploy one consumer from the cutover source
# revision (issue #961).
#
# STAGING-CUTOVER.md §8: deploy every final-schema consumer from the exact
# `source_revision` — never a mutable branch ref. The caller verifies HEAD
# before invoking this script; each deploy reports the same SHA in health
# metadata. Edge routes deploy last, while public ingress stays closed.
#
# Usage: cutover-deploy-consumer.sh <component> <source_revision>

set -euo pipefail

COMPONENT="${1:?component required}"
SOURCE_REVISION="${2:?source_revision required}"
if ! [[ "${SOURCE_REVISION}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "cutover: source_revision must be a full 40-char commit SHA" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"
test "$(git rev-parse HEAD)" = "${SOURCE_REVISION}" \
  || { echo "cutover-deploy-consumer: HEAD != source_revision" >&2; exit 1; }

case "${COMPONENT}" in
  catalog)  CONFIG="workers/catalog/wrangler.toml"; DIR="workers/catalog" ;;
  users)    CONFIG="workers/users/wrangler.toml";   DIR="workers/users" ;;
  agent)    CONFIG="workers/edge/wrangler.toml";    DIR="." ;;
  web)      CONFIG="apps/web/wrangler.jsonc";       DIR="apps/web" ;;
  edge)     CONFIG="workers/edge/wrangler.toml";    DIR="." ;;
  *) echo "cutover-deploy-consumer: unknown component ${COMPONENT}" >&2; exit 2 ;;
esac

(
  cd "${DIR}"
  pnpm install --frozen-lockfile --ignore-scripts >/dev/null 2>&1 || true
  npx wrangler deploy -c "${CONFIG}" \
    --var SOURCE_REVISION:${SOURCE_REVISION}
)

echo "OK: ${COMPONENT} deployed from ${SOURCE_REVISION}"
