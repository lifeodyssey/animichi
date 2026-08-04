#!/usr/bin/env bash
# Behavioral tests for post-deploy-assert.sh, driven against throwaway Python
# mock servers (this repo has no shell mocking framework).
#
# Per the "mock the clock" rule (AGENTS.md), every assertion is on OBSERVABLE
# BEHAVIOR — request COUNT and exit code — never elapsed time; an earlier
# version asserted a duration window and flaked in CI while passing locally.
# `POST_DEPLOY_ASSERT_RETRY_BACKOFF_BASE_SECONDS` only shortens the sleeps.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT_SH="${SCRIPT_DIR}/post-deploy-assert.sh"

CF_JSON_BODY='{"error_code":1042,"error_name":"config_error","status":404,"detail":"nope","cloudflare_error": true}'
BRANDED_404_BODY='<!doctype html><html lang="ja"><body><main class="app-shell hero compact"><h1 id="not-found-title">404</h1><p class="tagline">Page not found</p></main></body></html>'
LANDING_BODY='<!doctype html><html><body><main class="landing">hi</main></body></html>'

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

# Starts a background mock server. `handler_body` must define
# class Handler(BaseHTTPRequestHandler) and append one line to COUNTER_FILE
# per request served. Prints nothing; caller tracks the PID via $!.
start_mock() {
  local port="$1" counter_file="$2" handler_body="$3"
  python3 -c "
import http.server, sys
COUNTER_FILE = '${counter_file}'
def record_request():
    with open(COUNTER_FILE, 'a') as f:
        f.write('1\n')
${handler_body}
http.server.HTTPServer(('127.0.0.1', ${port}), Handler).serve_forever()
" &
}

# A plain TCP connect check (not a real HTTP GET) — every test case's mock
# handler counts requests via COUNTER_FILE, so readiness polling here must
# not itself add to that count.
wait_for_port() {
  local port="$1" _attempt
  for _attempt in $(seq 1 50); do
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && exec 3>&- 3<&- && return 0
    sleep 0.1
  done
  fail_test "mock server on port ${port} never came up"
}

request_count() {
  local counter_file="$1"
  [ -f "${counter_file}" ] && wc -l <"${counter_file}" | tr -d ' ' || echo 0
}

stop_mock() {
  local pid="$1"
  kill "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
}

