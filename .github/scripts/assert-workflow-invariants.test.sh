#!/usr/bin/env bash
# Behavioral tests for assert-workflow-invariants.sh, driven against throwaway
# fixture dirs in mktemp -d (the script takes the workflows dir as its first
# argument, so fixtures need no git plumbing). Mirrors the pass-case plus
# one-failing-fixture-per-check structure of check-root-allowlist.test.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT_SH="${SCRIPT_DIR}/assert-workflow-invariants.sh"

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

# Runs the real script against the fixture dir ($1), writing combined output
# to $2, and prints the exit code for the caller to capture.
run_assert() {
  local dir="$1" out="$2" rc=0
  bash "${ASSERT_SH}" "${dir}" >"${out}" 2>&1 || rc=$?
  echo "${rc}"
}

# ── Green: fully compliant pipeline passes all four checks ──────────────────
# Exercises the parsing edges too: `timeout-minutes` AFTER `runs-on`, and a
# `uses:`-only job (no runs-on) that must NOT demand a timeout.
test_compliant_pipeline_passes() {
  local dir out=/tmp/assert-invariants-green.out rc
  dir="$(mktemp -d)"
  cat > "${dir}/pipeline-web.yml" <<'YAML'
name: pipeline-web
on:
  pull_request:
  merge_group:
    branches: [main]
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.event.merge_group.head_ref || github.head_ref || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: echo ok
  gate:
    name: gate
    uses: ./.github/workflows/reusable-gate.yml
YAML
  rc="$(run_assert "${dir}" "${out}")"
  rm -rf "${dir}"
  [ "${rc}" -eq 0 ] || fail_test "compliant fixture must pass, got exit ${rc}: $(cat "${out}")"
  grep -q "all invariants hold" "${out}" || fail_test "missing one-line summary in output: $(cat "${out}")"
  echo "PASS: fully compliant pipeline fixture passes"
}

# ── Red 1: job with runs-on but no timeout-minutes ──────────────────────────
test_missing_timeout_fails() {
  local dir out=/tmp/assert-invariants-red-a.out rc
  dir="$(mktemp -d)"
  cat > "${dir}/ci.yml" <<'YAML'
name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
YAML
  rc="$(run_assert "${dir}" "${out}")"
  rm -rf "${dir}"
  [ "${rc}" -ne 0 ] || fail_test "job without timeout-minutes must fail, got exit 0"
  grep -q '^ci.yml:lint:missing timeout-minutes$' "${out}" || fail_test "expected ci.yml:lint:missing timeout-minutes: $(cat "${out}")"
  [ "$(wc -l < "${out}")" -eq 1 ] || fail_test "expected exactly one violation line: $(cat "${out}")"
  echo "PASS: job without timeout-minutes fails, naming file:job:check"
}

# ── Red 2: no top-level permissions block ───────────────────────────────────
test_missing_permissions_fails() {
  local dir out=/tmp/assert-invariants-red-b.out rc
  dir="$(mktemp -d)"
  cat > "${dir}/ci.yml" <<'YAML'
name: ci
on:
  pull_request:
jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
YAML
  rc="$(run_assert "${dir}" "${out}")"
  rm -rf "${dir}"
  [ "${rc}" -ne 0 ] || fail_test "workflow without permissions must fail, got exit 0"
  grep -q '^ci.yml:top-level:missing permissions$' "${out}" || fail_test "expected ci.yml:top-level:missing permissions: $(cat "${out}")"
  [ "$(wc -l < "${out}")" -eq 1 ] || fail_test "expected exactly one violation line: $(cat "${out}")"
  echo "PASS: workflow without permissions fails, naming file:job:check"
}

# ── Red 3: pipeline-*.yml without concurrency ───────────────────────────────
test_pipeline_without_concurrency_fails() {
  local dir out=/tmp/assert-invariants-red-c.out rc
  dir="$(mktemp -d)"
  cat > "${dir}/pipeline-web.yml" <<'YAML'
name: pipeline-web
on:
  pull_request:
  merge_group:
    branches: [main]
permissions:
  contents: read
jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
YAML
  rc="$(run_assert "${dir}" "${out}")"
  rm -rf "${dir}"
  [ "${rc}" -ne 0 ] || fail_test "pipeline without concurrency must fail, got exit 0"
  grep -q '^pipeline-web.yml:top-level:missing concurrency$' "${out}" || fail_test "expected pipeline-web.yml:top-level:missing concurrency: $(cat "${out}")"
  [ "$(wc -l < "${out}")" -eq 1 ] || fail_test "expected exactly one violation line: $(cat "${out}")"
  echo "PASS: pipeline without concurrency fails, naming file:job:check"
}

# ── Red 4: pipeline-*.yml without merge_group trigger ───────────────────────
test_pipeline_without_merge_group_fails() {
  local dir out=/tmp/assert-invariants-red-d.out rc
  dir="$(mktemp -d)"
  cat > "${dir}/pipeline-web.yml" <<'YAML'
name: pipeline-web
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
YAML
  rc="$(run_assert "${dir}" "${out}")"
  rm -rf "${dir}"
  [ "${rc}" -ne 0 ] || fail_test "pipeline without merge_group must fail, got exit 0"
  grep -q '^pipeline-web.yml:top-level:missing merge_group trigger$' "${out}" || fail_test "expected pipeline-web.yml:top-level:missing merge_group trigger: $(cat "${out}")"
  [ "$(wc -l < "${out}")" -eq 1 ] || fail_test "expected exactly one violation line: $(cat "${out}")"
  echo "PASS: pipeline without merge_group fails, naming file:job:check"
}

test_compliant_pipeline_passes
test_missing_timeout_fails
test_missing_permissions_fails
test_pipeline_without_concurrency_fails
test_pipeline_without_merge_group_fails

echo "All assert-workflow-invariants.sh behavioral tests passed."
