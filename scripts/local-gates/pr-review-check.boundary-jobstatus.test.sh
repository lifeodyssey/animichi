#!/usr/bin/env bash
# Whole-job-outcome status tests for the required PR check (issue #1008,
# finding 1). The workflow now posts the final review-gate status as the LAST
# step and derives success from the whole-job outcome (`job.status`), not just
# the collect+check step. These tests prove the step-level semantics behind
# that: any non-success whole-job outcome (failure, cancelled) posts failure on
# the pinned head, and a success posted before a later failure is overwritten
# by the final failure — a later quality-step or actionlint failure can never
# leave the PR head green.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
STEP="$ROOT/scripts/local-gates/pr-review-gate-step.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
PIN='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"
cp "$FIX/mock-gh.sh" "$MOCK_BIN/gh"
chmod +x "$MOCK_BIN/gh"
STATUS_LOG="$TMP/status.log"

fail=0
run() { # run <label> <want-exit> <cmd...>
  local label="$1" want="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf 'PASS %-44s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1)); printf 'FAIL %-44s want=%s got=%s %s\n' "$label" "$want" "$rc" "$out"
  fi
}

last_is_failure() { # last_is_failure <label>
  if tail -1 "$STATUS_LOG" | grep -q "^failure $PIN"; then
    printf 'PASS %-44s\n' "$1"
  else
    fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "$1" "$(cat "$STATUS_LOG")"
  fi
}

echo "=== finding 1: whole-job outcomes map to the head status ==="
rm -f "$STATUS_LOG"
for outcome in failure cancelled skipped; do
  run "final-status maps $outcome to failure" 0 \
    env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
    "$STEP" final-status lifeodyssey/animichi "$PIN" "$outcome"
  last_is_failure "non-success whole-job outcome ($outcome) leaves the head red"
done

echo
echo "=== finding 1: a later failure overwrites a stale green ==="
rm -f "$STATUS_LOG"
run "gate evaluates green first (stale success posted)" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" status lifeodyssey/animichi "$PIN" success
run "a later step fails; the whole-job outcome re-posts failure" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" final-status lifeodyssey/animichi "$PIN" failure
last_is_failure "the final failure overwrites the stale green (never merge-eligible)"

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check boundary-jobstatus tests passed."
else
  echo "$fail boundary-jobstatus test(s) failed." >&2
  exit 1
fi
