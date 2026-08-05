#!/usr/bin/env bash
# Behavioral tests for vite-env-preflight.sh (B5, 2026-08-05). Drives the real
# script against zero-entropy fixture values — 24 a's / 35 b's, never real key
# shapes. Covers the four mandated states: valid 24-char site key passes,
# 35-char SECRET fails (message must call out "SECRET"), empty fails, and any
# other length fails closed — plus the universal "no secret-looking value in
# any VITE_*" rules and the kept presence/value rules.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT_SH="${SCRIPT_DIR}/vite-env-preflight.sh"
TMP_DIR="$(mktemp -d "${SCRIPT_DIR}/.vite-env-preflight-test.XXXXXX")"
trap 'rm -rf "${TMP_DIR}"' EXIT

SITE_KEY_OK="$(printf 'a%.0s' {1..24})"    # 24 a's — the site-key length
SECRET_35="$(printf 'b%.0s' {1..35})"      # 35 b's — the SECRET-key length
OTHER_LENGTH="$(printf 'c%.0s' {1..23})"   # 23 c's — unknown shape
AUTH_URL="https://auth.example.com"
NAMES=(VITE_TURNSTILE_SITE_KEY VITE_NEON_AUTH_BASE_URL VITE_SHOWCASE_MODE VITE_SITE_ORIGIN)

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

# run_preflight: runs the real script against the standard four-variable
# table. Remaining args are VAR=value env assignments for that single run
# (env-prefix form, so nothing leaks between tests). Prints the exit code;
# the script's output lands in the file given as the first arg.
run_preflight() {
  local out="$1" rc=0
  shift
  local -a envargs=()
  while [ "$#" -gt 0 ]; do
    envargs+=("$1")
    shift
  done
  if [ "${#envargs[@]}" -gt 0 ]; then
    env "${envargs[@]}" bash "${PREFLIGHT_SH}" "${NAMES[@]}" >"${out}" 2>&1 || rc=$?
  else
    bash "${PREFLIGHT_SH}" "${NAMES[@]}" >"${out}" 2>&1 || rc=$?
  fi
  echo "${rc}"
}

# ── Green 1: legal 24-char site key passes ─────────────────────────────────
test_valid_site_key_passes() {
  local out="${TMP_DIR}/green-ok.out" rc
  rc="$(run_preflight "${out}" \
    VITE_TURNSTILE_SITE_KEY="${SITE_KEY_OK}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="false")"
  [ "${rc}" -eq 0 ] || fail_test "24-char site key must pass, got exit ${rc}: $(cat "${out}")"
  grep -q "::error::" "${out}" && fail_test "no ::error:: expected: $(cat "${out}")"
  echo "PASS: 24-character site key passes"
}

# ── Red 1: 35-char value is the SECRET, must fail naming the SECRET ────────
test_secret_key_fails() {
  local out="${TMP_DIR}/red-secret.out" rc
  rc="$(run_preflight "${out}" \
    VITE_TURNSTILE_SITE_KEY="${SECRET_35}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="false")"
  [ "${rc}" -ne 0 ] || fail_test "35-char SECRET in the site-key slot must fail, got exit 0"
  grep -q "SECRET" "${out}" || fail_test "message must call out the SECRET: $(cat "${out}")"
  grep -q "35" "${out}" || fail_test "message must mention the 35-character length: $(cat "${out}")"
  echo "PASS: 35-character SECRET fails with a SECRET-calling message"
}

# ── Red 2: empty value fails (presence check lives in the script now) ──────
test_empty_site_key_fails() {
  local out="${TMP_DIR}/red-empty.out" rc
  rc="$(run_preflight "${out}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="false")"
  [ "${rc}" -ne 0 ] || fail_test "empty site key must fail, got exit 0"
  grep -q "empty/unset" "${out}" || fail_test "expected an empty/unset message: $(cat "${out}")"
  echo "PASS: empty site key fails"
}

# ── Red 3: any other length fails closed (unknown shape) ───────────────────
test_other_length_site_key_fails() {
  local out="${TMP_DIR}/red-length.out" rc
  rc="$(run_preflight "${out}" \
    VITE_TURNSTILE_SITE_KEY="${OTHER_LENGTH}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="false")"
  [ "${rc}" -ne 0 ] || fail_test "23-char site key must fail, got exit 0"
  grep -q "must be exactly 24" "${out}" || fail_test "expected an exact-length message: $(cat "${out}")"
  echo "PASS: non-24 non-35 length fails closed"
}

