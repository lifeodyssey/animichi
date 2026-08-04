#!/usr/bin/env bash
# Behavioral tests for resolve-worker-url.sh (issue #695), driven against a
# throwaway Python mock of the Cloudflare API (this repo has no shell
# mocking framework — same pattern as post-deploy-assert.test.sh).
#
# The core thing under test is NOT "does curl+jq work" — it's the defect
# class issue #695 was filed about: a smoke target that is a static
# assumption about where a Worker lives, instead of a live read of where it
# actually lives. Case 3 below is that defect, reproduced directly: it
# compares against a frozen snapshot of the OLD (pre-#695) script's
# hardcoded behavior, run against a mock Cloudflare account whose actual
# state matches this repo's real current production state (workers.dev
# only, no Custom Domain — confirmed by issue #541: animichi.com has zero
# DNS records today), and shows the OLD script would have silently
# returned `https://animichi.com` anyway — a hostname that does not exist.
# The NEW script, queried against the exact same mock state, returns the
# real, live workers.dev URL instead. Case 4 then proves the forward
# direction: once a Custom Domain appears in the mock (the #541 cutover),
# the NEW script picks it up with no code change.
#
# Cases 5 and 6 (added on review round 2) cover the same failure MODE one
# layer down, inside the Cloudflare API calls themselves rather than the
# URL table: Case 5 proves a 200-with-`success:false` response (a real
# thing Cloudflare does — bad token scope, missing resource, etc.) fails
# loudly instead of being read as "no Custom Domain found" and silently
# falling back to a plausible-but-wrong workers.dev guess. Case 6 proves
# the Custom Domains lookup finds the target Worker's domain via
# server-side filtering (`?service=<name>`) regardless of how many OTHER
# domains the account has — not via client-side pagination that could
# silently stop short of the right page.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVE_SH="${SCRIPT_DIR}/resolve-worker-url.sh"

fail_test() {
  echo "FAIL: $1" >&2
  exit 1
}

