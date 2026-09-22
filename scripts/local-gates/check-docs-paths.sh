#!/usr/bin/env bash
# docs/ meta-check (#913, close-out W5): every `docs/`-prefixed string a reader
# is meant to follow must resolve against the repo root — extends the AGENTS.md
# reference check's surface (which replaced the agnix lint) to code comments
# and all docs, keeping the A-3 broken-link class out of the tree.
# Skipped deliberately:
#  - docs/archive/ — read-only history (DOCS_POLICY): refs there cannot be fixed
#  - test programs — a `docs/…` string in a file whose whole job is to be
#    executed by a test runner is an input under test, not a reference a reader
#    follows. A corpus that pins the docs-asset allowlist has to name real
#    `docs/archive/**` keys to exercise the real prefix, and those keys are
#    exactly the objects DOCS_POLICY rule 7 keeps in R2 rather than in the tree
#    (#1650). The predicate is the file's NAME (`*.test.<ext>`, `*.spec.<ext>`),
#    not its directory: a non-test file that happens to live under `test/` is
#    prose and is still checked, which is the difference between this and
#    "everything under a test directory"
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
# Counted and reported rather than silent: the one exclusion in this script
# whose size tracks the tree is the test-program carve-out, and it is the one
# that could be widened until nothing is checked.
TOTAL_TEST_PROGRAMS=0

# Quoted spans (backticks / quotes) may contain spaces; bare tokens may not.
# Both passes must survive "no match" — `grep` exits 1 on it, `pipefail` makes
# that the pipeline's status, and errexit then takes the whole substitution
# subshell down. Without the guard the quoted-span pass decides the file: a file
# with no backticked `docs/` span aborts the subshell on the first pass and
# every bare token in it goes unseen.
candidates() {
  local file="$1"
  {
    grep -noE '"[^"]*docs/[^"]*"|'\''[^'\'']*docs/[^'\'']*'\''|`[^`]*docs/[^`]*`' "${file}" 2>/dev/null \
      | sed -E 's/^([0-9]+:)["'\''`]/\1/; s/["'\''`]$//' || true
    grep -noE '[^[:space:][:cntrl:]"'\''`(){}<>、，]*docs/[^[:space:][:cntrl:]"'\''`(){}<>、，]*' "${file}" 2>/dev/null || true
  } | sort -u
}

sanitize() {
  local c="$1" rest tail
  c="${c%%#*}"
  c="${c%%@*}"
  c="${c%%\?*}"
  # A `:line` suffix is one or more digits, and a glob cannot say "one or more":
  # the next pattern strips two-or-more, this case the lone trailing digit.
  c="${c%%:[0-9][0-9]*}"
  case "${c}" in
    *:[0-9]) c="${c%:[0-9]}" ;;
  esac
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
      docs/archive/*) continue ;;
      *.test.ts|*.test.tsx|*.test.mjs|*.test.rb|*.test.sh|*.spec.ts)
        TOTAL_TEST_PROGRAMS=$((TOTAL_TEST_PROGRAMS + 1)); continue ;;
    esac
    TOTAL_FILES=$((TOTAL_FILES + 1))
    check_file "${file}"
  done < "${tmp}"
  rm -f "${tmp}"
  if [ "${TOTAL_BROKEN}" -gt 0 ]; then
    exit 1
  fi
  echo "checked ${TOTAL_FILES} files, ${TOTAL_REFS} docs/ references, all resolve"
  echo "skipped ${TOTAL_TEST_PROGRAMS} test programs — their docs/ strings are fixtures, not references"
}

main
