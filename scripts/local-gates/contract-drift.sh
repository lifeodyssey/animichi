#!/usr/bin/env bash
# Staged-snapshot OpenAPI drift check (#1003, AC2): byte-identical mirror of
# pipeline-contract.yml's build stage.
#
# CI emits the OpenAPI documents, `git add`s them, and fails when
# `git diff --cached` is non-empty (regeneration must be a clean tree). A local
# push can carry unrelated staged entries and staged user work, so the
# stage+check runs against a throwaway index (GIT_INDEX_FILE) derived from the
# current index: the real index is never modified, unrelated entries are
# preserved, and the comparison is always the freshly generated snapshot
# against HEAD — exactly what CI compares. A generated change that is only
# visible in the staged snapshot is caught because the check reads the index,
# not the worktree; an unstaged `git diff` would miss it.
#
# Run from the repository root (the pre-push orchestrator cds there first).
# The current index is located via `git rev-parse --git-path index` so linked
# worktrees (.git as a gitdir pointer file) work too.
# Behavioral tests: contract-drift.test.sh.
set -euo pipefail

IDX="$(git rev-parse --git-path index)"
IDX_DIR="$(mktemp -d)"
trap 'rm -rf "$IDX_DIR"' EXIT
cp "$IDX" "$IDX_DIR/index"
GIT_INDEX_FILE="$IDX_DIR/index" git add -- \
  packages/contract/openapi.json packages/contract/users-openapi.json
if ! GIT_INDEX_FILE="$IDX_DIR/index" git diff --cached --exit-code --quiet -- \
  packages/contract/openapi.json packages/contract/users-openapi.json; then
  echo "contract OpenAPI drift: regenerated documents differ from the committed snapshot — run pnpm emit:openapi and commit the regenerated files" >&2
  exit 1
fi
echo "contract OpenAPI drift: clean (regenerated documents match the committed snapshot)"