# Starts a background mock Cloudflare API server. `routes_body` must define
# ROUTES, a dict mapping exact request paths to JSON response strings.
start_mock() {
  local port="$1" routes_body="$2"
  python3 -c "
import http.server, json, sys

${routes_body}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = ROUTES.get(self.path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{\"success\":false,\"result\":null}')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())
    def log_message(self, *a): pass

http.server.HTTPServer(('127.0.0.1', ${port}), Handler).serve_forever()
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

stop_mock() {
  local pid="$1"
  kill "${pid}" 2>/dev/null || true
  wait "${pid}" 2>/dev/null || true
}

NO_CUSTOM_DOMAINS='{"success":true,"result":[]}'

# ── Case 1: no Custom Domain, workers.dev enabled -> resolves the account's
#    live workers.dev subdomain (proves the normal, pre-cutover path). ────
test_resolves_workers_dev_when_no_custom_domain() {
  local port=18901 pid rc=0 out
  start_mock "${port}" "
ROUTES = {
    '/accounts/mock-account/workers/domains?service=animichi-staging': '${NO_CUSTOM_DOMAINS}',
    '/accounts/mock-account/workers/scripts/animichi-staging/subdomain': '{\"success\":true,\"result\":{\"enabled\":true}}',
    '/accounts/mock-account/workers/subdomain': '{\"success\":true,\"result\":{\"subdomain\":\"mock-subdomain\"}}',
}
"
  pid=$!
  wait_for_port "${port}"
  out="$(CLOUDFLARE_API_BASE_URL="http://127.0.0.1:${port}" CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=mock-account \
    bash "${RESOLVE_SH}" root staging)" || rc=$?
  stop_mock "${pid}"
  [ "${rc}" -eq 0 ] || fail_test "expected success, got exit ${rc}"
  [ "${out}" = "https://animichi-staging.mock-subdomain.workers.dev" ] || fail_test "expected workers.dev URL, got: ${out}"
  echo "PASS: resolves workers.dev when no Custom Domain is attached (${out})"
}

# ── Case 2: a Custom Domain IS attached -> that hostname wins outright, no
#    workers.dev lookup at all (proves #541 cutover needs no code change). ─
test_resolves_custom_domain_when_attached() {
  local port=18902 pid rc=0 out
  start_mock "${port}" "
ROUTES = {
    '/accounts/mock-account/workers/domains?service=animichi-web': '{\"success\":true,\"result\":[{\"service\":\"animichi-web\",\"hostname\":\"app.animichi.com\",\"zone_id\":\"z\",\"zone_name\":\"animichi.com\"}]}',
}
"
  pid=$!
  wait_for_port "${port}"
  out="$(CLOUDFLARE_API_BASE_URL="http://127.0.0.1:${port}" CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=mock-account \
    bash "${RESOLVE_SH}" web production)" || rc=$?
  stop_mock "${pid}"
  [ "${rc}" -eq 0 ] || fail_test "expected success, got exit ${rc}"
  [ "${out}" = "https://app.animichi.com" ] || fail_test "expected the Custom Domain hostname, got: ${out}"
  echo "PASS: resolves the attached Custom Domain, skipping workers.dev entirely (${out})"
}

# ── Case 3 (the mutation-proof case): the OLD (pre-#695) script's
#    root/production branch is a hardcoded `https://animichi.com` that never
#    checks Cloudflare at all — including in this exact mock, whose state
#    says root/production is NOT on any Custom Domain, only workers.dev.
#    That is issue #541's confirmed real state today. The OLD script
#    "succeeds" by returning a hostname with zero DNS records; the NEW
#    script, run against the identical mock, returns the real reachable
#    URL. This is the "deployed to A, smoke probes B, and reports success"
#    failure mode issue #695 exists to close.
#
#    OLD_SCRIPT below is a frozen, self-contained snapshot of the exact
#    pre-#695 root/production branch (see PR history for the full original
#    file) — NOT a `git show HEAD:...` lookup. HEAD *is* the new script by
#    the time this test runs in CI (this file and resolve-worker-url.sh
#    land in the same commit/PR), and a CI checkout can also be shallow, so
#    neither points reliably at "the version before this PR". A frozen
#    literal is the only comparison that stays meaningful regardless of
#    git history. ─────────────────────────────────────────────────────────
OLD_SCRIPT_ROOT_PRODUCTION_HARDCODE='https://animichi.com'

test_old_script_would_have_lied_new_script_does_not() {
  local port=18903 pid rc_new=0 out_old out_new
  start_mock "${port}" "
ROUTES = {
    '/accounts/mock-account/workers/domains?service=animichi': '${NO_CUSTOM_DOMAINS}',
    '/accounts/mock-account/workers/scripts/animichi/subdomain': '{\"success\":true,\"result\":{\"enabled\":true}}',
    '/accounts/mock-account/workers/subdomain': '{\"success\":true,\"result\":{\"subdomain\":\"mock-subdomain\"}}',
}
"
  pid=$!
  wait_for_port "${port}"

  # The OLD script's root/production branch never made an HTTP call at all
  # — it returned this literal unconditionally, regardless of the mock (or
  # real Cloudflare account) state below it. That unconditional-ness is
  # exactly the bug.
  out_old="${OLD_SCRIPT_ROOT_PRODUCTION_HARDCODE}"
  out_new="$(CLOUDFLARE_API_BASE_URL="http://127.0.0.1:${port}" CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=mock-account \
    bash "${RESOLVE_SH}" root production)" || rc_new=$?

  stop_mock "${pid}"

  [ "${rc_new}" -eq 0 ] || fail_test "the NEW script should succeed against a reachable workers.dev target, got exit ${rc_new}"
  [ "${out_new}" = "https://animichi.mock-subdomain.workers.dev" ] || fail_test "expected the NEW script's live workers.dev URL, got: ${out_new}"
  [ "${out_old}" != "${out_new}" ] || fail_test "OLD and NEW scripts agreed — this test no longer demonstrates the bug"
  echo "PASS: OLD script silently returns a dead hostname (${out_old}); NEW script returns the real live target (${out_new})"
}

# ── Case 4: neither a Custom Domain nor workers.dev is enabled -> fails
#    loudly instead of guessing (a Worker with no reachable URL is a real
#    deploy problem, not something to paper over with a stale guess). ─────
test_fails_loudly_when_unreachable() {
  local port=18904 pid rc=0 out
  start_mock "${port}" "
ROUTES = {
    '/accounts/mock-account/workers/domains?service=animichi-web': '${NO_CUSTOM_DOMAINS}',
    '/accounts/mock-account/workers/scripts/animichi-web/subdomain': '{\"success\":true,\"result\":{\"enabled\":false}}',
}
"
  pid=$!
  wait_for_port "${port}"
  out="$(CLOUDFLARE_API_BASE_URL="http://127.0.0.1:${port}" CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=mock-account \
    bash "${RESOLVE_SH}" web production 2>&1)" || rc=$?
  stop_mock "${pid}"
  [ "${rc}" -ne 0 ] || fail_test "expected failure when neither Custom Domain nor workers.dev is reachable, got exit 0: ${out}"
  echo "${out}" | grep -q "neither a Custom Domain nor workers.dev" || fail_test "missing expected diagnostic in output: ${out}"
  echo "PASS: fails loudly instead of guessing when the Worker has no reachable URL"
}

