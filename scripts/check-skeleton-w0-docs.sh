#!/usr/bin/env bash
# Structural checks for skeleton campaign W0 docs (no runtime behaviour).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }

require_file() { test -f "$1" || fail "missing file: $1"; }
require_grep() { grep -qE "$2" "$1" || fail "missing pattern in $1: $2"; }

require_file CONTEXT-MAP.md
require_grep CONTEXT-MAP.md 'Domain model presence'
require_grep CONTEXT-MAP.md 'workers/catalog'
require_grep CONTEXT-MAP.md 'No.*pilgrimage|Gateway only|\*\*No\*\*'

require_file docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md
require_grep docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md 'workers/jobs'
require_grep docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md 'migrations/neon'
require_file docs/iterations/refactor-skeleton-2026-08/GOAL.md
require_file docs/iterations/refactor-skeleton-2026-08/README.md

for f in \
  workers/catalog/CONTEXT.md \
  workers/users/CONTEXT.md \
  apps/agent/CONTEXT.md \
  workers/edge/CONTEXT.md \
  apps/web/CONTEXT.md \
  packages/contract/CONTEXT.md \
  workers/maintenance/CONTEXT.md
do
  require_file "$f"
done

require_grep workers/edge/CONTEXT.md 'no pilgrimage domain|Does not own|Gateway'
require_grep apps/web/CONTEXT.md 'no.*src/domain|Does not own|no.*domain'

require_file docs/superpowers/specs/2026-08-06-monorepo-target-layout.md
require_file docs/superpowers/specs/2026-08-06-structure-refactor-index.md
require_file docs/superpowers/specs/2026-08-06-greenfield-language-and-data-plane.md
require_file docs/adr/0002-published-language-point-bangumi-itinerary.md

echo "OK: skeleton W0 doc structure"
