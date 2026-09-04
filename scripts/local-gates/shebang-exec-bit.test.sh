#!/usr/bin/env bash
# Behavioral tests for shebang-exec-bit.sh, driven against throwaway fixture
# git repos in mktemp -d (the script resolves its root via
# `git rev-parse --show-toplevel`, so each case cd's into its own repo).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"
CHECK_SH="${REPO_ROOT}/scripts/local-gates/shebang-exec-bit.sh"

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

commit_fixture() {
  git -C "$1" init -q
  git -C "$1" add .
  git -C "$1" -c user.name=test -c user.email=test@example.com commit -q -m init
}

run_check() {
  local repo="$1" out="$2" rc=0
  (cd "${repo}" && bash "${CHECK_SH}") >"${out}" 2>&1 || rc=$?
  echo "${rc}"
}

# ── Case 1: the real repo tree must already pass (#1307's one-time chmod) ──
test_current_tree_passes() {
  local out=/tmp/shebang-exec-bit-case1.out rc
  rc="$(run_check "${REPO_ROOT}" "${out}")"
  [ "${rc}" -eq 0 ] || fail_test "current repo tree must pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all shebang'd .github/scripts and scripts .py/.sh files are executable" "${out}" \
    || fail_test "missing one-line summary in output"
  echo "PASS: current repo tree passes"
}

# ── Case 2: shebang'd fixture at mode 644 under scripts/ -> fails, names it ─
test_mode_644_fails() {
  local repo out=/tmp/shebang-exec-bit-case2.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/scripts"
  printf '#!/usr/bin/env bash\necho hi\n' >"${repo}/scripts/fixture-check.sh"
  chmod 644 "${repo}/scripts/fixture-check.sh"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"
  [ "${rc}" -ne 0 ] || fail_test "mode 644 shebang'd file must fail the gate, got exit 0"
  grep -q "shebang present but not executable: scripts/fixture-check.sh" "${out}" \
    || fail_test "output must name the offending file: $(cat "${out}")"
  rm -rf "${repo}"
  echo "PASS: shebang'd file at mode 644 fails and names the file"
}

# ── Case 3: same fixture chmod'd to 755 -> passes ───────────────────────────
test_mode_755_passes() {
  local repo out=/tmp/shebang-exec-bit-case3.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/scripts"
  printf '#!/usr/bin/env python3\nprint("hi")\n' >"${repo}/.github/scripts/fixture_check.py"
  chmod 755 "${repo}/.github/scripts/fixture_check.py"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"
  rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "mode 755 shebang'd file must pass, got exit ${rc}: $(cat "${out}")"
  echo "PASS: shebang'd file at mode 755 passes"
}

# ── Case 4: no shebang at mode 644 -> passes (rule does not apply) ─────────
test_no_shebang_passes() {
  local repo out=/tmp/shebang-exec-bit-case4.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/scripts"
  printf 'echo hi\n' >"${repo}/scripts/no-shebang.sh"
  chmod 644 "${repo}/scripts/no-shebang.sh"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"
  rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "file without a shebang must pass regardless of mode, got exit ${rc}: $(cat "${out}")"
  echo "PASS: file without a shebang at mode 644 passes"
}

test_current_tree_passes
test_mode_644_fails
test_mode_755_passes
test_no_shebang_passes

echo "All shebang-exec-bit.sh behavioral tests passed."
