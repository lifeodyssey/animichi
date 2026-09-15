#!/usr/bin/env bash
# Behavioral tests for check-spec-references.sh against throwaway fixture git
# repos (the script resolves its root through `git rev-parse --show-toplevel`).
# Each case builds its own repo, runs the real script, and asserts the exit
# status plus the file or owner the output names. Fixture specs are deliberately
# unreferenced: the gate excludes its own two files, so this test is not the
# reference that would make them pass. A case returns non-zero at its first
# failed assertion, so a failure never also prints that case's PASS line; the
# driver counts it and runs the rest.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-spec-references.sh"
failures=0

fail() { printf 'FAIL: %s\n' "$1" >&2; }

# fixture: a repo with one live doc, one archived doc, and the real gate copied
# to the path it excludes from its own search. Prints the repo path.
fixture() {
  local repo
  repo="$(mktemp -d)"
  mkdir -p "${repo}/docs/specs" "${repo}/docs/archive/specs" "${repo}/scripts/local-gates"
  cp "${CHECK_SH}" "${repo}/scripts/local-gates/check-spec-references.sh"
  printf 'Live notes.\n' > "${repo}/docs/notes.md"
  printf 'Archived notes.\n' > "${repo}/docs/archive/specs/old.md"
  printf '%s' "${repo}"
}

commit_fixture() {
  git -C "$1" init -q
  git -C "$1" add .
  git -C "$1" -c user.name=test -c user.email=test@example.com commit -q -m init
}

# run_check <repo> <out>: runs the real gate inside the fixture, prints its exit.
run_check() {
  local rc=0
  (cd "$1" && bash scripts/local-gates/check-spec-references.sh) >"$2" 2>&1 || rc=$?
  printf '%s' "${rc}"
}

assert_status() { [ "$1" = "$2" ] || { fail "$3: expected exit $2, got $1: $(cat "$4")"; return 1; }; }

assert_contains() { grep -qF "$2" "$3" || { fail "$1: expected '$2' in: $(cat "$3")"; return 1; }; }

write_spec() { printf '# Spec\n' > "$1/$2"; }

# ── Case 1: a live reference passes, and the scan reaches all of docs/specs/ ─
case_live_reference_passes() {
  local repo out rc
  repo="$(fixture)"
  mkdir -p "${repo}/docs/specs/plan"
  write_spec "${repo}" "docs/specs/settled.md"
  write_spec "${repo}" "docs/specs/plan/iter-0.md"
  printf '<!doctype html><title>map</title>\n' > "${repo}/docs/specs/map.html"
  printf 'Follow docs/specs/plan/iter-0.md and map.html; see settled.md.\n' > "${repo}/docs/notes.md"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case1.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 0 "live reference" "${out}" || return 1
  assert_contains "live reference" "checked 3 docs/specs files, all live-referenced" "${out}" || return 1
  printf 'PASS: a live basename reference passes, nested and non-markdown specs included\n'
}

# ── Case 2: a reference from docs/archive/ is history, not a live reference ──
case_archive_reference_fails() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/retired.md"
  printf 'Superseded: docs/specs/retired.md.\n' > "${repo}/docs/archive/specs/old.md"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case2.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 1 "archive-only reference" "${out}" || return 1
  assert_contains "archive-only reference" "docs/specs/retired.md: no live reference" "${out}" || return 1
  printf 'PASS: an archive-only reference does not count and the file is named\n'
}

# ── Case 3: an exception entry naming its canonical owner justifies the file ─
case_owner_exception_passes() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/kept.md"
  printf 'docs/specs/kept.md|workers/catalog/AGENTS.md\n' > "${repo}/scripts/local-gates/spec-reference-exceptions.txt"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case3.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 0 "owner exception" "${out}" || return 1
  assert_contains "owner exception" \
    "justified exception: docs/specs/kept.md (canonical owner: workers/catalog/AGENTS.md)" "${out}" || return 1
  assert_contains "owner exception" "checked 1 docs/specs files, all live-referenced or justified" "${out}" || return 1
  printf 'PASS: a named owner justifies an unreferenced spec, and the summary says so\n'
}

# ── Case 4: an exception with no owner is refused rather than granted ────────
case_ownerless_exception_fails() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/kept.md"
  printf 'docs/specs/kept.md|  \n' > "${repo}/scripts/local-gates/spec-reference-exceptions.txt"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case4.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 1 "ownerless exception" "${out}" || return 1
  assert_contains "ownerless exception" "names no canonical owner: docs/specs/kept.md" "${out}" || return 1
  printf 'PASS: an exception without an owner fails closed\n'
}

