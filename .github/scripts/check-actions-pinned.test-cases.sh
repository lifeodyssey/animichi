#!/usr/bin/env bash

# Cases 9-15. This file is sourced by check-actions-pinned.test.sh after its
# shared constants and helpers are defined.

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

test_tracked_deleted_file_passes() {
  local repo out=/tmp/actions-pin-case15.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/.github/workflows"
  printf '%s\n' "- uses: actions/checkout@${SHA} # v7.0.1" > "${repo}/.github/workflows/retired.yml"
  commit_fixture "${repo}"
  rm -f "${repo}/.github/workflows/retired.yml"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "tracked workflow deleted from the working tree should be ignored, got exit ${rc}: $(cat "${out}")"
  grep -q "all pinned" "${out}" || fail_test "missing summary after skipping deleted tracked workflow"
  echo "PASS: tracked workflow deleted from the working tree is ignored"
}
