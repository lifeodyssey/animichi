#!/usr/bin/env bash
# Behavioral tests for wrangler-secret-put.sh (#1150). Drives the real
# helper against a fake wrangler that records argv + stdin. Never calls
# the network. Fixture values are zero-entropy tokens, never real secrets.
#
# The defect: wrangler-action uploadSecrets() runs `secret bulk --env`
# without inheriting `-c` from `command`. Root's config is at
# workers/edge/wrangler.toml while cwd is the repo root, so secret upload
# dies with "Required Worker name missing". This helper is the post-deploy
# path that must keep `-c` for root and must never put a secret on argv.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUT_SH="${PUT_UNDER_TEST:-${SCRIPT_DIR}/wrangler-secret-put.sh}"
TMP_DIR="$(mktemp -d "${SCRIPT_DIR}/.wrangler-secret-put-test.XXXXXX")"
trap 'rm -rf "${TMP_DIR}"' EXIT

FAKE="${TMP_DIR}/wrangler"
LOG="${TMP_DIR}/wrangler.log"

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

write_fake() {
  cat > "${FAKE}" <<'EOF'
#!/usr/bin/env bash
printf 'argv:%s\n' "$*" >> "${WRANGLER_LOG}"
printf 'stdin:' >> "${WRANGLER_LOG}"
cat >> "${WRANGLER_LOG}"
printf '\n' >> "${WRANGLER_LOG}"
EOF
  chmod +x "${FAKE}"
}

run_put() {
  local rc=0
  : > "${LOG}"
  env -i \
    PATH="${PATH}" \
    HOME="${HOME}" \
    WRANGLER_BIN="${FAKE}" \
    WRANGLER_LOG="${LOG}" \
    TARGET_COMPONENT="${1}" \
    TARGET_ENVIRONMENT="${2}" \
    SECRET_NAMES="${3}" \
    EMPTY_POLICY="${4:-fail}" \
    MIMO_API_KEY="${5-}" \
    LOGFIRE_TOKEN="${6-}" \
    bash "${PUT_SH}" >"${TMP_DIR}/out" 2>&1 || rc=$?
  echo "${rc}"
}

write_fake

# ── Case 1: root argv includes -c workers/edge/wrangler.toml ──────────────
test_root_passes_config_path() {
  local rc
  rc="$(run_put root staging MIMO_API_KEY fail mimokey)"
  [[ "${rc}" -eq 0 ]] || fail_test "root put should pass, got ${rc}: $(cat "${TMP_DIR}/out")"
  grep -q 'argv:secret put MIMO_API_KEY -c workers/edge/wrangler.toml --env staging' "${LOG}" \
    || fail_test "root argv missing -c workers/edge/wrangler.toml: $(cat "${LOG}")"
  echo "PASS: root secret put passes -c workers/edge/wrangler.toml"
}

# ── Case 2: non-root does not pass -c ─────────────────────────────────────
test_catalog_has_no_config_path() {
  local rc
  rc="$(run_put catalog staging MIMO_API_KEY fail mimokey)"
  [[ "${rc}" -eq 0 ]] || fail_test "catalog put should pass, got ${rc}: $(cat "${TMP_DIR}/out")"
  grep -q 'argv:secret put MIMO_API_KEY --env staging' "${LOG}" \
    || fail_test "catalog argv should be secret put without -c: $(cat "${LOG}")"
  grep -q 'workers/edge/wrangler.toml' "${LOG}" \
    && fail_test "catalog must not pass root config path: $(cat "${LOG}")"
  echo "PASS: catalog secret put has no -c"
}

# ── Case 3: empty required secret fails closed ────────────────────────────
test_empty_fail_closed() {
  local rc
  rc="$(run_put root staging MIMO_API_KEY fail)"
  [[ "${rc}" -eq 1 ]] || fail_test "empty required secret should exit 1, got ${rc}"
  grep -q 'MIMO_API_KEY is empty' "${TMP_DIR}/out" \
    || fail_test "empty fail should name the secret: $(cat "${TMP_DIR}/out")"
  [[ ! -s "${LOG}" ]] || fail_test "fail-closed must not call wrangler: $(cat "${LOG}")"
  echo "PASS: empty required secret fails closed"
}

# ── Case 4: empty skip continues and puts the rest ────────────────────────
test_empty_skip_puts_remaining() {
  local rc
  rc="$(run_put root staging $'MIMO_API_KEY\nLOGFIRE_TOKEN' skip "" logfirevalue)"
  [[ "${rc}" -eq 0 ]] || fail_test "skip policy should pass, got ${rc}: $(cat "${TMP_DIR}/out")"
  grep -q 'MIMO_API_KEY is empty' "${TMP_DIR}/out" \
    || fail_test "skip should warn on empty MIMO_API_KEY: $(cat "${TMP_DIR}/out")"
  grep -q 'argv:secret put LOGFIRE_TOKEN -c workers/edge/wrangler.toml --env staging' "${LOG}" \
    || fail_test "skip should still put LOGFIRE_TOKEN: $(cat "${LOG}")"
  grep -q 'secret put MIMO_API_KEY' "${LOG}" \
    && fail_test "skip must not put empty MIMO_API_KEY: $(cat "${LOG}")"
  echo "PASS: empty skip puts remaining secrets"
}

# ── Case 5: secret value on stdin, never argv ─────────────────────────────
test_value_is_stdin_not_argv() {
  local rc
  rc="$(run_put root staging MIMO_API_KEY fail 'secret-value-must-not-leak')"
  [[ "${rc}" -eq 0 ]] || fail_test "put should pass, got ${rc}: $(cat "${TMP_DIR}/out")"
  grep -q 'stdin:secret-value-must-not-leak' "${LOG}" \
    || fail_test "value must be on stdin: $(cat "${LOG}")"
  grep -q 'secret-value-must-not-leak' "${LOG}" || fail_test "missing value in log"
  grep '^argv:' "${LOG}" | grep -q 'secret-value-must-not-leak' \
    && fail_test "value leaked onto argv: $(cat "${LOG}")"
  echo "PASS: secret value is stdin, not argv"
}

# ── Case 6: unknown EMPTY_POLICY fails closed ─────────────────────────────
test_unknown_policy_fails() {
  local rc
  rc="$(run_put root staging MIMO_API_KEY maybe mimokey)"
  [[ "${rc}" -eq 1 ]] || fail_test "unknown EMPTY_POLICY should exit 1, got ${rc}"
  grep -q "EMPTY_POLICY must be fail or skip" "${TMP_DIR}/out" \
    || fail_test "unknown policy should refuse to guess: $(cat "${TMP_DIR}/out")"
  echo "PASS: unknown EMPTY_POLICY fails closed"
}

test_root_passes_config_path
test_catalog_has_no_config_path
test_empty_fail_closed
test_empty_skip_puts_remaining
test_value_is_stdin_not_argv
test_unknown_policy_fails
echo "wrangler-secret-put.sh: 6 cases passed"
