#!/usr/bin/env bash
# Behavioral tests for post-deploy-assert.sh's #522 fix: a real application
# 404 must fail immediately, and a Cloudflare-edge 404 (cloudflare_error:true
# body) must retry until it resolves. No mocking framework in this repo
# (no bats, no JS test runner wired to shell scripts) — this drives the real
# script against a throwaway `python3 -m http.server`-style mock and asserts
# on actual exit code + elapsed wall time, the same way this fix was verified
# by hand during review of #522/#523.
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

# Starts a background mock server on the given port using the given Python
# handler body (must define class Handler(BaseHTTPRequestHandler) and serve
# it). Prints nothing; caller tracks the PID via $!.
start_mock() {
  local port="$1" handler_body="$2"
  python3 -c "
import http.server, sys
${handler_body}
http.server.HTTPServer(('127.0.0.1', ${port}), Handler).serve_forever()
" &
}

# A plain TCP connect check (not a real HTTP GET) — some test cases' mock
# handlers count every GET they serve to decide when to "recover", so
# readiness polling here must not itself consume one of those counted
# requests.
wait_for_port() {
  local port="$1" _attempt
  for _attempt in $(seq 1 50); do
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && exec 3>&- 3<&- && return 0
    sleep 0.1
  done
  fail_test "mock server on port ${port} never came up"
}

# ── Case 1: branded application 404 -> fails immediately, no retry ─────────
test_branded_404_fails_fast() {
  local port=18801 pid start end elapsed rc=0
  start_mock "${port}" "
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(404)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'''${BRANDED_404_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  start=$(date +%s)
  WEB_URL="http://127.0.0.1:${port}" bash "${ASSERT_SH}" web-landing >/tmp/branded404.out 2>&1 || rc=$?
  end=$(date +%s)
  kill "${pid}" 2>/dev/null; wait "${pid}" 2>/dev/null || true
  elapsed=$((end - start))
  [ "${rc}" -ne 0 ] || fail_test "branded 404 should have failed the gate, got exit 0"
  [ "${elapsed}" -le 3 ] || fail_test "branded 404 took ${elapsed}s — should fail fast (<=3s), not retry"
  grep -q "expected 200, got 404" /tmp/branded404.out || fail_test "missing expected diagnostic in output"
  echo "PASS: branded application 404 fails immediately (${elapsed}s, exit ${rc})"
}

# ── Case 2: Cloudflare edge 404 -> retries all 5 attempts, then fails ──────
test_cf_edge_404_retries_then_fails() {
  local port=18802 pid start end elapsed rc=0
  start_mock "${port}" "
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'''${CF_JSON_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  start=$(date +%s)
  WEB_URL="http://127.0.0.1:${port}" bash "${ASSERT_SH}" web-landing >/tmp/cfedge404.out 2>&1 || rc=$?
  end=$(date +%s)
  kill "${pid}" 2>/dev/null; wait "${pid}" 2>/dev/null || true
  elapsed=$((end - start))
  [ "${rc}" -ne 0 ] || fail_test "a permanently-erroring CF edge should still fail the gate eventually, got exit 0"
  [ "${elapsed}" -ge 40 ] || fail_test "CF edge 404 only took ${elapsed}s — expected the full ~50s retry budget (4 backoff sleeps of 5/10/15/20s), meaning it did NOT retry"
  [ "$(grep -c "Cloudflare edge 404" /tmp/cfedge404.out)" -eq 4 ] || fail_test "expected exactly 4 retry log lines (attempts 1-4 of 5), got: $(grep -c "Cloudflare edge 404" /tmp/cfedge404.out)"
  echo "PASS: Cloudflare edge 404 retries all attempts before failing (${elapsed}s, exit ${rc})"
}

# ── Case 3: Cloudflare edge 404 twice, then the real 200 -> recovers ───────
test_cf_edge_404_then_recovers() {
  local port=18803 pid start end elapsed rc=0
  start_mock "${port}" "
count = {'n': 0}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        count['n'] += 1
        if count['n'] <= 2:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'''${CF_JSON_BODY}''')
        else:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'''${LANDING_BODY}''')
    def log_message(self, *a): pass
"
  pid=$!
  wait_for_port "${port}"
  start=$(date +%s)
  WEB_URL="http://127.0.0.1:${port}" bash "${ASSERT_SH}" web-landing >/tmp/cfrecover.out 2>&1 || rc=$?
  end=$(date +%s)
  kill "${pid}" 2>/dev/null; wait "${pid}" 2>/dev/null || true
  elapsed=$((end - start))
  [ "${rc}" -eq 0 ] || fail_test "should have recovered and passed, got exit ${rc}: $(cat /tmp/cfrecover.out)"
  [ "${elapsed}" -ge 10 ] && [ "${elapsed}" -le 25 ] || fail_test "expected ~15s (2 backoff sleeps of 5+10s) before recovery, got ${elapsed}s"
  echo "PASS: recovers after 2 Cloudflare edge 404s once the real 200 lands (${elapsed}s, exit ${rc})"
}

test_branded_404_fails_fast
test_cf_edge_404_retries_then_fails
test_cf_edge_404_then_recovers

echo "All post-deploy-assert.sh #522 behavioral tests passed."
