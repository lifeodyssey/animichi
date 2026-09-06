#!/usr/bin/env bash
# docs/ meta-check (#913, close-out W5): every `docs/`-prefixed string in
# tracked files must resolve against the repo root — extends the AGENTS.md
# reference check's surface (which replaced the agnix lint) to code comments
# and all docs, keeping the A-3 broken-link class out of the tree.
# Skipped deliberately:
#  - docs/archive/ — read-only history (DOCS_POLICY): refs there cannot be fixed
#  - */*.test.sh under the gate directories — behavioral fixtures must
#    contain broken refs on purpose
#  - URL tokens (https://x/...docs/..., host.tld/docs/...) — external docs
#  - globs / templates / quoted prose with spaces that do not resolve
#  - extensionless non-directory tails (branch names like docs/feat-x)
# Bash 3.2 (macOS system bash) corrupts its heap on nested while-read loops
# fed by process substitutions (outer file loop reads from a temp file) and on
# `[[ =~ ]]` regex evaluation in a UTF-8 locale — matching stays glob-only.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

TOTAL_FILES=0
TOTAL_REFS=0
TOTAL_BROKEN=0

# Quoted spans (backticks / quotes) may contain spaces; bare tokens may not.
candidates() {
  local file="$1"
  {
    grep -noE '"[^"]*docs/[^"]*"|'\''[^'\'']*docs/[^'\'']*'\''|`[^`]*docs/[^`]*`' "${file}" 2>/dev/null \
      | sed -E 's/^([0-9]+:)["'\''`]/\1/; s/["'\''`]$//'
    grep -noE '[^[:space:][:cntrl:]"'\''`(){}<>、，]*docs/[^[:space:][:cntrl:]"'\''`(){}<>、，]*' "${file}" 2>/dev/null
  } | sort -u
}

sanitize() {
  local c="$1" rest tail
  c="${c%%#*}"
  c="${c%%@*}"
  c="${c%%\?*}"
  c="${c%%:[0-9][0-9]*}"
  while [[ "${c}" == ../* ]]; do c="${c#../}"; done
  while [ -n "${c}" ] && [[ "${c}" != [A-Za-z0-9_./-]* ]]; do c="${c#?}"; done
  while [ -n "${c}" ] && [[ "${c}" != *[A-Za-z0-9_./-] ]]; do c="${c%?}"; done
  case "${c}" in
    *[A-Za-z0-9]=docs/*) c="${c#*=}" ;;
  esac
  case "${c}" in
    *.*.)
      rest="${c%.}"
      tail="${rest##*/}"
      case "${tail}" in
        *.*) c="${rest}" ;;
      esac
      ;;
  esac
  printf '%s' "$c"
}

# Candidate filter: URLs and hostname-prefixed tokens are external docs;
# a quoted span with a space only counts when it resolves; a last segment
# with no dot must be a directory under the root, else unprovable (branch
# names, truncated prose).
is_candidate() {
  local c="$1" last
  case "$c" in
    *'*'*|*'{'*|*'<'*|*'$'*|*'('*|*'['*|[Hh][Tt][Tt][Pp]*|*://*) return 1 ;;
    *' '*) [ -e "${ROOT}/${c}" ] || return 1 ;;
    *[A-Za-z0-9]/docs/*) return 1 ;;
  esac
  last="${c%/}"
  last="${last##*/}"
  case "${last}" in
    *.*) return 0 ;;
    *) [ -d "${ROOT}/${c}" ] ;;
  esac
}

resolves() {
  local c="$1" real
  [ -e "${ROOT}/${c}" ] || return 1
  real="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${ROOT}/${c}")"
  case "${real}" in
    "${ROOT}"|"${ROOT}"/*) return 0 ;;
  esac
  return 1
}

check_file() {
  local file="$1" line cand
  while IFS= read -r entry; do
    line="${entry%%:*}"
    cand="$(sanitize "${entry#*:}")"
    is_candidate "${cand}" || continue
    TOTAL_REFS=$((TOTAL_REFS + 1))
    if ! resolves "${cand}"; then
      TOTAL_BROKEN=$((TOTAL_BROKEN + 1))
      echo "${file}:${line}: broken docs/ reference \`${cand}\`"
    fi
  done < <(candidates "${file}")
}

main() {
  local file tmp
  tmp="$(mktemp)"
  git ls-files > "${tmp}"
  while IFS= read -r file; do
    case "${file}" in
      docs/archive/*|.github/scripts/*.test.sh|scripts/local-gates/*.test.sh) continue ;;
    esac
    TOTAL_FILES=$((TOTAL_FILES + 1))
    check_file "${file}"
  done < "${tmp}"
  rm -f "${tmp}"
  if [ "${TOTAL_BROKEN}" -gt 0 ]; then
    exit 1
  fi
  echo "checked ${TOTAL_FILES} files, ${TOTAL_REFS} docs/ references, all resolve"
}

main