# ── Case 1: branded application 404 -> fails immediately, exactly 1 request ─
test_branded_404_fails_fast() {
  local port=18801 counter_file pid rc=0 requests
  counter_file="$(mktemp)"
  rm -f "${counter_file}"
  start_mock "${port}" "${counter_file}" "
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        record_request()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'''${BRANDED_404_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  WEB_URL="http://127.0.0.1:${port}" bash "${ASSERT_SH}" web-landing >/tmp/branded404.out 2>&1 || rc=$?
  stop_mock "${pid}"
  requests="$(request_count "${counter_file}")"
  rm -f "${counter_file}"
  [ "${rc}" -ne 0 ] || fail_test "branded 404 should have failed the gate, got exit 0"
  [ "${requests}" -eq 1 ] || fail_test "branded 404 made ${requests} request(s) — should fail on the FIRST one, no retry"
  grep -q "expected 200, got 404" /tmp/branded404.out || fail_test "missing expected diagnostic in output"
  echo "PASS: branded application 404 fails immediately (${requests} request, exit ${rc})"
}

# ── Case 2: Cloudflare edge 404, never recovers -> all 5 attempts, then fails
test_cf_edge_404_retries_then_fails() {
  local port=18802 counter_file pid rc=0 requests
  counter_file="$(mktemp)"
  rm -f "${counter_file}"
  start_mock "${port}" "${counter_file}" "
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        record_request()
        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'''${CF_JSON_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  WEB_URL="http://127.0.0.1:${port}" POST_DEPLOY_ASSERT_RETRY_BACKOFF_BASE_SECONDS=1 \
    bash "${ASSERT_SH}" web-landing >/tmp/cfedge404.out 2>&1 || rc=$?
  stop_mock "${pid}"
  requests="$(request_count "${counter_file}")"
  rm -f "${counter_file}"
  [ "${rc}" -ne 0 ] || fail_test "a permanently-erroring CF edge should still fail the gate eventually, got exit 0"
  [ "${requests}" -eq 5 ] || fail_test "expected exactly 5 requests (the full retry budget), got ${requests}"
  [ "$(grep -c "Cloudflare edge 404" /tmp/cfedge404.out)" -eq 4 ] || fail_test "expected exactly 4 retry log lines (attempts 1-4 of 5), got: $(grep -c "Cloudflare edge 404" /tmp/cfedge404.out)"
  ! grep -q "transport failure" /tmp/cfedge404.out || fail_test "Cloudflare 404 was misclassified as a transport failure"
  echo "PASS: Cloudflare edge 404 retries all attempts before failing (${requests} requests, exit ${rc})"
}

# ── Case 3: Cloudflare edge 404 twice, then the real 200 -> recovers on the
#    3rd request. Its edge-error branch renders JSON only when JSON is asked
#    for FIRST (Cloudflare negotiates on q; at equal q the first-listed type
#    wins), so this case also guards ACCEPT_HEADER's ordering. ─────────────
test_cf_edge_404_then_recovers() {
  local port=18803 counter_file pid rc=0 requests
  counter_file="$(mktemp)"
  rm -f "${counter_file}"
  start_mock "${port}" "${counter_file}" "
served = {'n': 0}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        record_request()
        served['n'] += 1
        if served['n'] <= 2:
            self.send_response(404)
            if self.headers.get('Accept', '').startswith('application/json'):
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'''${CF_JSON_BODY}''')
            else:
                self.end_headers()
                self.wfile.write(b'<html>edge error</html>')
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'''${LANDING_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  WEB_URL="http://127.0.0.1:${port}" POST_DEPLOY_ASSERT_RETRY_BACKOFF_BASE_SECONDS=1 \
    bash "${ASSERT_SH}" web-landing >/tmp/cfrecover.out 2>&1 || rc=$?
  stop_mock "${pid}"
  requests="$(request_count "${counter_file}")"
  rm -f "${counter_file}"
  [ "${rc}" -eq 0 ] || fail_test "should have recovered and passed, got exit ${rc}: $(cat /tmp/cfrecover.out)"
  [ "${requests}" -eq 3 ] || fail_test "expected exactly 3 requests (2 CF edge 404s + the recovering 200), got ${requests}"
  echo "PASS: recovers after 2 Cloudflare edge 404s once the real 200 lands (${requests} requests, exit ${rc})"
}

# ── Case 4: an HTML-only origin (apps/web) -> the probe must ask for
#    text/html. Mirrors the real staging failure — a JSON-only Accept gets
#    500 {"error":"Only HTML requests are supported here"}. ────────────────
test_html_only_origin_is_accepted() {
  local port=18804 counter_file pid rc=0 requests
  counter_file="$(mktemp)"
  rm -f "${counter_file}"
  start_mock "${port}" "${counter_file}" "
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        record_request()
        if 'text/html' not in self.headers.get('Accept', ''):
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{\"error\":\"Only HTML requests are supported here\"}')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'''${LANDING_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  WEB_URL="http://127.0.0.1:${port}" bash "${ASSERT_SH}" web-landing >/tmp/htmlonly.out 2>&1 || rc=$?
  stop_mock "${pid}"
  requests="$(request_count "${counter_file}")"
  rm -f "${counter_file}"
  [ "${rc}" -eq 0 ] || fail_test "HTML-only origin should pass, got exit ${rc}: $(cat /tmp/htmlonly.out)"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request (no retry needed), got ${requests}"
  echo "PASS: HTML-only origin served (${requests} request, exit ${rc})"
}

# Every auth-config-check mock below simulates the REAL Worker's gate
# (workers/edge/app.ts + authConfigCheck.ts::isDiagAuthorized, issue #709
# review follow-up): a request whose Authorization header doesn't carry
# exactly `Bearer ${DIAG_TOKEN}` gets the same 404 an unmapped path would, not
# a 401/403 that would confirm the route exists. This is what lets the
# wrong-token case below stand in for hitting a real deployed Worker with a
# wrong credential.
DIAG_TOKEN="test-post-deploy-diag-token-not-a-real-secret"

# Shared boilerplate for every auth-config-check case below (qodo/1-10-50
# follow-up on issue #709): each test_auth_config_check_* function differs
# only in the mock's JSON body, the token the script is invoked with, and
# the pass/fail assertions specific to its own failure mode — never in how
# the mock server or the script invocation itself works. Factoring THAT out
# is what got each test function back under 10 lines without merging the
# distinct failure modes into fewer, less specific tests.
start_auth_config_mock() {
  local port="$1" counter_file="$2" response_body="$3"
  start_mock "${port}" "${counter_file}" "
DIAG_TOKEN = '${DIAG_TOKEN}'
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        record_request()
        if self.headers.get('Authorization') != f'Bearer {DIAG_TOKEN}':
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'''${response_body}''')
    def log_message(self, *a): pass
"
}

