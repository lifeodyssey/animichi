#!/usr/bin/env bash
# Structural checks for skeleton campaign W0 docs (no runtime behaviour).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }

test -f CONTEXT-MAP.md || fail "CONTEXT-MAP.md missing"
grep -q 'Domain model presence' CONTEXT-MAP.md || fail "CONTEXT-MAP missing domain presence table"
grep -q 'workers/catalog' CONTEXT-MAP.md || fail "CONTEXT-MAP missing catalog"

test -f docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md || fail "PATH-DELTA missing"
grep -q 'workers/jobs' docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md || fail "PATH-DELTA missing jobs row"

for f in workers/catalog/CONTEXT.md workers/users/CONTEXT.md apps/agent/CONTEXT.md \
  workers/edge/CONTEXT.md apps/web/CONTEXT.md packages/contract/CONTEXT.md \
  workers/maintenance/CONTEXT.md; do
  test -f "$f" || fail "missing $f"
done

grep -q 'no pilgrimage domain' workers/edge/CONTEXT.md || grep -qi 'Does not own' workers/edge/CONTEXT.md \
  || fail "edge CONTEXT must deny pilgrimage domain ownership"

test -f docs/superpowers/specs/2026-08-06-monorepo-target-layout.md || fail "monorepo-target-layout missing"
test -f docs/superpowers/specs/2026-08-06-structure-refactor-index.md || fail "structure-refactor-index missing"

echo "OK: skeleton W0 doc structure"
