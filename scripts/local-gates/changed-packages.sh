#!/usr/bin/env bash
# Map a diff onto the monorepo package set, one package per line. Empty output
# means no package changed — only universal hooks run.
#
# Contract: docs/ops/local-gates.md. Behavioral tests: changed-packages.test.sh.
#
# Input modes (first positional argument):
#   --staged   pre-commit layer: the staged tracked diff (add/modify/rename/
#              delete — `--no-renames` lists both the old and the new path of
#              a rename so both sides' packages gate) plus intentional
#              untracked inputs (`git ls-files --others`). AC1.
#   (default)  pre-push layer: merge-base-to-head. base = origin/main (three-
#              dot diff from the merge base); falls back to HEAD^ when
#              origin/main is not available locally. Untracked files are not
#              folded in: pre-push validates what would actually be pushed.
#              AC1.
#
#   `all` = any path that maps to no package (root config, lockfiles, unknown
#           dirs) — the conservative fallback: hooks run the full set.
#   Workspace members are derived from pnpm-workspace.yaml (plus EXTRA_GATE_DIRS
#           for any non-pnpm package that still needs a gate). Path buckets
#           (db, ci, scripts, docs) stay explicit. contract is unioned in
#           whenever one of its consumers (agent, web, catalog, users, edge,
#           migrator, doorbell) changed — contract is the cross-service source of truth.
#
# Usage: changed="$(scripts/local-gates/changed-packages.sh --staged)"
#
# Note: the mapping loop runs in the main shell (here-string input, not a
# pipeline) so its variable updates survive; and the case statement must not
# appear inside $(...), which the stock macOS bash 3.2 mis-parses.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workspace-packages.sh"
load_workspace_packages

staged=false
case "${1:-}" in
  --staged) staged=true ;;
  "") ;;
  *)
    printf 'usage: %s [--staged]\n' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac

files=""
input=""
# Routing fails closed: a git read failure exits non-zero with an actionable
# message rather than emitting an empty package set that could skip gates.
if [ "$staged" = true ]; then
  if ! files="$(git diff --cached --name-only --no-renames)"; then
    echo "changed-packages: failed to read the staged diff (git diff --cached) — refusing to route an empty package set that could skip gates" >&2
    exit 1
  fi
  if ! untracked="$(git ls-files --others --exclude-standard)"; then
    echo "changed-packages: failed to read the untracked inputs (git ls-files --others) — refusing to route an empty package set that could skip gates" >&2
    exit 1
  fi
  # A here-string always appends a newline, so an empty input would read one
  # empty line and misroute to `all` — guard the loop on non-empty input.
  input="$(printf '%s\n%s\n' "$files" "$untracked" | sed '/^$/d')"
else
  base=""
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    base="origin/main"
  elif git rev-parse --verify --quiet HEAD^ >/dev/null; then
    base="HEAD^"
  fi
  if [ -z "$base" ]; then
    echo "changed-packages: no merge base found (origin/main and HEAD^ are both unavailable) — refusing to route an empty package set that could skip gates" >&2
    exit 1
  fi
  if ! files="$(git diff --name-only --no-renames "${base}...HEAD")"; then
    echo "changed-packages: failed to read the merge-base diff (${base}...HEAD) — refusing to route an empty package set that could skip gates" >&2
    exit 1
  fi
  input="$(printf '%s\n' "$files" | sed '/^$/d')"
fi

route_path_bucket() {
  case "$1" in
    migrations/*) packages+="db"$'\n' ;;
    .github/scripts/*) packages+="scripts"$'\n' ;;
    .github/*) packages+="ci"$'\n' ;;
    scripts/*) packages+="scripts"$'\n' ;;
    docs/*) packages+="docs"$'\n' ;;
    *) return 1 ;;
  esac
}

route_one_path() {
  route_path_bucket "$1" && return
  match_workspace_package "$1" && { packages+="$matched_pkg"$'\n'; return; }
  packages+="all"$'\n'
}

packages=""
if [ -n "$input" ]; then
  while IFS= read -r path; do
    route_one_path "$path"
  done <<< "$input"
fi

# contract is the cross-service source of truth: any consumer change implies it.
if printf '%s\n' "$packages" | grep -qE '^(agent|web|catalog|users|edge|migrator|doorbell)$'; then
  packages="$(printf '%s\ncontract\n' "$packages")"
fi

printf '%s\n' "$packages" | sort -u | sed '/^$/d'
