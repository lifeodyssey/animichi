#!/usr/bin/env bash
# docs/specs liveness (#1649, follow-up to #909's read-only sweep): a spec no
# live file names cannot be found, reviewed or superseded — it decays in place.
# The 2026-09-14 sweep found four such files, three of them describing surfaces
# that no longer exist. This gate keeps that from re-accumulating: every tracked
# file under docs/specs/ must be named by at least one tracked file outside
# docs/archive/ (read-only history is not a live reference), or be listed in
# spec-reference-exceptions.txt with the canonical owner that keeps it
# unreferenced on purpose.
#
# The file itself, docs/archive/**, this gate's own two files and the owner
# table never count as references: an exception entry must not be the reference
# that justifies what it exempts, and neither must the file's own text.
#
# Behavioral tests: check-spec-references.test.sh.
set -euo pipefail

EXCEPTIONS="scripts/local-gates/spec-reference-exceptions.txt"
SELF="scripts/local-gates/check-spec-references.sh"
SELF_TEST="scripts/local-gates/check-spec-references.test.sh"

cd "$(git rev-parse --show-toplevel)"

# The exception table has exactly one parser: this awk program. It reads the
# tracked listing once (`listing`, a variable rather than a second input file,
# so an empty listing cannot shift the parse) and then splits each entry at its
# first `|` — `substr` past the separator, not field 2, so an owner carrying a
# further `|` cannot be truncated. With `spec` empty it is a validation pass:
# every fault goes to stderr and the exit status is 1 when the table has any.
# With `spec` set it prints that entry's owner and exits 1 when the table has no
# such entry; `found` carries the answer out through the status, which the
# command substitution reads.
EXCEPTIONS_AWK='
  function fault(message) { print message > "/dev/stderr"; bad = 1 }
  BEGIN { while ((getline line < listing) > 0) tracked[line] = 1 }
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*#/ { next }
  {
    sep = index($0, "|")
    if (sep == 0) {
      fault("malformed exception entry, want <docs/specs path>|<canonical owner>: " $0)
      next
    }
    path = substr($0, 1, sep - 1)
    owner = substr($0, sep + 1)
    gsub(/^[[:space:]]+/, "", owner)
    gsub(/[[:space:]]+$/, "", owner)
    if (path !~ /^docs\/specs\//) { fault("exception entry is outside docs/specs: " $0); next }
    if (owner == "") { fault("exception entry names no canonical owner: " path); next }
    if (!(path in tracked)) { fault("exception entry is not a tracked file: " path); next }
    if (spec == path) { print owner; found = 1 }
  }
  END { if (bad) exit 1; if (spec != "" && !found) exit 1 }
'

# Set in main() before any table read: the tracked docs/specs listing the awk
# program checks entries against, so a stale entry fails closed without awk
# having to shell out to git.
LISTING=''

# Counters scan_specs maintains; the gate's own process owns them for its life,
# as the sibling docs-path gate's TOTAL_* counters do.
TOTAL_SPECS=0
UNREFERENCED_SPECS=0
JUSTIFIED_SPECS=0

# The table must be readable as a whole before any lookup: an unreadable entry
# is an exception nobody granted.
validate_exceptions() {
  [ -f "${EXCEPTIONS}" ] || return 0
  awk -v spec= -v listing="${LISTING}" "${EXCEPTIONS_AWK}" "${EXCEPTIONS}" >/dev/null
}

# Prints the canonical owner when the table exempts the spec, and returns 1 when
# it does not.
justifying_owner() {
  [ -f "${EXCEPTIONS}" ] || return 1
  awk -v spec="$1" -v listing="${LISTING}" "${EXCEPTIONS_AWK}" "${EXCEPTIONS}"
}

# A live reference is the file's basename in any tracked file except the spec
# itself, docs/archive/**, this script, this script's behavioral test and the
# owner table (whose entries would otherwise justify themselves). The match is
# literal and whole-word, so `settled.md` is not found inside `unsettled.md` or
# `settled.mdx`.
has_live_reference() {
  local hits
  hits="$(git grep -l -w -F -e "${1##*/}" -- . \
    ":(exclude)$1" ":(exclude)docs/archive" ":(exclude)${SELF}" \
    ":(exclude)${SELF_TEST}" ":(exclude)${EXCEPTIONS}")" || true
  [ -n "${hits}" ]
}

# Prints the justification and counts the spec when the owner table exempts it,
# and returns 1 when it does not.
justify_spec() {
  local owner
  owner="$(justifying_owner "$1")" || return 1
  JUSTIFIED_SPECS=$((JUSTIFIED_SPECS + 1))
  printf 'justified exception: %s (canonical owner: %s)\n' "$1" "${owner}"
}

# Prints one line for a spec that is not live-referenced: the justification when
# the owner table carries it, the failure otherwise.
judge_spec() {
  if has_live_reference "$1"; then return 0; fi
  if justify_spec "$1"; then return 0; fi
  printf '%s: no live reference — link it from a live file, archive it, or name its canonical owner in %s\n' "$1" "${EXCEPTIONS}"
  return 1
}

# Judges every spec the index lists in the list file ($1); one the working tree
# no longer has is judged like any other rather than skipped.
scan_specs() {
  local spec
  while IFS= read -r spec; do
    TOTAL_SPECS=$((TOTAL_SPECS + 1))
    judge_spec "${spec}" || UNREFERENCED_SPECS=$((UNREFERENCED_SPECS + 1))
  done < "$1"
}

# The success summary differs only in whether any spec rode an exception.
summary() {
  if [ "${JUSTIFIED_SPECS}" -gt 0 ]; then
    printf 'checked %s docs/specs files, all live-referenced or justified\n' "${TOTAL_SPECS}"
    return 0
  fi
  printf 'checked %s docs/specs files, all live-referenced\n' "${TOTAL_SPECS}"
}

report() {
  if [ "${UNREFERENCED_SPECS}" -gt 0 ]; then
    echo "${UNREFERENCED_SPECS} of ${TOTAL_SPECS} docs/specs files have no live reference"
    exit 1
  fi
  summary
}

main() {
  LISTING="$(mktemp)"
  trap 'rm -f "${LISTING}"' EXIT
  git ls-files 'docs/specs/' > "${LISTING}"
  validate_exceptions || exit 1
  scan_specs "${LISTING}"
  report
}

main
