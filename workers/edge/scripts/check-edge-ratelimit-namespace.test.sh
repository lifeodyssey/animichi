#!/usr/bin/env bash
# Behavioral tests for check-edge-ratelimit-namespace.sh, driven against
# throwaway git repos in mktemp -d (the script resolves its root via
# `git rev-parse --show-toplevel`, so each case cd's into its own repo).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SH="${SCRIPT_DIR}/check-edge-ratelimit-namespace.sh"
PLACEHOLDER="REPLACE_WITH_OPERATOR_PROVISIONED_RATELIMIT_NAMESPACE_ID"

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

fixture_wrangler() {
  local repo="$1" body="$2"
  mkdir -p "${repo}/workers/edge"
  printf "%s
" "${body}" > "${repo}/workers/edge/wrangler.toml"
}

# ── Case 1: placeholder present in wrangler.toml -> FAILS CLOSED ──────────
test_placeholder_fails_closed() {
  local repo out=/tmp/rate-ns-case1.out rc
  repo="$(mktemp -d)"
  fixture_wrangler "${repo}" "namespace_id = \"${PLACEHOLDER}\""
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "placeholder must fail the precheck, got exit 0: $(cat "${out}")"
  grep -q "DEPLOY-BLOCKED" "${out}" || fail_test "output must warn DEPLOY-BLOCKED: $(cat "${out}")"
  echo "PASS: placeholder namespace_id fails closed with DEPLOY-BLOCKED"
}

# ── Case 2: a real (non-placeholder) namespace_id -> passes ───────────────
test_provisioned_namespace_passes() {
  local repo out=/tmp/rate-ns-case2.out rc
  repo="$(mktemp -d)"
  fixture_wrangler "${repo}" 'namespace_id = "d1c0de00000000000000000000000000"'
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "provisioned namespace_id must pass, got exit ${rc}: $(cat "${out}")"
  echo "PASS: provisioned namespace_id passes"
}

# ── Case 3: no [[ratelimits]] namespace_id at all (binding absent) -> passes
#    (the worker fails the native tier open with an alert; not a deploy block)
test_absent_binding_passes() {
  local repo out=/tmp/rate-ns-case3.out rc
  repo="$(mktemp -d)"
  mkdir -p "${repo}/workers/edge"
  printf "%s
" 'name = "RATE_LIMITER"' > "${repo}/workers/edge/wrangler.toml"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -eq 0 ] || fail_test "a binding without the placeholder must pass, got exit ${rc}: $(cat "${out}")"
  echo "PASS: binding without placeholder passes"
}

# ── Case 4: no wrangler.toml at all -> fails closed (cannot check) ────────
test_missing_file_fails_closed() {
  local repo out=/tmp/rate-ns-case4.out rc
  repo="$(mktemp -d)"
  printf "hello\n" > "${repo}/README.md"
  commit_fixture "${repo}"
  rc="$(run_check "${repo}" "${out}")"; rm -rf "${repo}"
  [ "${rc}" -ne 0 ] || fail_test "missing wrangler.toml must fail closed, got exit 0: $(cat "${out}")"
  echo "PASS: missing wrangler.toml fails closed"
}

test_placeholder_fails_closed
test_provisioned_namespace_passes
test_absent_binding_passes
test_missing_file_fails_closed

echo "All check-edge-ratelimit-namespace.sh behavioral tests passed."