# Runs post-deploy-assert.sh auth-config-check against the mock on ${port}
# with POST_DEPLOY_DIAG_TOKEN=${token} (pass "" for "unset", per the shell's
# own `-n` treatment of an empty string), writing combined output to
# ${out_file} and printing the exit code for the caller to capture.
run_auth_config_check() {
  local port="$1" token="$2" out_file="$3" rc=0
  ROOT_URL="http://127.0.0.1:${port}" POST_DEPLOY_DIAG_TOKEN="${token}" \
    bash "${ASSERT_SH}" auth-config-check >"${out_file}" 2>&1 || rc=$?
  echo "${rc}"
}

assert_output_contains() { local needle="$1" label="$2"; grep -q "${needle}" "${out}" || fail_test "missing ${label}"; }

# ── Case 5: Neon Auth disabled -> passes, no drift verdict needed ──────────
test_auth_config_check_disabled_passes() {
  local port=18805 out=/tmp/authcfg-disabled.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{"neonAuthEnabled": false, "jwksIssuerMatch": null}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "${DIAG_TOKEN}" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -eq 0 ] || fail_test "Neon Auth disabled should pass trivially, got exit ${rc}: $(cat "${out}")"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request, got ${requests}"
  grep -q "nothing to check" "${out}" || fail_test "missing expected diagnostic in output"
  echo "PASS: Neon Auth disabled passes trivially (${requests} request, exit ${rc})"
}

# ── Case 6: JWKS matches the issuer-derived URL, correct token -> passes ───
test_auth_config_check_matching_passes() {
  local port=18806 out=/tmp/authcfg-match.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{"neonAuthEnabled": true, "jwksIssuerMatch": true}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "${DIAG_TOKEN}" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -eq 0 ] || fail_test "matching JWKS/issuer with the correct credential should pass, got exit ${rc}: $(cat "${out}")"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request, got ${requests}"
  echo "PASS: matching JWKS/issuer with the correct credential passes (${requests} request, exit ${rc})"
}

# ── Case 7: JWKS drifted from the issuer, correct token -> fails with a
#    clear diagnostic ───────────────────────────────────────────────────────
test_auth_config_check_drift_fails() {
  local port=18807 out=/tmp/authcfg-drift.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{"neonAuthEnabled": true, "jwksIssuerMatch": false}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "${DIAG_TOKEN}" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -ne 0 ] || fail_test "drifted JWKS/issuer should fail the gate, got exit 0"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request (no retry needed on a 200), got ${requests}"
  { grep -q "does not match" "${out}" && grep -q "issue #709" "${out}"; } || fail_test "missing the expected drift diagnostic (with an issue #709 reference) in output"
  echo "PASS: drifted JWKS/issuer fails with a clear diagnostic (${requests} request, exit ${rc})"
}

# ── Case 8: wrong POST_DEPLOY_DIAG_TOKEN -> the mock (standing in for the
#    real Worker's gate) denies with 404, and the assert script fails
#    plainly instead of silently treating it as "route disabled" ──────────
test_auth_config_check_wrong_token_denied() {
  local port=18808 out=/tmp/authcfg-wrongtoken.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{"neonAuthEnabled": true, "jwksIssuerMatch": true}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "wrong-token-not-provisioned" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -ne 0 ] || fail_test "a wrong POST_DEPLOY_DIAG_TOKEN should fail the gate (denied by the Worker), got exit 0"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request (a 404 is not retried), got ${requests}"
  { grep -q "expected 200, got 404" "${out}" && grep -q "POST_DEPLOY_DIAG_TOKEN" "${out}"; } || fail_test "missing expected diagnostic pointing at POST_DEPLOY_DIAG_TOKEN as the likely cause"
  echo "PASS: a wrong POST_DEPLOY_DIAG_TOKEN is denied by the gate and fails plainly (${requests} request, exit ${rc})"
}

