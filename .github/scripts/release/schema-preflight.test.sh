#!/usr/bin/env bash
# What the release schema preflight's two retries do (#1590). The 503 wait is a real fix that
# reached main during a CD debugging session: it waits for a migrator published seconds ago
# that is not serving this request yet, then fails closed at its cap. The stale-bundle wait is
# older and waits for that migrator's bundle to catch up. They are independent budgets, and
# the sequence that proves it is a 503 wait followed by a stale bundle — the CD sequence both
# exist for. What must never reach the job log is pinned separately, in
# schema-preflight-log-hygiene.test.sh.
set -euo pipefail

# shellcheck source=scripts/delivery/schema-preflight-testbed.sh
source "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/delivery/schema-preflight-testbed.sh"

echo "=== the ordinary compatible answer ==="
run "a 200 on the first attempt passes without waiting" 0 native
expect_eq "and asks the migrator exactly once" 1 "$(preflight_calls)"
expect_eq "and never sleeps" "" "$(recorded_sleeps)"

echo
echo "=== a just-published migrator that is not answering yet (503) ==="
run "a 503 that recovers on the third attempt passes" 0 native STUB_FAIL_UNTIL=2
expect_eq "and it really retried three times" 3 "$(preflight_calls)"
expect_eq "and slept the default 15s between them" "$(printf '15\n15')" "$(recorded_sleeps)"

run "a 503 that never recovers fails closed" 1 native STUB_FAIL_UNTIL=999
expect_eq "after exactly the default cap of 10 attempts" 10 "$(preflight_calls)"
expect_log "and says what it was waiting on, not a container" 1 \
  "::error::migrator never answered preflight after 10 attempts"
expect_log "and no line blames a container that is not involved" 0 "container"

run "the attempt cap is a constant the caller can drive" 1 native \
  STUB_FAIL_UNTIL=999 UNAVAILABLE_ATTEMPTS=3 UNAVAILABLE_POLL_SECONDS=2
expect_eq "and three attempts is where it stops" 3 "$(preflight_calls)"
# Three attempts means two waits: the cap is checked before the sleep, so a run that is about
# to fail closed does not first burn a whole interval.
expect_eq "and the interval is the one it was given, once per gap" "$(printf '2\n2')" "$(recorded_sleeps)"

echo
echo "=== the 503 wait must not spend the stale-bundle budget ==="
# Every other stale case starts at 409 on call 1, so a counter shared between the two waits is
# invisible to them: here the 503 wait runs first and the stale budget must still be whole
# afterwards — 2 unavailable answers plus its own 3 attempts.
run "a 503 wait followed by a stale bundle keeps both budgets" 1 native \
  STUB_UNAVAILABLE_UNTIL=2 STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409 \
  UNAVAILABLE_POLL_SECONDS=0 BUNDLE_POLL_SECONDS=0
expect_eq "and the stale budget was still the full three" 5 "$(preflight_calls)"
expect_log "and it failed on the stale bundle, not the 503 cap" 1 \
  "::error::native preflight remained on a stale bundle"

echo
echo "=== a transport failure is not an unavailable migrator ==="
# No HTTP status came back at all, so neither wait applies: `set -e` aborts the run on the
# failed command substitution. That is fail-closed and deliberate, and it is pinned so nobody
# widens the 503 wait into a general curl retry by accident.
run "a curl transport failure aborts at once" 6 native STUB_TRANSPORT_FAIL_UNTIL=999
expect_eq "without asking a second time" 1 "$(preflight_calls)"
expect_eq "and without waiting" "" "$(recorded_sleeps)"

echo
echo "=== the stale-bundle 409 path is unchanged ==="
run "a 409 stale bundle that republishes in time passes" 0 native \
  STUB_FAIL_UNTIL=2 STUB_FAIL_CODE=409 BUNDLE_POLL_SECONDS=0
expect_eq "and it polled three times" 3 "$(preflight_calls)"
run "a 409 stale bundle that never moves fails closed" 1 native \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409 BUNDLE_POLL_SECONDS=0
expect_eq "after the existing three-attempt stale budget" 3 "$(preflight_calls)"
expect_log "and reports the stale bundle, not a 503 wait" 1 \
  "::error::native preflight remained on a stale bundle"
run "the stale budget is still the caller's to set" 1 native \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409 BUNDLE_POLL_SECONDS=0 STALE_BUNDLE_ATTEMPTS=5
expect_eq "and five attempts is where it stops" 5 "$(preflight_calls)"
run "atlas-only mode has no bundle to be stale, so a 409 refuses" 1 --atlas-only \
  STUB_FAIL_UNTIL=999 STUB_FAIL_CODE=409
expect_eq "on the first answer" 1 "$(preflight_calls)"

echo
report_suite "schema-preflight retry"
