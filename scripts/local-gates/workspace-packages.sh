#!/usr/bin/env bash
# Derive the workspace package set from pnpm-workspace.yaml (#1113).
# Sourced by changed-packages.sh and pre-push.sh; not standalone.
#
# A workspace glob includes a directory only when it contains package.json
# (pnpm's rule). EXTRA_GATE_DIRS registers non-pnpm packages that still
# need a gate; empty today because apps/agent is already under apps/*.
GATE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE_REPO_ROOT="${GATE_REPO_ROOT:-$(cd "$GATE_LIB_DIR/../.." && pwd)}"
WORKSPACE_YAML="${GATE_WORKSPACE_YAML:-$GATE_REPO_ROOT/pnpm-workspace.yaml}"
EXTRA_GATE_DIRS=""
WORKSPACE_DIRS=""
# Consumed by callers that source this file (pre-push.sh, changed-packages.sh);
# export documents that cross-file contract for shellcheck (SC2034).
export WORKSPACE_NAMES=""
export matched_pkg=""

require_workspace_yaml() {
  [ -f "$WORKSPACE_YAML" ] && return 0
  echo "changed-packages: missing $WORKSPACE_YAML — refusing to derive the package set" >&2
  return 1
}

workspace_globs() {
  require_workspace_yaml || return 1
  awk '/^packages:/{p=1;next} p&&/^[^[:space:]]/{exit}
    p&&/^[[:space:]]*-/{gsub(/^[[:space:]]*-[[:space:]]*/,"");gsub(/"/,"");sub(/[[:space:]]*#.*$/,"");if($0!="")print}' \
    "$WORKSPACE_YAML"
}

workspace_expand_star() {
  local prefix="$1" dir
  for dir in "$GATE_REPO_ROOT/$prefix"/*; do
    [ -f "$dir/package.json" ] || continue
    printf '%s\n' "$prefix/${dir##*/}"
  done
}

# Skip a listed dir with no package.json (pnpm's rule). A `&&` miss would
# return 1 under set -e and abort the rest of the set.
workspace_expand_literal() {
  if [ -f "$GATE_REPO_ROOT/$1/package.json" ]; then
    printf '%s\n' "$1"
  fi
}

workspace_expand_glob() {
  case "$1" in
    *\*) workspace_expand_star "${1%/\*}" ;;
    *) workspace_expand_literal "$1" ;;
  esac
}

collect_workspace_dirs() {
  local glob
  while IFS= read -r glob; do
    [ -n "$glob" ] || continue
    workspace_expand_glob "$glob"
  done <<< "$(workspace_globs)"
  printf '%s\n' "$EXTRA_GATE_DIRS" | sed '/^$/d'
}

load_workspace_packages() {
  WORKSPACE_DIRS="$(collect_workspace_dirs | sort -u | sed '/^$/d')"
  [ -n "$WORKSPACE_DIRS" ] || {
    echo "changed-packages: derived package set is empty — refusing to route" >&2
    return 1
  }
  WORKSPACE_NAMES="$(printf '%s\n' "$WORKSPACE_DIRS" | sed 's|.*/||' | sort -u)"
}

match_workspace_package() {
  matched_pkg=""
  local dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    case "$1" in
      "$dir"/*|"$dir") matched_pkg="${dir##*/}"; return 0 ;;
    esac
  done <<< "$WORKSPACE_DIRS"
  return 1
}
