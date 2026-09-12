#!/usr/bin/env bash
# The release schema preflight's response body must never reach the job log (#1590). Probe
# commits reached main during a CD debugging session and left the script echoing
# `schema-preflight.json` into the job log while the migrator's 503 body carried the driver
# exception — so the log carried a DSN. Both ends of that are closed now, and this file holds
# the log-hygiene half of the pin; the retry semantics are in schema-preflight.test.sh.
set -euo pipefail

# shellcheck source=scripts/delivery/schema-preflight-testbed.sh
source "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/delivery/schema-preflight-testbed.sh"

# The bytes the stub writes into every response body it produces. No job-log line may contain
# them, so no failure diagnostic in the testbed prints the captured output either.
CANARY="LEAK_CANARY"

echo "=== the response body never reaches the job log ==="
# One run per branch that reads schema-preflight.json: success, 503 exhaustion, outright
# refusal, stale bundle. Each carries a positive assertion too, so that no run can satisfy its
# canary-free assertion by having produced nothing.
run "a successful run prints no response body" 0 native
expect_eq "and asked the migrator once" 1 "$(preflight_calls)"
expect_log "success path is canary-free" 0 "$CANARY"

run "an exhausted 503 prints no response body" 1 native STUB_FAIL_UNTIL=999 UNAVAILABLE_ATTEMPTS=2
expect_log "503 path is canary-free" 0 "$CANARY"
expect_log "and still says what it waited for" 1 \
  "::error::migrator never answered preflight after 2 attempts"

run "a refused preflight prints no response body" 1 native STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=500
expect_log "refusal path is canary-free" 0 "$CANARY"
expect_log "and still names the status it refused on" 1 \
  "::error::migration preflight refused or unavailable (HTTP 500)"

run "an unresolved stale bundle prints no response body" 1 native \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409
expect_log "stale-bundle path is canary-free" 0 "$CANARY"
expect_log "and the stale path did print its refusal" 1 "::error::"

echo
report_suite "schema-preflight log hygiene"
