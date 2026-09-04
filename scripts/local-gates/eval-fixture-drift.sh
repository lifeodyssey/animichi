#!/usr/bin/env bash
# Staged-snapshot eval-fixture drift check (#1299): the committed TS fixtures
# must be what the Python exporter writes today.
#
# `packages/eval/fixtures/` is generated from the canonical datasets in
# `apps/agent/src/animichi/tests/eval/datasets/`. A case added there without a
# re-export would leave the TS round trip proving a stale contract. The caller
# (`gate_eval`, and CI through the same function) runs
# `packages/eval/scripts/export-fixtures.sh` first; this script only compares,
# exactly as contract-drift.sh does for the OpenAPI documents.
#
# The stage+check runs against a throwaway index (GIT_INDEX_FILE) copied from
# the current one: the real index is never modified, unrelated staged entries
# are preserved, and the comparison is always the freshly generated snapshot
# against HEAD. Reading the index rather than the worktree is what catches a
# regenerated change that is only visible staged.
#
# Run from the repository root (the pre-push orchestrator cds there first).
# Behavioral tests: eval-fixture-drift.test.sh.
set -euo pipefail

FIXTURES="packages/eval/fixtures"

IDX="$(git rev-parse --git-path index)"
IDX_DIR="$(mktemp -d)"
trap 'rm -rf "$IDX_DIR"' EXIT
cp "$IDX" "$IDX_DIR/index"
GIT_INDEX_FILE="$IDX_DIR/index" git add -A -- "$FIXTURES"
if ! GIT_INDEX_FILE="$IDX_DIR/index" git diff --cached --exit-code --quiet -- "$FIXTURES"; then
  echo "eval fixture drift: the re-exported datasets differ from the committed fixtures — run bash packages/eval/scripts/export-fixtures.sh and commit the result" >&2
  exit 1
fi
echo "eval fixture drift: clean (re-exported datasets match the committed fixtures)"
