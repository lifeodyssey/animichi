#!/usr/bin/env bash
# Behavioral tests for check-e2e-promotion.sh, driven against throwaway fixture
# git repos in mktemp -d (the script resolves its root via
# `git rev-parse --show-toplevel`, so each case cd's into its own repo).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-e2e-promotion.sh"

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

# ── Case 1: clean tree (no staged spec anywhere) -> passes ─────────────────
test_clean_tree_passes() {
  local repo out=/tmp/e2e-promo-case1.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/e2e/generated" "${repo}/e2e/agent-discovered"
  printf 'gate doc\n' > "${repo}/e2e/generated/README.md"
  printf 'gate doc\n' > "${repo}/e2e/agent-discovered/README.md"
  printf 'a plan\n' > "${repo}/e2e/agent-discovered/login-plan.md"
  printf 'import { test } from "@playwright/test";\n' > "${repo}/e2e/web-404.spec.ts"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "clean tree should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "no \*.spec.ts in generated/ or agent-discovered/" "${out}" || fail_test "missing summary line: $(cat "${out}")"
  echo "PASS: clean tree (markdown plans + root spec only) passes"
}

# ── Case 2: spec committed under e2e/generated/ -> fails, names the file ───
test_generated_spec_fails() {
  local repo out=/tmp/e2e-promo-case2.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/e2e/generated"
  printf 'import { test } from "@playwright/test";\n' > "${repo}/e2e/generated/checkout.spec.ts"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "spec in generated/ must fail the gate, got exit 0"
  grep -q "e2e/generated/checkout.spec.ts" "${out}" || fail_test "output must name the violating file: $(cat "${out}")"
  echo "PASS: spec under generated/ fails and names the file"
}

# ── Case 3: spec committed under e2e/agent-discovered/ -> fails ────────────
test_agent_discovered_spec_fails() {
  local repo out=/tmp/e2e-promo-case3.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/e2e/agent-discovered"
  printf 'import { test } from "@playwright/test";\n' > "${repo}/e2e/agent-discovered/search.spec.ts"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "spec in agent-discovered/ must fail the gate, got exit 0"
  grep -q "e2e/agent-discovered/search.spec.ts" "${out}" || fail_test "output must name the violating file: $(cat "${out}")"
  echo "PASS: spec under agent-discovered/ fails and names the file"
}

# ── Case 4: spec present on disk but NOT committed (working tree only) -> passes
#    (the guard inspects the committed tree; generated work-in-progress is
#    allowed locally and by design) ───────────────────────────────────────────
test_uncommitted_spec_passes() {
  local repo out=/tmp/e2e-promo-case4.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/e2e/generated"
  printf 'gate doc\n' > "${repo}/e2e/generated/README.md"
  commit_fixture "${repo}"
  printf 'import { test } from "@playwright/test";\n' > "${repo}/e2e/generated/wip.spec.ts"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "uncommitted working-tree spec must pass, got exit ${rc}: $(cat "${out}")"
  echo "PASS: uncommitted spec in generated/ (working tree) passes"
}

# ── Case 5: no e2e/ dir at all -> passes (script must not crash) ────────────
test_no_e2e_dir_passes() {
  local repo out=/tmp/e2e-promo-case5.out rc
  repo="$(mktemp -d)"
  printf 'hello\n' > "${repo}/README.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "repo without e2e/ must pass, got exit ${rc}: $(cat "${out}")"
  echo "PASS: repo with no e2e/ directory passes"
}

test_clean_tree_passes
test_generated_spec_fails
test_agent_discovered_spec_fails
test_uncommitted_spec_passes
test_no_e2e_dir_passes

echo "All check-e2e-promotion.sh behavioral tests passed."
