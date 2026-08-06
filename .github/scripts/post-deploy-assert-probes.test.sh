#!/usr/bin/env bash
# Behavioral tests for post-deploy-assert.sh's probe CONTRACTS — what each
# subcommand must assert (showcase-mode denial vs classic answer) and the
# EDGE_SHOWCASE_MODE parse lock — driven against throwaway Python mock
# servers via the shared mock-origin.sh harness (this repo has no shell
# mocking framework). The fetch/retry transport tests live in
# post-deploy-assert.test.sh (split by concern so every test file stays at
# or below 200 lines).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT_SH="${SCRIPT_DIR}/post-deploy-assert.sh"
# shellcheck source=.github/scripts/mock-origin.sh
source "${SCRIPT_DIR}/mock-origin.sh"

# ── Case 5 (#541 step 6): STAGING_GATE_TOKEN set -> every request carries
#    it as the `x-staging-key` header, the staging WAF gate's pass signal
#    (the ruleset expression in infra/index.ts matches exactly this header
#    against the gate token). The mock enforces it the way the real gate
#    does: a request without the header is answered 403, so this test only
#    passes if the header actually rides along. ────────────────────────────
test_gate_token_is_sent_as_header() {
  local port=18805 counter_file pid rc=0 requests
  counter_file="$(mktemp)"
  rm -f "${counter_file}"
  start_mock "${port}" "${counter_file}" "
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        record_request()
        if self.headers.get('x-staging-key') != 'test-gate-token':
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b'blocked by the staging WAF gate')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'''${LANDING_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  WEB_URL="http://127.0.0.1:${port}" STAGING_GATE_TOKEN='test-gate-token' \
    bash "${ASSERT_SH}" web-landing >/tmp/gatetoken.out 2>&1 || rc=$?
  stop_mock "${pid}"
  requests="$(request_count "${counter_file}")"
  rm -f "${counter_file}"
  [ "${rc}" -eq 0 ] || fail_test "gate-token request should pass the mock gate, got exit ${rc}: $(cat /tmp/gatetoken.out)"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request (no retry needed), got ${requests}"
  echo "PASS: STAGING_GATE_TOKEN rides every request as x-staging-key (${requests} request, exit ${rc})"
}

# ── showcase-mode & classic probe-contract cases (S0-v2 GOAL C / C9) ─────────

# Starts a mock answering EVERY request (GET/POST alike) with one fixed status
# + JSON body (substituting mock-origin.sh's FIXED_ANSWER_HANDLER); echoes
# "<pid> <counter-file>" for the caller. The arrange for a single-request
# probe case.
fixed_answer_mock() {
  local port="$1" status="$2" json_body="$3" counter_file handler
  counter_file="$(mktemp)"
  rm -f "${counter_file}"
  handler="${FIXED_ANSWER_HANDLER//__STATUS__/${status}}"
  handler="${handler//__BODY__/${json_body}}"
  start_mock "${port}" "${counter_file}" "${handler}"
  echo "${!} ${counter_file}"
}

# The two invariants every fixed-answer probe case shares: the expected exit
# code, and exactly 1 request (401/403 are final application answers, never
# retried — see `fetch`'s retry policy in post-deploy-assert.sh).
assert_single_request_probe() {
  local name="$1" expected_rc="$2" actual_rc="$3" pid="$4" counter_file="$5" out="$6"
  stop_mock "${pid}"
  local requests
  requests="$(request_count "${counter_file}")"
  rm -f "${counter_file}" "${out}"
  [ "${actual_rc}" -eq "${expected_rc}" ] || fail_test "${name}: expected exit ${expected_rc}, got ${actual_rc}: $(cat "${out}")"
  [ "${requests}" -eq 1 ] || fail_test "${name}: expected exactly 1 request, got ${requests}"
  echo "PASS: ${name} (${requests} request, exit ${actual_rc})"
}

# Runs one probe subcommand against a fixed-answer mock. `extra_env...` (e.g.
# EDGE_SHOWCASE_MODE=true) rides the run; ROOT_URL is always the mock.
run_json_probe_case() {
  local name="$1" port="$2" status="$3" json_body="$4" expected_rc="$5" subcmd="$6"
  shift 6
  local rc=0 out
  read -r pid counter_file < <(fixed_answer_mock "${port}" "${status}" "${json_body}")
  wait_for_port "${port}"
  out="$(mktemp)"
  ROOT_URL="http://127.0.0.1:${port}" env "$@" bash "${ASSERT_SH}" "${subcmd}" >"${out}" 2>&1 || rc=$?
  assert_single_request_probe "${name}" "${expected_rc}" "${rc}" "${pid}" "${counter_file}" "${out}"
}

SHOWCASE_DENIED_BODY='{"error":{"code":"showcase_denied","message":"Not available in showcase mode."}}'
UNAUTHORIZED_BODY='{"error":{"code":"unauthorized","message":"unauthorized"}}'
BANGUMI_OK_BODY='{"bangumi":[{"id":1}]}'

# Case 6: showcase mode (EDGE_SHOWCASE_MODE=true) — every functional-route
# probe asserts the DENIAL (403 showcase_denied) as the prod contract. This
# is GOAL C's "bypass the UI, curl the API straight, get 403" acceptance made
# a permanent CI assertion.
test_showcase_probes_accept_denial() {
  run_json_probe_case "showcase auth-probe accepts 403 showcase_denied" 18806 \
    403 "${SHOWCASE_DENIED_BODY}" 0 auth-probe EDGE_SHOWCASE_MODE=true
  run_json_probe_case "showcase users-probe accepts 403 showcase_denied" 18807 \
    403 "${SHOWCASE_DENIED_BODY}" 0 users-probe EDGE_SHOWCASE_MODE=true
  run_json_probe_case "showcase data-plane-probe accepts 403 showcase_denied" 18808 \
    403 "${SHOWCASE_DENIED_BODY}" 0 data-plane-probe EDGE_SHOWCASE_MODE=true
  run_json_probe_case "showcase catalog-probe accepts 403 showcase_denied" 18809 \
    403 "${SHOWCASE_DENIED_BODY}" 0 catalog-probe EDGE_SHOWCASE_MODE=true
  run_json_probe_case "showcase anon-disabled-production accepts 403 showcase_denied" 18810 \
    403 "${SHOWCASE_DENIED_BODY}" 0 anon-disabled-production EDGE_SHOWCASE_MODE=true
}

# Case 7: showcase mode but the gate is DOWN (auth probe gets the old 401) —
# the denial contract must fail loudly, not silently accept a regressed gate.
test_showcase_gate_down_fails() {
  run_json_probe_case "showcase auth-probe fails when the gate answers 401 (gate down)" 18811 \
    401 "${UNAUTHORIZED_BODY}" 1 auth-probe EDGE_SHOWCASE_MODE=true
}

# Case 8: classic (non-showcase) probes keep the classic contract — a 403
# showcase_denied answer where the classic contract was expected is a gate
# misconfiguration, not a pass.
test_classic_probes_keep_classic_contract() {
  run_json_probe_case "classic auth-probe accepts 401 unauthorized" 18812 \
    401 "${UNAUTHORIZED_BODY}" 0 auth-probe
  run_json_probe_case "classic data-plane-probe accepts 200 bangumi" 18813 \
    200 "${BANGUMI_OK_BODY}" 0 data-plane-probe
  run_json_probe_case "classic auth-probe fails on 403 showcase_denied" 18814 \
    403 "${SHOWCASE_DENIED_BODY}" 1 auth-probe
}

# ── EDGE_SHOWCASE_MODE parse lock (S0-v2 GOAL C / C9, fix round 2) ──────────
# The smoke probes must know which contract to assert, and they learn it from
# the SAME wrangler.toml `wrangler deploy` reads — via edge-showcase-mode.sh.
# The parse used to be inline awk in reusable-post-deploy-test.yml and was
# untestable; it sliced `[env.${ENVIRONMENT}]` (the bare env block, which
# holds `name =` but no vars) and exited at the [env.<environment>.vars]
# header before finding anything — every environment hard-failed the parse
# step. These cases pin the REAL repo file: production MUST parse to "true",
# staging to "false", the bare [env.<environment>] block must never leak a
# decoy value into the parse, and a config that lost or mangled the key must
# fail loudly instead of guessing.
EDGE_SHOWCASE_MODE_SH="${SCRIPT_DIR}/edge-showcase-mode.sh"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

test_showcase_mode_parses_from_real_wrangler_toml() {
  local value rc
  value="$(bash "${EDGE_SHOWCASE_MODE_SH}" "${REPO_ROOT}/wrangler.toml" production)" || rc=$?
  [ "${rc:-0}" -eq 0 ] || fail_test "production EDGE_SHOWCASE_MODE parse failed (exit ${rc}): ${value}"
  [ "${value}" = "true" ] || fail_test "production EDGE_SHOWCASE_MODE must parse to true (the landing-only contract), got '${value}'"
  value="$(bash "${EDGE_SHOWCASE_MODE_SH}" "${REPO_ROOT}/wrangler.toml" staging)" || rc=$?
  [ "${rc:-0}" -eq 0 ] || fail_test "staging EDGE_SHOWCASE_MODE parse failed (exit ${rc}): ${value}"
  [ "${value}" = "false" ] || fail_test "staging EDGE_SHOWCASE_MODE must parse to false (full functionality), got '${value}'"
  echo "PASS: real wrangler.toml parses EDGE_SHOWCASE_MODE (production=true, staging=false)"
}

test_showcase_mode_parse_is_anchored_to_vars_block() {
  local fixture rc out
  fixture="$(mktemp)"
  # The exact shipped-bug shape: a decoy EDGE_SHOWCASE_MODE in the bare
  # [env.staging] block (where `name =` lives) MUST NOT be picked up — the
  # real value lives in [env.staging.vars]. Slicing [env.staging] would
  # print the decoy and exit the case check cleanly with the WRONG contract.
  printf '[env.staging]\nname = "animichi-staging"\nEDGE_SHOWCASE_MODE = "true"\n[env.staging.vars]\nEDGE_SHOWCASE_MODE = "false"\n' > "${fixture}"
  out="$(bash "${EDGE_SHOWCASE_MODE_SH}" "${fixture}" staging)" || rc=$?
  [ "${rc:-0}" -eq 0 ] || fail_test "decoy-var parse should succeed, got exit ${rc}: ${out}"
  [ "${out}" = "false" ] || fail_test "decoy EDGE_SHOWCASE_MODE in [env.staging] leaked into the parse, got '${out}' — the slice must anchor to [env.staging.vars]"
  rm -f "${fixture}"
  echo "PASS: parse is anchored to the [env.<environment>.vars] block, not the bare env block"
}

test_showcase_mode_missing_or_malformed_fails() {
  local fixture rc out
  fixture="$(mktemp)"
  # Config lost the key: env block present, no EDGE_SHOWCASE_MODE anywhere.
  printf '[env.staging.vars]\nAPP_ENV = "staging"\n' > "${fixture}"
  out="$(bash "${EDGE_SHOWCASE_MODE_SH}" "${fixture}" staging 2>&1)" || rc=$?
  [ "${rc:-0}" -ne 0 ] || fail_test "missing EDGE_SHOWCASE_MODE must fail loudly, got exit 0: ${out}"
  # Malformed value must fail closed, same as the Worker's own gate
  # (workers/edge/showcase.ts accepts only the literal "true"/"false").
  printf '[env.staging.vars]\nEDGE_SHOWCASE_MODE = "TRUE"\n' > "${fixture}"
  out="$(bash "${EDGE_SHOWCASE_MODE_SH}" "${fixture}" staging 2>&1)" || rc=$?
  [ "${rc:-0}" -ne 0 ] || fail_test "malformed EDGE_SHOWCASE_MODE (\"TRUE\") must fail loudly, got exit 0: ${out}"
  rm -f "${fixture}"
  echo "PASS: missing or malformed EDGE_SHOWCASE_MODE fails loudly"
}

test_gate_token_is_sent_as_header
test_showcase_probes_accept_denial
test_showcase_gate_down_fails
test_classic_probes_keep_classic_contract
test_showcase_mode_parses_from_real_wrangler_toml
test_showcase_mode_parse_is_anchored_to_vars_block
test_showcase_mode_missing_or_malformed_fails

echo "All post-deploy-assert.sh probe-contract tests passed."
