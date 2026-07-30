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

test_branded_404_fails_fast
test_cf_edge_404_retries_then_fails
test_cf_edge_404_then_recovers
test_html_only_origin_is_accepted

echo "All post-deploy-assert.sh behavioral tests passed."
