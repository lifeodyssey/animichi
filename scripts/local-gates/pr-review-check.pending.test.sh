#!/usr/bin/env bash
# Pending/failure contract tests for the required PR review gate (issue #1178).
# Missing human evidence is pending; evidence of a reviewed violation is
# failure. The workflow may only publish pending when the entire job is green.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
STEP="$ROOT/scripts/local-gates/pr-review-gate-step.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
BASE='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
run() { # run <label> <want-exit> <cmd...>
  local label="$1" want="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf 'PASS %-52s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1)); printf 'FAIL %-52s want=%s got=%s %s\n' "$label" "$want" "$rc" "$out"
  fi
}

state_of() { # state_of <gate-output>
  printf '%s\n' "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])'
}

echo "=== direct gate state distinguishes waiting from violation ==="
pending="$("$CHECK" check "$FIX/pr-clean")" && pending_rc=0 || pending_rc=$?
if [ "$pending_rc" -eq 1 ] && [ "$(state_of "$pending")" = "pending" ]; then
  printf 'PASS %-52s\n' "missing review approval is pending"
else
  fail=$((fail + 1)); printf 'FAIL %-52s rc=%s output=%s\n' "missing review approval is pending" "$pending_rc" "$pending"
fi

findings_pending="$("$CHECK" check "$FIX/pr-findings-unacked")" && findings_rc=0 || findings_rc=$?
if [ "$findings_rc" -eq 1 ] && [ "$(state_of "$findings_pending")" = "pending" ]; then
  printf 'PASS %-52s\n' "missing findings acknowledgement is pending"
else
  fail=$((fail + 1)); printf 'FAIL %-52s rc=%s output=%s\n' "missing findings acknowledgement is pending" "$findings_rc" "$findings_pending"
fi

failure="$("$CHECK" check "$FIX/pr-threads-open" --verdict "$FIX/verdict-approve.json" --brief "$FIX/brief.md" --base "$BASE")" && failure_rc=0 || failure_rc=$?
if [ "$failure_rc" -eq 1 ] && [ "$(state_of "$failure")" = "failure" ]; then
  printf 'PASS %-52s\n' "unresolved reviewed thread is failure"
else
  fail=$((fail + 1)); printf 'FAIL %-52s rc=%s output=%s\n' "unresolved reviewed thread is failure" "$failure_rc" "$failure"
fi

invalid="$("$CHECK" check "$FIX/pr-unauthorized-ack" --verdict "$FIX/verdict-approve.json" --brief "$FIX/brief.md" --base "$BASE")" && invalid_rc=0 || invalid_rc=$?
if [ "$invalid_rc" -eq 1 ] && [ "$(state_of "$invalid")" = "failure" ]; then
  printf 'PASS %-52s\n' "invalid acknowledgement actor is failure"
else
  fail=$((fail + 1)); printf 'FAIL %-52s rc=%s output=%s\n' "invalid acknowledgement actor is failure" "$invalid_rc" "$invalid"
fi

stale="$("$CHECK" check "$FIX/pr-marker-stale")" && stale_rc=0 || stale_rc=$?
if [ "$stale_rc" -eq 1 ] && [ "$(state_of "$stale")" = "failure" ]; then
  printf 'PASS %-52s\n' "stale approval is failure"
else
  fail=$((fail + 1)); printf 'FAIL %-52s rc=%s output=%s\n' "stale approval is failure" "$stale_rc" "$stale"
fi

# A PR that never went through the review handoff carries no `review-gate brief:`
# record. Absent evidence is judged like any other absent evidence — the gate
# waits — while a marker that cannot bind to it stays a refusal.
absent="$("$CHECK" check "$FIX/pr-brief-absent")" && absent_rc=0 || absent_rc=$?
if [ "$absent_rc" -eq 1 ] && [ "$(state_of "$absent")" = "pending" ]; then
  printf 'PASS %-52s\n' "no brief record without a marker is pending"
else
  fail=$((fail + 1)); printf 'FAIL %-52s rc=%s output=%s\n' "no brief record without a marker is pending" "$absent_rc" "$absent"
fi

unbound="$("$CHECK" check "$FIX/pr-marker-unbound")" && unbound_rc=0 || unbound_rc=$?
if [ "$unbound_rc" -eq 1 ] && [ "$(state_of "$unbound")" = "failure" ]; then
  printf 'PASS %-52s\n' "marker with no brief record to bind is failure"
else
  fail=$((fail + 1)); printf 'FAIL %-52s rc=%s output=%s\n' "marker with no brief record to bind is failure" "$unbound_rc" "$unbound"
fi