# ── Case 5 (mutation-proof, review round 2 #1): Cloudflare answers HTTP 200
#    with `success:false` (insufficient token scope, resource not found,
#    etc — a real thing CF does, not a hypothetical). `result` on such a
#    response is typically `null`/absent. Before this case existed, an
#    unchecked script would read that as "no Custom Domain" and silently
#    fall through to workers.dev, reporting a plausible-looking URL that
#    has nothing to do with why the API call actually failed — the exact
#    "quietly probes the wrong target and calls it success" failure mode
#    issue #695 exists to remove, one layer up (the API call itself,
#    instead of the URL table). The fix must fail loudly and surface the
#    `errors` array instead. ──────────────────────────────────────────────
test_fails_loudly_on_cf_success_false() {
  local port=18905 pid rc=0 out
  start_mock "${port}" "
ROUTES = {
    '/accounts/mock-account/workers/domains?service=animichi-web': '{\"success\":false,\"result\":null,\"errors\":[{\"code\":10000,\"message\":\"Authentication error\"}]}',
}
"
  pid=$!
  wait_for_port "${port}"
  out="$(CLOUDFLARE_API_BASE_URL="http://127.0.0.1:${port}" CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=mock-account \
    bash "${RESOLVE_SH}" web production 2>&1)" || rc=$?
  stop_mock "${pid}"
  [ "${rc}" -ne 0 ] || fail_test "expected failure on success:false, got exit 0 (silently fell back to a guess): ${out}"
  echo "${out}" | grep -q "success:false" || fail_test "missing the success:false diagnostic in output: ${out}"
  echo "${out}" | grep -q "Authentication error" || fail_test "missing CF's own errors array in the diagnostic: ${out}"
  echo "PASS: fails loudly and surfaces CF's errors array on a 200-with-success:false response"
  echo "  real output: ${out}"
}

# ── Case 6 (mutation-proof, review round 2 #2): the Custom Domains request
#    is filtered server-side (`?service=<worker_name>`), not fetched
#    unfiltered-then-paginated. This mock proves that filtering is what
#    actually happens, not an accident of a large-enough page size: the
#    UNFILTERED path (what a client-side-pagination implementation would
#    hit first) is wired to return a target-domains list that does NOT
#    include this Worker's domain — standing in for "the real domain sits
#    past whatever page boundary a per_page cap drew". Only the FILTERED
#    path has the correct answer. If resolve-worker-url.sh ever regressed
#    to requesting the unfiltered/paginated shape, this test would get the
#    wrong hostname (or fall through to workers.dev) instead of the
#    Custom Domain that is actually attached. ───────────────────────────
test_finds_target_domain_via_server_side_filter_not_pagination() {
  local port=18906 pid rc=0 out other_domains_json
  other_domains_json="$(python3 -c "
import json
others = [{'service': f'unrelated-worker-{i}', 'hostname': f'unrelated-{i}.animichi.com', 'zone_id': 'z', 'zone_name': 'animichi.com'} for i in range(50)]
print(json.dumps({'success': True, 'result': others}))
")"
  start_mock "${port}" "
ROUTES = {
    # What an UNFILTERED, page-capped request would see: 50 OTHER workers'
    # Custom Domains, none of which is ours — i.e. our domain is 'past the
    # page boundary' from this request's point of view.
    '/accounts/mock-account/workers/domains?per_page=50': '${other_domains_json}',
    # What the ACTUAL (filtered) request sees: exactly our Worker's domain.
    '/accounts/mock-account/workers/domains?service=animichi-web-staging': '{\"success\":true,\"result\":[{\"service\":\"animichi-web-staging\",\"hostname\":\"staging.animichi.com\",\"zone_id\":\"z\",\"zone_name\":\"animichi.com\"}]}',
}
"
  pid=$!
  wait_for_port "${port}"
  out="$(CLOUDFLARE_API_BASE_URL="http://127.0.0.1:${port}" CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=mock-account \
    bash "${RESOLVE_SH}" web staging)" || rc=$?
  stop_mock "${pid}"
  [ "${rc}" -eq 0 ] || fail_test "expected success via the filtered request, got exit ${rc}"
  [ "${out}" = "https://staging.animichi.com" ] || fail_test "expected the filtered Custom Domain, got: ${out} (this would happen if the script fell back to the unfiltered/paginated shape instead)"
  echo "PASS: finds the target Worker's Custom Domain via server-side filtering, unaffected by how many other domains the account has"
  echo "  real output: ${out}"
}

test_resolves_workers_dev_when_no_custom_domain
test_resolves_custom_domain_when_attached
test_old_script_would_have_lied_new_script_does_not
test_fails_loudly_when_unreachable
test_fails_loudly_on_cf_success_false
test_finds_target_domain_via_server_side_filter_not_pagination

echo "All resolve-worker-url.sh behavioral tests passed."