# ── Red 4: no VITE_* may carry the 35-char secret shape ────────────────────
test_optional_var_rejects_secret_shape() {
  local out="${TMP_DIR}/red-universal.out" rc
  rc="$(run_preflight "${out}" \
    VITE_TURNSTILE_SITE_KEY="${SITE_KEY_OK}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="false" \
    VITE_SITE_ORIGIN="${SECRET_35}")"
  [ "${rc}" -ne 0 ] || fail_test "optional VITE_* holding a secret-shaped value must fail, got exit 0"
  grep -q "SECRET" "${out}" || fail_test "universal rule must call out the SECRET: $(cat "${out}")"
  echo "PASS: any VITE_* with the 35-char secret shape fails"
}

# ── Red 5: PEM/private-key markers fail in any VITE_* ──────────────────────
test_private_key_markers_fail() {
  local out="${TMP_DIR}/red-pem.out" rc
  rc="$(run_preflight "${out}" \
    VITE_TURNSTILE_SITE_KEY="${SITE_KEY_OK}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="false" \
    VITE_SITE_ORIGIN="-----BEGIN PRIVATE KEY-----")"
  [ "${rc}" -ne 0 ] || fail_test "PEM-looking value must fail, got exit 0"
  grep -q "PRIVATE KEY" "${out}" || fail_test "message must name the private-key marker: $(cat "${out}")"
  echo "PASS: PEM/private-key markers fail"
}

# ── Red 6: kept presence rule — empty auth base URL fails ──────────────────
test_auth_url_required() {
  local out="${TMP_DIR}/red-auth.out" rc
  rc="$(run_preflight "${out}" \
    VITE_TURNSTILE_SITE_KEY="${SITE_KEY_OK}" \
    VITE_SHOWCASE_MODE="false")"
  [ "${rc}" -ne 0 ] || fail_test "empty VITE_NEON_AUTH_BASE_URL must fail, got exit 0"
  grep -q "VITE_NEON_AUTH_BASE_URL" "${out}" || fail_test "message must name the variable: $(cat "${out}")"
  echo "PASS: empty auth base URL fails"
}

# ── Kept value rule: showcase mode must be exactly true/false ──────────────
test_showcase_mode_validation() {
  local out_ok="${TMP_DIR}/green-showcase.out" out_bad="${TMP_DIR}/red-showcase.out" rc
  rc="$(run_preflight "${out_ok}" \
    VITE_TURNSTILE_SITE_KEY="${SITE_KEY_OK}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="true")"
  [ "${rc}" -eq 0 ] || fail_test "showcase=true must pass: $(cat "${out_ok}")"
  rc="$(run_preflight "${out_bad}" \
    VITE_TURNSTILE_SITE_KEY="${SITE_KEY_OK}" \
    VITE_NEON_AUTH_BASE_URL="${AUTH_URL}" \
    VITE_SHOWCASE_MODE="True")"
  [ "${rc}" -ne 0 ] || fail_test "showcase=True must fail, got exit 0"
  grep -q "one of: true false" "${out_bad}" || fail_test "message must list the allowed values: $(cat "${out_bad}")"
  echo "PASS: showcase mode is value-validated"
}

# ── Usage guard: no variable names is an error, not a silent pass ──────────
test_no_args_fails() {
  local out="${TMP_DIR}/red-usage.out" rc=0
  bash "${PREFLIGHT_SH}" >"${out}" 2>&1 || rc=$?
  [ "${rc}" -ne 0 ] || fail_test "no arguments must fail with usage, got exit 0"
  grep -q "usage" "${out}" || fail_test "expected usage text: $(cat "${out}")"
  echo "PASS: no-arg invocation fails with usage"
}

test_valid_site_key_passes
test_secret_key_fails
test_empty_site_key_fails
test_other_length_site_key_fails
test_optional_var_rejects_secret_shape
test_private_key_markers_fail
test_auth_url_required
test_showcase_mode_validation
test_no_args_fails

echo "All vite-env-preflight.sh behavioral tests passed."