# ── Case 9: no POST_DEPLOY_DIAG_TOKEN at all -> the script itself refuses
#    to run rather than silently sending an unauthenticated request ────────
# The failure message must make a MISSING CREDENTIAL unmistakable (not a
# broken route) and carry the remediation command, per the 2026-08-04
# optional-secret change: a diagnostic credential must not be able to
# block delivery, so the deploy proceeds and THIS check owns reporting it.
test_auth_config_check_missing_token_refuses_to_run() {
  local port=18809 out=/tmp/authcfg-notoken.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{"neonAuthEnabled": true, "jwksIssuerMatch": true}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -ne 0 ] || fail_test "a missing POST_DEPLOY_DIAG_TOKEN should refuse to run, got exit 0"
  [ "${requests}" -eq 0 ] || fail_test "expected zero requests — the script must refuse before ever calling the Worker, got ${requests}"
  assert_output_contains "did NOT run" "the 'did NOT run' framing in output"
  assert_output_contains "deploy itself succeeded" "the 'deploy itself succeeded' reassurance in output"
  assert_output_contains "gh secret set POST_DEPLOY_DIAG_TOKEN" "the gh secret set remediation command in output"
  echo "PASS: a missing POST_DEPLOY_DIAG_TOKEN refuses to run before making any request (${requests} requests, exit ${rc})"
}

# ── Case 10: neonAuthEnabled MISSING from the response -> FAILS with an
#    "unable to determine" diagnostic, never silently treated as disabled
#    (issue #709 review follow-up: a plain `!= "true"` check would have
#    made this indistinguishable from a legitimate "false") ────────────────
test_auth_config_check_missing_enabled_field_fails() {
  local port=18810 out=/tmp/authcfg-missingfield.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "${DIAG_TOKEN}" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -ne 0 ] || fail_test "a response missing neonAuthEnabled entirely should fail the gate, got exit 0"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request, got ${requests}"
  grep -q "could NOT be determined" "${out}" || fail_test "missing the 'could not be determined' diagnostic — a missing field must not read as a mismatch verdict or as disabled"
  echo "PASS: a response with no neonAuthEnabled field fails with an 'unable to determine' diagnostic (${requests} request, exit ${rc})"
}

# ── Case 11: neonAuthEnabled is JSON null -> FAILS the same way ────────────
test_auth_config_check_null_enabled_field_fails() {
  local port=18811 out=/tmp/authcfg-nullfield.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{"neonAuthEnabled": null, "jwksIssuerMatch": null}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "${DIAG_TOKEN}" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -ne 0 ] || fail_test "neonAuthEnabled:null should fail the gate, got exit 0"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request, got ${requests}"
  grep -q "could NOT be determined" "${out}" || fail_test "missing the 'could not be determined' diagnostic for a null neonAuthEnabled"
  echo "PASS: neonAuthEnabled:null fails with an 'unable to determine' diagnostic (${requests} request, exit ${rc})"
}

# ── Case 12: neonAuthEnabled is the literal false -> still PASSES (the
#    legitimate "not enabled here" state must not get caught by the
#    fail-closed fix above) ─────────────────────────────────────────────────
test_auth_config_check_literal_false_still_passes() {
  local port=18812 out=/tmp/authcfg-literalfalse.out counter_file pid rc requests
  counter_file="$(mktemp)"; rm -f "${counter_file}"
  start_auth_config_mock "${port}" "${counter_file}" '{"neonAuthEnabled": false, "jwksIssuerMatch": null}'
  pid=$!; wait_for_port "${port}"
  rc="$(run_auth_config_check "${port}" "${DIAG_TOKEN}" "${out}")"
  stop_mock "${pid}"; requests="$(request_count "${counter_file}")"; rm -f "${counter_file}"
  [ "${rc}" -eq 0 ] || fail_test "a literal neonAuthEnabled:false should still pass (it is a real 'not enabled' state), got exit ${rc}: $(cat "${out}")"
  [ "${requests}" -eq 1 ] || fail_test "expected exactly 1 request, got ${requests}"
  grep -q "nothing to check" "${out}" || fail_test "missing expected diagnostic in output"
  echo "PASS: a literal neonAuthEnabled:false still passes, not caught by the fail-closed fix (${requests} request, exit ${rc})"
}

test_branded_404_fails_fast
test_cf_edge_404_retries_then_fails
test_cf_edge_404_then_recovers
test_html_only_origin_is_accepted
test_auth_config_check_disabled_passes
test_auth_config_check_matching_passes
test_auth_config_check_drift_fails
test_auth_config_check_wrong_token_denied
test_auth_config_check_missing_token_refuses_to_run
test_auth_config_check_missing_enabled_field_fails
test_auth_config_check_null_enabled_field_fails
test_auth_config_check_literal_false_still_passes

echo "All post-deploy-assert.sh behavioral tests passed."
