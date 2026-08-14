#!/usr/bin/env bash
# Head-bound status tests for the required PR check (issue #1008, finding 1
# rework). The workflow resolves the PR head once (resolve-head), posts pending
# before the expensive quality steps, runs collect + check against the pinned
# head (collect-check), and posts the final status with `if: always()`
# semantics (final-status). These tests prove:
#   - status targets the exact resolved head_sha with the required ruleset
#     context, never GITHUB_SHA;
#   - pending is posted before the gate and the final failure/success after;
#   - a PR whose head advances between resolution and collection fails closed
#     and never posts success for the old head (finding 2);
#   - plain issue comments, push, and merge_group never post a fake PR status;
#   - the workflow fails closed when the status API itself cannot be called.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
STEP="$ROOT/scripts/local-gates/pr-review-gate-step.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
HEAD='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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

MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"
cp "$FIX/mock-gh.sh" "$MOCK_BIN/gh"
chmod +x "$MOCK_BIN/gh"
STATUS_LOG="$TMP/status.log"
GITHUB_ARGS=(env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" PATH="$MOCK_BIN:$PATH")

echo "=== head-bound commit status: the status subcommand ==="
run "status posts pending on the resolved head" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" status lifeodyssey/animichi "$HEAD" pending
run "status rejects a malformed head" 2 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" status lifeodyssey/animichi abc pending
run "status rejects an invalid state" 2 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" status lifeodyssey/animichi "$HEAD" maybe
run "status fails closed when the API cannot be called" 2 \
  env MOCK_STATUS_FAIL=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" status lifeodyssey/animichi "$HEAD" pending
if grep -q "pending $HEAD" "$STATUS_LOG"; then
  printf 'PASS %-44s\n' "status targets the exact resolved head_sha"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "status targets the exact resolved head_sha"
fi

echo
echo "=== head-bound status: resolve -> pending -> collect-check -> final ==="
rm -f "$STATUS_LOG"
PIN="$(env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request lifeodyssey/animichi 710 "" "")"
if [ "$PIN" = "$HEAD" ]; then
  printf 'PASS %-44s\n' "resolve-head prints the exact PR head"
else
  fail=$((fail + 1)); printf 'FAIL %-44s got=%s\n' "resolve-head prints the exact PR head" "$PIN"
fi
run "pending is posted on the resolved head" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" status lifeodyssey/animichi "$PIN" pending
run "issue_comment rejection collect-check exits non-zero" 1 \
  env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-active.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" collect-check lifeodyssey/animichi "$PIN" issue_comment "" 710 "https://github.com/lifeodyssey/animichi/pull/710"
run "final-status posts failure for the rejecting PR" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" final-status lifeodyssey/animichi "$PIN" failure
if head -1 "$STATUS_LOG" | grep -q "^pending $PIN" && tail -1 "$STATUS_LOG" | grep -q "^failure $PIN"; then
  printf 'PASS %-44s\n' "failure is posted after the gate for a rejecting PR"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "failure is posted after the gate for a rejecting PR" "$(cat "$STATUS_LOG")"
fi

echo
echo "=== pending before the gate, final status after (workflow order) ==="
rm -f "$STATUS_LOG"
run "pending is posted on the resolved head before the gate" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" status lifeodyssey/animichi "$PIN" pending
run "collect-check on a passing re-evaluation" 0 "${GITHUB_ARGS[@]}" \
  "$STEP" collect-check lifeodyssey/animichi "$PIN" pull_request_review 710 "" ""
run "final-status posts success for a success outcome" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" final-status lifeodyssey/animichi "$PIN" success
if head -1 "$STATUS_LOG" | grep -q "^pending $PIN" && tail -1 "$STATUS_LOG" | grep -q "^success $PIN"; then
  printf 'PASS %-44s\n' "pending is first and success is posted on the same head"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "pending is first and success is posted on the same head" "$(cat "$STATUS_LOG")"
fi
run "final-status posts failure for a failed outcome" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" final-status lifeodyssey/animichi "$PIN" failure
if tail -1 "$STATUS_LOG" | grep -q "^failure $PIN"; then
  printf 'PASS %-44s\n' "non-success gate outcomes post failure"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "non-success gate outcomes post failure"
fi

echo
echo "=== the status targets the resolved head, never GITHUB_SHA ==="
rm -f "$STATUS_LOG"
run "resolve-head ignores GITHUB_SHA" 0 \
  env GITHUB_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "${GITHUB_ARGS[@]}" \
  "$STEP" resolve-head pull_request lifeodyssey/animichi 710 "" ""
run "collect-check + final-status use the pinned head" 0 "${GITHUB_ARGS[@]}" \
  "$STEP" collect-check lifeodyssey/animichi "$PIN" pull_request 710 "" ""
run "final status posts on the pinned head" 0 \
  env GITHUB_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" final-status lifeodyssey/animichi "$PIN" success
if grep -q " $PIN" "$STATUS_LOG" && ! grep -q ' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$STATUS_LOG"; then
  printf 'PASS %-44s\n' "all status posts target the resolved PR head (not GITHUB_SHA)"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "all status posts target the resolved PR head (not GITHUB_SHA)" "$(cat "$STATUS_LOG")"
fi

echo
echo "=== finding 2: a PR head that advances between resolution and collect ==="
rm -f "$STATUS_LOG"
COUNTER="$TMP/head-counter"
rm -f "$COUNTER"
run "resolve-head pins the current head" 0 \
  env MOCK_ADVANCE_HEAD=1 MOCK_HEAD_COUNTER_FILE="$COUNTER" MOCK_STATUS_LOG="$STATUS_LOG" \
  MOCK_THREADS_FILE="$FIX/threads-empty.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" \
  PATH="$MOCK_BIN:$PATH" "$STEP" resolve-head pull_request lifeodyssey/animichi 710 "" ""
run "collect-check fails closed when the live head advanced" 2 \
  env MOCK_ADVANCE_HEAD=1 MOCK_HEAD_COUNTER_FILE="$COUNTER" MOCK_STATUS_LOG="$STATUS_LOG" \
  MOCK_THREADS_FILE="$FIX/threads-empty.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" \
  PATH="$MOCK_BIN:$PATH" "$STEP" collect-check lifeodyssey/animichi "$PIN" pull_request 710 "" ""
run "final status after an advanced head posts failure, never success" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" final-status lifeodyssey/animichi "$PIN" failure
if grep -q "^failure $PIN" "$STATUS_LOG" && ! grep -q "^success $PIN" "$STATUS_LOG"; then
  printf 'PASS %-44s\n' "never posts success for the pinned head after an advance"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "never posts success for the pinned head after an advance" "$(cat "$STATUS_LOG")"
fi
run "collect-check with a malformed pinned SHA fails closed" 2 \
  env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" collect-check lifeodyssey/animichi "abc" pull_request 710 "" ""

echo
echo "=== gate-step fails closed when the status API cannot be called ==="
rm -f "$STATUS_LOG"
run "final-status fails closed when the status API cannot be called" 2 \
  env MOCK_STATUS_FAIL=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" final-status lifeodyssey/animichi "$PIN" success

echo
echo "=== gate-step skips events without a PR (no fake review results) ==="
rm -f "$STATUS_LOG"
run "plain issue comment resolves to no PR (empty output)" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-active.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-findings-only.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head issue_comment lifeodyssey/animichi "" 5 ""
run "push event resolves to no PR" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-active.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-findings-only.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head push lifeodyssey/animichi "" "" ""
run "merge_group event resolves to no PR" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-active.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-findings-only.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head merge_group lifeodyssey/animichi "" "" ""
run "plain issue comment collect-check skips without posting" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-active.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-findings-only.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" collect-check lifeodyssey/animichi "$PIN" issue_comment "" 5 ""
if [ ! -s "$STATUS_LOG" ]; then
  printf 'PASS %-44s\n' "no status is posted for non-PR events"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "no status is posted for non-PR events" "$(cat "$STATUS_LOG")"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check boundary-status tests passed."
else
  echo "$fail boundary-status test(s) failed." >&2
  exit 1
fi
