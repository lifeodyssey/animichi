#!/usr/bin/env bash
# Behavioral tests for check-actions-pinned.sh, driven against throwaway
# fixture git repos in mktemp -d (the script resolves its root via
# `git rev-parse --show-toplevel` and scans git-tracked files, so each case
# cd's into its own repo). One pass case per allowed form, two red cases.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-actions-pinned.sh"

SHA="3d3c42e5aac5ba805825da76410c181273ba90b1"

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

# Runs the real script from inside the fixture repo ($1), writing combined
# output to $2, and prints the exit code for the caller to capture.
run_check() {
  local repo="$1" out="$2" rc=0
  (cd "${repo}" && bash "${CHECK_SH}") >"${out}" 2>&1 || rc=$?
  echo "${rc}"
}

# ── Case 1: SHA-pinned workflow `uses:` -> passes ──────────────────────────
test_sha_pinned_passes() {
  local repo out=/tmp/actions-pin-case1.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' "- uses: actions/checkout@${SHA} # v7.0.1" > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "SHA-pinned use should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all pinned" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: SHA-pinned workflow use passes"
}

# ── Case 2: local `./` action/workflow paths are allowed -> passes ─────────
test_local_paths_pass() {
  local repo out=/tmp/actions-pin-case2.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows" "${repo}/.github/actions/setup"
  printf '%s\n' 'steps:' '- uses: ./.github/actions/setup' '- uses: ./.github/workflows/reusable-ts-ci.yml' > "${repo}/.github/workflows/ci.yml"
  printf '%s\n' 'name: setup' 'runs:' '  using: composite' '  steps:' '    - run: echo hi' > "${repo}/.github/actions/setup/action.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "local ./ paths should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all pinned" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: local ./ action and workflow paths pass"
}

# ── Case 3: docker:// with a trailing comment is allowed -> passes ─────────
test_docker_with_comment_passes() {
  local repo out=/tmp/actions-pin-case3.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' '- uses: docker://ghcr.io/animichi/some-tool:v1 # pinned by digest, cannot SHA-pin docker://' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "docker:// with comment should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all pinned" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: docker:// use with trailing comment passes"
}

# ── Case 4: commented-out tag-pinned example -> ignored, passes ────────────
test_commented_line_ignored() {
  local repo out=/tmp/actions-pin-case4.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' 'steps:' '  # - name: Setup runtime (example)' '  #   uses: actions/setup-example@v1' "  - uses: actions/checkout@${SHA} # v7.0.1" > "${repo}/.github/workflows/codeql.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "commented-out tag pin should be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "1 uses" "${out}" || fail_test "only the live use should be counted: $(cat "${out}")"
  echo "PASS: commented-out tag-pinned use is ignored"
}

# ── Case 5: composite action under .github/actions/**/*.yml -> passes ──────
test_composite_action_checked_and_passes() {
  local repo out=/tmp/actions-pin-case5.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/actions/setup"
  printf '%s\n' "- uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10" > "${repo}/.github/actions/setup/action.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "SHA-pinned composite action use should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all pinned" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: composite action under .github/actions/ is scanned and passes"
}

# ── Case 6 (red): tag-pinned `uses:` -> fails, naming file + line + ref ────
test_tag_pin_fails() {
  local repo out=/tmp/actions-pin-case6.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' 'steps:' '- uses: actions/checkout@v4' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "tag-pinned use must fail the gate, got exit 0"
  grep -q "ci.yml:2: uses: actions/checkout@v4 — not pinned to a full 40-char SHA (got 'v4')" "${out}" || fail_test "output must name file, line, and ref: $(cat "${out}")"
  echo "PASS: tag-pinned use fails and names file + line + ref"
}

# ── Case 7 (red): docker:// without a comment -> fails ─────────────────────
test_docker_without_comment_fails() {
  local repo out=/tmp/actions-pin-case7.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' '- uses: docker://ghcr.io/animichi/some-tool:v1' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "docker:// without comment must fail the gate, got exit 0"
  grep -q "ci.yml:1: uses: docker://ghcr.io/animichi/some-tool:v1 — docker:// cannot be SHA-pinned" "${out}" || fail_test "output must name file, line, and ref: $(cat "${out}")"
  echo "PASS: docker:// use without comment fails"
}

test_sha_pinned_passes
test_local_paths_pass
test_docker_with_comment_passes
test_commented_line_ignored
test_composite_action_checked_and_passes
test_tag_pin_fails
test_docker_without_comment_fails

echo "All check-actions-pinned.sh behavioral tests passed."