echo
echo "=== workflow status preserves pending and redresses later failures ==="
MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"
cp "$FIX/mock-gh.sh" "$MOCK_BIN/gh"
chmod +x "$MOCK_BIN/gh"
STATUS_LOG="$TMP/status.log"
OUTPUT="$TMP/github-output"
MOCK_ENV=(env GH_TOKEN=test GITHUB_OUTPUT="$OUTPUT" MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH")

run "missing evidence keeps collect-check successful" 0 "${MOCK_ENV[@]}" "$STEP" collect-check lifeodyssey/animichi bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb issue_comment "" 710 "https://github.com/lifeodyssey/animichi/pull/710"
if grep -qx 'gate_state=pending' "$OUTPUT"; then
  printf 'PASS %-52s\n' "collect-check records pending for the final status"
else
  detail="missing output: $OUTPUT"
  if [ -f "$OUTPUT" ]; then detail="$(cat "$OUTPUT")"; fi
  fail=$((fail + 1)); printf 'FAIL %-52s %s\n' "collect-check records pending for the final status" "$detail"
fi
# The workflow's own entry point, not just `collect-check`. It has to leave a
# state behind on every path: when evaluation aborted without one, the workflow's
# `final_state` fell back to failure with no reason attached and published a bare
# red that said nothing about why.
TARGET_OUTPUT="$TMP/github-output-target"
run "collect-target completes on a PR awaiting review" 0 "${MOCK_ENV[@]}" GITHUB_OUTPUT="$TARGET_OUTPUT" "$STEP" collect-target pr lifeodyssey/animichi bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 710 ""
if grep -qx 'gate_state=pending' "$TARGET_OUTPUT"; then
  printf 'PASS %-52s\n' "collect-target records pending, never nothing"
else
  detail="missing output: $TARGET_OUTPUT"
  if [ -f "$TARGET_OUTPUT" ]; then detail="$(cat "$TARGET_OUTPUT")"; fi
  fail=$((fail + 1)); printf 'FAIL %-52s %s\n' "collect-target records pending, never nothing" "$detail"
fi
# The verdict is not the job's conclusion. A blocked PR has to leave a recorded
# state behind a green step, or the workflow reads as broken on every PR that is
# merely still waiting — which is most of a PR's life, and trains the reader to
# ignore red. Only an inability to evaluate belongs in the job's own result.
BLOCKED_OUTPUT="$TMP/github-output-blocked"
BLOCKED_ENV=(env GH_TOKEN=test GITHUB_OUTPUT="$BLOCKED_OUTPUT" MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-active.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH")
run "collect-target completes on a blocked PR" 0 "${BLOCKED_ENV[@]}" "$STEP" collect-target pr lifeodyssey/animichi bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 710 ""
if grep -qx 'gate_state=failure' "$BLOCKED_OUTPUT"; then
  printf 'PASS %-52s\n' "a blocked verdict is recorded, not thrown"
else
  detail="missing output: $BLOCKED_OUTPUT"
  if [ -f "$BLOCKED_OUTPUT" ]; then detail="$(cat "$BLOCKED_OUTPUT")"; fi
  fail=$((fail + 1)); printf 'FAIL %-52s %s\n' "a blocked verdict is recorded, not thrown" "$detail"
fi
run "pending generation is claimed" 0 "${MOCK_ENV[@]}" "$STEP" claim-status lifeodyssey/animichi bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 50 1
run "a green pending job posts pending" 0 "${MOCK_ENV[@]}" "$STEP" finish-status lifeodyssey/animichi bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 50 1 success pending
if tail -1 "$STATUS_LOG" | grep -q '^pending bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb '; then
  printf 'PASS %-52s\n' "pending evidence is not reported as failure"
else
  fail=$((fail + 1)); printf 'FAIL %-52s %s\n' "pending evidence is not reported as failure" "$(cat "$STATUS_LOG")"
fi
run "new failure generation is claimed" 0 "${MOCK_ENV[@]}" "$STEP" claim-status lifeodyssey/animichi bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 51 1
run "a later job failure overrides pending" 0 "${MOCK_ENV[@]}" "$STEP" finish-status lifeodyssey/animichi bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 51 1 failure pending
if tail -1 "$STATUS_LOG" | grep -q '^failure bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb '; then
  printf 'PASS %-52s\n' "quality failure overrides pending"
else
  fail=$((fail + 1)); printf 'FAIL %-52s %s\n' "quality failure overrides pending" "$(cat "$STATUS_LOG")"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check pending tests passed."
else
  echo "$fail pending test(s) failed." >&2
  exit 1
fi
