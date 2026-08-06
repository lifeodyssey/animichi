#!/usr/bin/env bash
# The "mock origin" test harness: throwaway Python HTTP servers standing in
# for the deployed origin, plus the probe primitives both post-deploy test
# files share (this repo has no shell mocking framework). Sourced by
# post-deploy-assert.test.sh and post-deploy-assert-probes.test.sh — no
# `set -euo pipefail` here: the sourcing test files own the shell options.
#
# start_mock <port> <counter-file> <handler-python>: launches one server; the
# handler body must define class Handler(BaseHTTPRequestHandler) and may call
# record_request() to append one line to the counter file per request served.
# wait_for_port is a plain TCP connect check, so readiness polling never adds
# to a test's request count. start_mock prints nothing; the caller tracks the
# PID via $!.

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

start_mock() {
  python3 -c "
import http.server
def record_request(): open('$2','a').write('1\n')
$3
http.server.HTTPServer(('127.0.0.1',$1),Handler).serve_forever()
" &
}

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

# The landing page fixture every mock serves when a test needs a 200 HTML
# body (`class="landing"` is LandingPage's structural marker — see
# cmd_web_landing in post-deploy-assert.sh). Exported: consumed by the two
# sourcing test files, so shellcheck sees the cross-file read.
export LANDING_BODY='<!doctype html><html><body><main class="landing">hi</main></body></html>'

# Handler python for a mock origin that answers EVERY request (GET and POST
# alike) with one fixed status + JSON body — the single-request probe cases'
# arrange. __STATUS__ and __BODY__ are substituted by fixed_answer_mock in
# post-deploy-assert-probes.test.sh. Exported like LANDING_BODY.
export FIXED_ANSWER_HANDLER="class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self): self._answer()
    def do_POST(self): self._answer()
    def _answer(self):
        record_request()
        self.send_response(__STATUS__); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(b'__BODY__')
    def log_message(self, *a): pass"
