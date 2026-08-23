#!/usr/bin/env bash
# Resolve the affected package set for the PR Verification matrix.
#
# The local changed-package router intentionally reads origin/main or HEAD^.
# CI has an authoritative base/head pair in the pull_request payload, so this
# wrapper uses that pair and preserves the same workspace-derived routing
# rules. Unknown and repository-level paths expand to every deterministic gate.
set -euo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"
ROOT="${PR_VERIFICATION_ROOT:-$(git rev-parse --show-toplevel)}"
WORKSPACE_LIB="${PR_VERIFICATION_WORKSPACE_LIB:-$ROOT/scripts/local-gates/workspace-packages.sh}"

usage() {
  printf 'usage: %s <base-sha> <head-sha>\n' "${BASH_SOURCE[0]}" >&2
  exit 2
}

is_sha() {
  [[ "$1" =~ ^[0-9a-fA-F]{40}$ ]]
}

require_revision() {
  git -C "$ROOT" rev-parse --verify --quiet "$1^{commit}" >/dev/null || {
    printf 'pr-verification-route: revision is unavailable: %s\n' "$1" >&2
    exit 1
  }
}

all_packages() {
  {
    printf '%s\n' "$WORKSPACE_NAMES"
    printf '%s\n' db docs
  } | sort -u | sed '/^$/d'
}

add_package() {
  packages+="$1"$'\n'
}

route_workspace_path() {
  if match_workspace_package "$1"; then
    add_package "$matched_pkg"
  else
    route_all=true
  fi
}

route_path() {
  case "$1" in
    .github/*|scripts/*) route_all=true ;;
    migrations/*) add_package db ;;
    docs/*) add_package docs ;;
    *) route_workspace_path "$1" ;;
  esac
}

route_consumers_to_contract() {
  if printf '%s\n' "$packages" | grep -qE '^(agent|web|catalog|users|edge|migrator|doorbell)$'; then
    packages+="contract"$'\n'
  fi
}

[ "$#" -eq 2 ] || usage
is_sha "$BASE_SHA" || { printf 'pr-verification-route: invalid base SHA\n' >&2; exit 2; }
is_sha "$HEAD_SHA" || { printf 'pr-verification-route: invalid head SHA\n' >&2; exit 2; }
require_revision "$BASE_SHA"
require_revision "$HEAD_SHA"

export GATE_REPO_ROOT="$ROOT"
# shellcheck source=../../scripts/local-gates/workspace-packages.sh
source "$WORKSPACE_LIB"
load_workspace_packages

if ! files="$(git -C "$ROOT" diff --name-only --no-renames "$BASE_SHA...$HEAD_SHA")"; then
  printf 'pr-verification-route: failed to read diff for %s...%s\n' "$BASE_SHA" "$HEAD_SHA" >&2
  exit 1
fi
packages=""
route_all=false
matched_pkg=""
if [ -z "$files" ]; then
  route_all=true
else
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    route_path "$path"
  done <<< "$files"
fi

if [ "$route_all" = true ]; then
  result="$(all_packages)"
else
  route_consumers_to_contract
  result="$(printf '%s\n' "$packages" | sort -u | sed '/^$/d')"
fi

[ -n "$result" ] || {
  printf 'pr-verification-route: resolved package set is empty; refusing to skip verification\n' >&2
  exit 1
}
printf '%s\n' "$result"
