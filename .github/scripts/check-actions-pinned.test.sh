#!/usr/bin/env bash
# Behavioral tests for check-actions-pinned.sh, driven against throwaway
# fixture git repos in mktemp -d (the script resolves its root via
# `git rev-parse --show-toplevel` and scans git-tracked files, so each case
# cd's into its own repo). One pass case per allowed form, one red case per
# gate behavior (tag pins, docker:// digest rule, block-scalar skipping,
# anchoring, .yaml scans).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-actions-pinned.sh"

SHA="3d3c42e5aac5ba805825da76410c181273ba90b1"
DOCKER_SHA="$(printf 'a%.0s' {1..64})"

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

# ── Case 3: docker:// pinned by @sha256:<64-hex> digest -> passes ───────────
test_docker_digest_passes() {
  local repo out=/tmp/actions-pin-case3.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' "- uses: docker://ghcr.io/animichi/some-tool:v1@sha256:${DOCKER_SHA} # v1" > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "digest-pinned docker:// use should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all pinned" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: docker:// use pinned by sha256 digest passes"
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

# ── Case 7 (red): docker:// without digest or reason comment -> fails ──────
test_docker_without_digest_fails() {
  local repo out=/tmp/actions-pin-case7.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' '- uses: docker://ghcr.io/animichi/some-tool:v1' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "docker:// without digest must fail the gate, got exit 0"
  grep -q "ci.yml:1: uses: docker://ghcr.io/animichi/some-tool:v1 — docker:// must be digest-pinned" "${out}" || fail_test "output must name file, line, and ref: $(cat "${out}")"
  echo "PASS: docker:// use without digest fails"
}

# ── Case 8 (red): `uses:` substring in a run: script is ignored; real tag violation still fails ──
test_uses_substring_in_run_ignored() {
  local repo out=/tmp/actions-pin-case8.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' \
    'steps:' \
    '  - run: echo "uses: actions/checkout@v4" > /tmp/note' \
    '  - uses: actions/checkout@v4' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "real tag-pinned use must fail the gate, got exit 0"
  grep -q "ci.yml:3: uses: actions/checkout@v4 — not pinned to a full 40-char SHA (got 'v4')" "${out}" \
    || fail_test "real violation must be named: $(cat "${out}")"
  grep -q "ci.yml:2:" "${out}" && fail_test "run: script containing 'uses:' must not be treated as an action reference: $(cat "${out}")"
  echo "PASS: uses: substring in run: script ignored; real violation still fails"
}

# ── Case 9 (red): '#' inside the docker:// ref (quoted or glued) is not a trailing comment ──
test_docker_ref_hashtag_not_comment() {
  local repo out=/tmp/actions-pin-case9.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' \
    '- uses: "docker://ghcr.io/animichi/some-tool:v1"' \
    '- uses: docker://ghcr.io/animichi/some-tool:v1#frag' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "docker:// ref carrying its own '#' must not dodge the digest requirement, got exit 0"
  grep -q 'ci.yml:1: uses: "docker://ghcr.io/animichi/some-tool:v1" — quoted value' "${out}" \
    || fail_test "quoted docker:// ref must be rejected: $(cat "${out}")"
  grep -q "ci.yml:2: uses: docker://ghcr.io/animichi/some-tool:v1#frag — docker:// must be digest-pinned" "${out}" \
    || fail_test "docker:// ref with glued '#' must still require digest pinning: $(cat "${out}")"
  echo "PASS: docker:// '#' inside the ref is not treated as a trailing comment"
}

# ── Case 10 (red): .yaml workflow files are scanned too ────────────────────
test_yaml_extension_fails() {
  local repo out=/tmp/actions-pin-case10.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' 'steps:' '- uses: actions/checkout@v4' > "${repo}/.github/workflows/ci.yaml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test ".yaml workflow with tag-pinned use must fail the gate, got exit 0"
  grep -q "ci.yaml:2: uses: actions/checkout@v4 — not pinned to a full 40-char SHA (got 'v4')" "${out}" \
    || fail_test "output must name the .yaml file: $(cat "${out}")"
  echo "PASS: .yaml workflow is scanned and tag-pinned use fails"
}

# ── Case 11: `uses:` text inside run: | and run: > literal blocks -> ignored, passes ──
test_literal_block_uses_text_ignored() {
  local repo out=/tmp/actions-pin-case11.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' \
    'steps:' \
    '  - name: echo sample workflow' \
    '    run: |' \
    '      echo "example workflow:"' \
    '      uses: actions/checkout@v4' \
    '      uses: docker://ghcr.io/animichi/some-tool:v1' \
    '  - name: folded block' \
    '    run: >' \
    '      text line' \
    '      uses: foo/bar@v1' \
    "  - uses: actions/checkout@${SHA} # v7.0.1" > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "uses: text inside literal/folded blocks must be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "1 uses" "${out}" || fail_test "only the live use after the blocks should be counted: $(cat "${out}")"
  echo "PASS: uses: text inside run: | and run: > blocks is ignored; scanning resumes after the block"
}

# ── Case 12 (red): tag-pinned `uses:` after a literal block still fails ────
test_literal_block_then_violation_fails() {
  local repo out=/tmp/actions-pin-case12.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' \
    'steps:' \
    '  - name: echo sample workflow' \
    '    run: |' \
    '      uses: actions/checkout@v4' \
    '      more block text' \
    '  - uses: actions/checkout@v4' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "real tag-pinned use after a literal block must fail the gate, got exit 0"
  grep -q "ci.yml:6: uses: actions/checkout@v4 — not pinned to a full 40-char SHA (got 'v4')" "${out}" \
    || fail_test "violation after the block must be named: $(cat "${out}")"
  grep -q "ci.yml:4:" "${out}" && fail_test "block content must not be treated as an action reference: $(cat "${out}")"
  echo "PASS: real tag-pinned use after a literal block still fails"
}

# ── Case 13: docker:// exemption — comment stating a reason passes; a bare comment fails ──
test_docker_reason_comment_exemption() {
  local repo out=/tmp/actions-pin-case13.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' '- uses: docker://ghcr.io/animichi/some-tool:v1 # cannot digest-pin: upstream registry is tag-only' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "docker:// with a reason-stating comment should pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all pinned" "${out}" || fail_test "missing one-line summary in output"
  echo "PASS: docker:// exemption accepted when the trailing comment states the reason"

  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' '- uses: docker://ghcr.io/animichi/some-tool:v1 # image is immutable' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "docker:// with a bare comment must fail the gate, got exit 0"
  grep -q "ci.yml:1: uses: docker://ghcr.io/animichi/some-tool:v1 — docker:// must be digest-pinned" "${out}" \
    || fail_test "comment without a stated reason must be rejected: $(cat "${out}")"
  echo "PASS: docker:// exemption rejected when the trailing comment states no reason"
}

# ── Case 14 (red): docker:// digest of wrong shape -> fails ────────────────
test_docker_short_digest_fails() {
  local repo out=/tmp/actions-pin-case14.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' '- uses: docker://ghcr.io/animichi/some-tool@sha256:abc123' > "${repo}/.github/workflows/ci.yml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "docker:// with a short digest must fail the gate, got exit 0"
  grep -q "ci.yml:1: uses: docker://ghcr.io/animichi/some-tool@sha256:abc123 — docker:// must be digest-pinned" "${out}" \
    || fail_test "short digest must be rejected: $(cat "${out}")"
  echo "PASS: docker:// digest shorter than 64 hex chars fails"
}

test_sha_pinned_passes
test_local_paths_pass
test_docker_digest_passes
test_commented_line_ignored
test_composite_action_checked_and_passes
test_tag_pin_fails
test_docker_without_digest_fails
test_uses_substring_in_run_ignored
test_docker_ref_hashtag_not_comment
test_yaml_extension_fails
test_literal_block_uses_text_ignored
test_literal_block_then_violation_fails
test_docker_reason_comment_exemption
test_docker_short_digest_fails

echo "All check-actions-pinned.sh behavioral tests passed."
