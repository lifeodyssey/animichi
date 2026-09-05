#!/usr/bin/env bash
# Pre-commit oxlint for changed workspace packages (#1113).
# Packages with a lint:oxlint script are derived from the workspace set; every
# workspace package has one (#1358), so there is no exception to carry here.
set -euo pipefail

ROOT="${GATE_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"
source "$ROOT/scripts/local-gates/workspace-packages.sh"
load_workspace_packages

dir_has_oxlint_script() {
  grep -q '"lint:oxlint"' "$GATE_REPO_ROOT/$1/package.json"
}

# Universe of pre-commit oxlint targets: the derived dirs with lint:oxlint.
list_oxlint_dirs() {
  local dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    dir_has_oxlint_script "$dir" || continue
    printf '%s\n' "$dir"
  done <<< "$WORKSPACE_DIRS"
}

if [ "${1:-}" = --list ]; then
  list_oxlint_dirs
  exit 0
fi

changed="$(bash "$ROOT/scripts/local-gates/changed-packages.sh" --staged)" || exit 1

route_has() {
  printf '%s\n' "$changed" | grep -qx "$1"
}

run_dir_oxlint() {
  pnpm --filter "./$1" run lint:oxlint
}

run_changed_oxlint() {
  local dir name
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    name="${dir##*/}"
    route_has all || route_has "$name" || continue
    run_dir_oxlint "$dir"
  done <<< "$(list_oxlint_dirs)"
}

run_changed_oxlint
