#!/usr/bin/env bash
# Narrow, provable context-doc reference check (#745): every backtick path
# candidate in AGENTS.md / CLAUDE.md / .claude/rules must resolve against the
# repo root or the referencing file's directory. Replaces the agnix lint.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

TOTAL_FILES=0
TOTAL_REFS=0
TOTAL_BROKEN=0

list_context_docs() {
  git ls-files '*AGENTS.md' '*CLAUDE.md' '.claude/rules/*.md'
}

extract_candidates() {
  local file="$1"
  grep -on '`[^`]*`' "${file}" | sed 's/^\([0-9][0-9]*\):`\(.*\)`$/\1:\2/'
}

# Conservative candidate filter: no space/glob/angle/$/paren, no http prefix,
# plus four skip rules for the live-run false-positive classes:
#  (1) '@'-prefixed scoped npm packages (@animichi/contract);
#  (2) '/'-prefixed URL paths (repo refs are never written absolute);
#  (3) bare filenames — a '/' is required to judge a reference at all
#      (ci.yml is too ambiguous);
#  (4) a last path segment with no dot must resolve as a directory under
#      either base, else it is unprovable and skipped (npm subpaths like
#      drizzle-orm/pg-core, R2 prefixes like rollback-backups/).
is_candidate() {
  local c="$1" dir="$2" last
  case "$c" in
    *' '*|*'*'*|*'{'*|*'<'*|*'$'*|*'('*|[Hh][Tt][Tt][Pp]*) return 1 ;;
    '@'*|'/'*) return 1 ;;
  esac
  case "$c" in
    */*) ;;
    *) return 1 ;;
  esac
  last="${c%/}"
  last="${last##*/}"
  case "$last" in
    *.*) return 0 ;;
    *) [ -d "${ROOT}/${c}" ] || [ -d "${dir}/${c}" ] ;;
  esac
}

resolves() {
  local base="$1" cand="${2%/}"
  [ -e "${base}/${cand}" ]
}

# Gitignored candidates (build output like apps/web/.output/, generated
# routeTree.gen.ts, home paths) cannot resolve on disk in a clean checkout.
# Nested .gitignore files only match under their own directory, so the check
# must run from the repo root against BOTH resolution bases. Keep any
# trailing slash: a dir-only pattern like `.codegraph/` requires it.
gitignored() {
  git check-ignore --no-index -q "$1" 2>/dev/null
}

check_file() {
  local file="$1" dir line cand
  dir="$(dirname "${file}")"
  while IFS=: read -r line cand; do
    is_candidate "${cand}" "${dir}" || continue
    if gitignored "${cand}" || gitignored "${dir}/${cand}"; then continue; fi
    TOTAL_REFS=$((TOTAL_REFS + 1))
    resolves "${ROOT}" "${cand}" && continue
    if resolves "${dir}" "${cand}"; then continue; fi
    TOTAL_BROKEN=$((TOTAL_BROKEN + 1))
    echo "${file}:${line}: broken reference \`${cand}\`"
  done < <(extract_candidates "${file}")
}

main() {
  local file
  while read -r file; do
    TOTAL_FILES=$((TOTAL_FILES + 1))
    check_file "${file}"
  done < <(list_context_docs)
  summarize
}

summarize() {
  if [ "${TOTAL_BROKEN}" -gt 0 ]; then
    exit 1
  fi
  echo "checked ${TOTAL_FILES} files, ${TOTAL_REFS} references, all resolve"
}

main
