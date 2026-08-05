#!/usr/bin/env bash
# Behavioral tests for check-root-allowlist.sh. The pass case runs against the
# real repo tree (locking the allowlist to today's reality); the fail case runs
# against a throwaway fixture git repo in mktemp -d with the repo's top-level
# entries copied in plus one injected unallowlisted entry. Nothing is ever
# created in the real repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-root-allowlist.sh"
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

# Commits whatever the caller has staged in the fixture repo ($1).
commit_fixture() {
  git -C "$1" init -q
  git -C "$1" add .
  git -C "$1" -c user.name=test -c user.email=test@example.com commit -q -m init
}

# Runs the real script from inside repo ($1), writing combined output to $2,
# and prints the exit code for the caller to capture.
run_check() {
  local repo="$1" out="$2" rc=0
  (cd "${repo}" && bash "${CHECK_SH}") >"${out}" 2>&1 || rc=$?
  echo "${rc}"
}

list_top_entries() {
  git -C "$1" -c core.quotepath=false ls-files -z | while IFS= read -r -d '' file; do
    printf '%s\n' "${file%%/*}"
  done | sort -u
}

# Mirrors the repo's tracked top-level layout in a fixture repo (dirs keep a
# placeholder file so git actually tracks them), then injects $2 as an extra
# top-level entry ("-" for none).
build_fixture() {
  local repo="$1" extra="$2" entry
  while IFS= read -r entry; do
    if [ -d "${REPO_ROOT}/${entry}" ] && [ ! -f "${REPO_ROOT}/${entry}" ]; then
      mkdir -p "${repo}/${entry}"
      printf 'x\n' > "${repo}/${entry}/.placeholder"
    else
      printf 'x\n' > "${repo}/${entry}"
    fi
  done < <(list_top_entries "${REPO_ROOT}")
  if [ "${extra}" != "-" ]; then
    printf 'x\n' > "${repo}/${extra}"
  fi
}

# ── Case 1: the current tree must match the allowlist (locks reality) ───────
test_current_tree_passes() {
  local out=/tmp/root-allowlist-case1.out rc
  rc="$(run_check "${REPO_ROOT}" "${out}")"
  [ "${rc}" -eq 0 ] || fail_test "current repo tree must pass the allowlist, got exit ${rc}: $(cat "${out}")"
  grep -q "all top-level entries are allowlisted" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: current tree matches the allowlist"
}

# ── Case 2: copied file list without extras -> passes ───────────────────────
test_copied_list_passes() {
  local repo out=/tmp/root-allowlist-case2.out rc
  repo="$(mktemp -d)"
  build_fixture "${repo}" "-"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "fixture matching the allowlist should pass, got exit ${rc}: $(cat "${out}")"
  echo "PASS: fixture matching the allowlist passes"
}

# ── Case 3: injected fake entry -> fails, naming the entry ──────────────────
test_injected_entry_fails() {
  local repo out=/tmp/root-allowlist-case3.out rc
  repo="$(mktemp -d)"
  build_fixture "${repo}" "not-in-allowlist.txt"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "injected entry must fail the gate, got exit 0"
  grep -q "top-level entry not in allowlist: not-in-allowlist.txt" "${out}" || fail_test "output must name the offending entry: $(cat "${out}")"
  echo "PASS: injected entry fails and names the entry"
}

test_current_tree_passes
test_copied_list_passes
test_injected_entry_fails

echo "All check-root-allowlist.sh behavioral tests passed."
