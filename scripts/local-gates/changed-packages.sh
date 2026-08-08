#!/usr/bin/env bash
# Map the current branch's diff onto the monorepo package set, one package
# per line. Empty output means no package changed — only universal hooks run.
#
# Contract: docs/ops/local-gates.md (merged #903).
#
#   base  = origin/main (three-dot diff from the merge base); falls back to
#           HEAD^ when origin/main is not available locally. Untracked files
#           are folded in so brand-new files are routed too.
#   `all` = any path that maps to no package (root config, lockfiles, unknown
#           dirs) — the conservative fallback: hooks run the full set.
#   contract is unioned in whenever one of its consumers (agent, web, catalog,
#           users, edge, jobs) changed — contract is the cross-service source
#           of truth.
#
# Usage: changed="$(scripts/local-gates/changed-packages.sh)"
#
# Note: the mapping loop runs in the main shell (here-string input, not a
# pipeline) so its variable updates survive; and the case statement must not
# appear inside $(...), which the stock macOS bash 3.2 mis-parses.
set -euo pipefail

base=""
if git rev-parse --verify --quiet origin/main >/dev/null; then
  base="origin/main"
elif git rev-parse --verify --quiet HEAD^ >/dev/null; then
  base="HEAD^"
fi

files=""
if [ -n "$base" ]; then
  files="$(git diff --name-only "${base}...HEAD" || true)"
fi

# A here-string always appends a newline, so an empty input would read one
# empty line and misroute to `all` — guard the loop on non-empty input.
input="$(printf '%s\n%s\n' "$files" "$(git ls-files --others --exclude-standard)" | sed '/^$/d')"
packages=""
if [ -n "$input" ]; then
  while IFS= read -r path; do
    case "$path" in
      apps/agent/*) packages+="agent"$'\n' ;;
      apps/web/*) packages+="web"$'\n' ;;
      workers/catalog/*) packages+="catalog"$'\n' ;;
      workers/users/*) packages+="users"$'\n' ;;
      workers/edge/*) packages+="edge"$'\n' ;;
      workers/jobs/*) packages+="jobs"$'\n' ;;
      packages/contract/*) packages+="contract"$'\n' ;;
      infra/*) packages+="infra"$'\n' ;;
      migrations/*) packages+="db"$'\n' ;;
      .github/scripts/*) packages+="scripts"$'\n' ;;
      .github/*) packages+="ci"$'\n' ;;
      scripts/*) packages+="scripts"$'\n' ;;
      docs/*) packages+="docs"$'\n' ;;
      *) packages+="all"$'\n' ;;
    esac
  done <<< "$input"
fi

# contract is the cross-service source of truth: any consumer change implies it.
if printf '%s\n' "$packages" | grep -qE '^(agent|web|catalog|users|edge|jobs)$'; then
  packages="$(printf '%s\ncontract\n' "$packages")"
fi

printf '%s\n' "$packages" | sort -u | sed '/^$/d'