# ── Case 5: a stale exception entry is a failure, not a silent pass ──────────
case_stale_exception_fails() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/kept.md"
  printf 'docs/specs/gone.md|docs/notes.md\n' > "${repo}/scripts/local-gates/spec-reference-exceptions.txt"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case5.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 1 "stale exception" "${out}" || return 1
  assert_contains "stale exception" "is not a tracked file: docs/specs/gone.md" "${out}" || return 1
  printf 'PASS: an exception for an untracked path fails closed\n'
}

# ── Case 6: a malformed entry is refused (the table is not free-form prose) ──
case_malformed_exception_fails() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/kept.md"
  printf 'docs/specs/kept.md owner omitted\n' > "${repo}/scripts/local-gates/spec-reference-exceptions.txt"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case6.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 1 "malformed exception" "${out}" || return 1
  assert_contains "malformed exception" "malformed exception entry" "${out}" || return 1
  printf 'PASS: a malformed exception entry fails closed\n'
}

# ── Case 7: the spec itself, the gate and the gate's test are not references ─
case_excluded_files_are_not_references() {
  local repo out rc
  repo="$(fixture)"
  printf '# docs/specs/selfish.md mentions its own name\n' > "${repo}/docs/specs/selfish.md"
  printf '\n# docs/specs/selfish.md\n' >> "${repo}/scripts/local-gates/check-spec-references.sh"
  printf '# docs/specs/selfish.md\n' > "${repo}/scripts/local-gates/check-spec-references.test.sh"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case7.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 1 "self and gate text" "${out}" || return 1
  assert_contains "self and gate text" "docs/specs/selfish.md: no live reference" "${out}" || return 1
  printf 'PASS: self-mentions, the gate text and the gate test never justify a spec\n'
}

# ── Case 8: an exception outside docs/specs/ is refused ─────────────────────
case_out_of_tree_exception_fails() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/kept.md"
  printf 'docs/notes.md|README.md\n' > "${repo}/scripts/local-gates/spec-reference-exceptions.txt"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case8.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 1 "outside docs/specs" "${out}" || return 1
  assert_contains "outside docs/specs" "is outside docs/specs: docs/notes.md" "${out}" || return 1
  printf 'PASS: an exception for a path outside docs/specs fails closed\n'
}

# ── Case 9: a basename matches literally and as a whole word ────────────────
case_basename_matches_literally_and_whole() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/spec.v2.md"
  printf 'Superseded variant: spec-v2.md, xspec.v2.md and spec.v2.mdx.\n' > "${repo}/docs/notes.md"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case9.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 1 "literal basename" "${out}" || return 1
  assert_contains "literal basename" "docs/specs/spec.v2.md: no live reference" "${out}" || return 1
  printf 'PASS: a basename is not matched by a regex, a substring or a longer name\n'
}

# ── Case 10: an owner keeps every separator after the first ─────────────────
case_owner_keeps_later_separators() {
  local repo out rc
  repo="$(fixture)"
  write_spec "${repo}" "docs/specs/kept.md"
  printf 'docs/specs/kept.md|docs/ops/local-gates.md|#1649\n' > "${repo}/scripts/local-gates/spec-reference-exceptions.txt"
  commit_fixture "${repo}"
  out=/tmp/spec-refs-case10.out; rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  assert_status "${rc}" 0 "owner with separator" "${out}" || return 1
  assert_contains "owner with separator" "(canonical owner: docs/ops/local-gates.md|#1649)" "${out}" || return 1
  printf 'PASS: an owner may carry a further separator without being truncated\n'
}

case_live_reference_passes || failures=$((failures + 1))
case_archive_reference_fails || failures=$((failures + 1))
case_owner_exception_passes || failures=$((failures + 1))
case_ownerless_exception_fails || failures=$((failures + 1))
case_stale_exception_fails || failures=$((failures + 1))
case_malformed_exception_fails || failures=$((failures + 1))
case_excluded_files_are_not_references || failures=$((failures + 1))
case_out_of_tree_exception_fails || failures=$((failures + 1))
case_basename_matches_literally_and_whole || failures=$((failures + 1))
case_owner_keeps_later_separators || failures=$((failures + 1))

[ "${failures}" -eq 0 ] || exit 1
echo "All check-spec-references.sh behavioral tests passed."
