#!/usr/bin/env bash
# Boundary tests for pr-review-gate-step.sh (issue #1008 findings 1 + 2):
#   - resolve-head fails closed on a successful-but-empty or malformed `gh pr
#     view` head: the workflow decides has_pr from this single non-empty 40-hex
#     output, so an unvalidated value would skip pending/collect/final status
#     while the job succeeds (source-mutated red -> restore -> green probe);
#   - pull_request_review_comment (inline review threads) routes like the other
#     PR-bearing events — resolve -> collect-check -> final-status — and a
#     routing regression that skips it fails open (mutation probe).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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

expect_head() { # expect_head <label> <out> <want>
  if [ "$2" = "$3" ]; then
    printf 'PASS %-44s\n' "$1"
  else
    fail=$((fail + 1)); printf 'FAIL %-44s got=%s\n' "$1" "$2"
  fi
}

MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"
cp "$FIX/mock-gh.sh" "$MOCK_BIN/gh"
chmod +x "$MOCK_BIN/gh"
STATUS_LOG="$TMP/status.log"
GITHUB_ARGS=(env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" PATH="$MOCK_BIN:$PATH")

echo
echo "=== finding 1: resolve-head fails closed on empty / malformed heads ==="
run "resolve-head prints the exact 40-hex head" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request_target lifeodyssey/animichi 710 "" ""
run "resolve-head blocks a successful-empty gh output" 2 \
  env MOCK_HEAD_EMPTY=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request_target lifeodyssey/animichi 710 "" ""
run "resolve-head blocks a malformed gh output" 2 \
  env MOCK_HEAD_MALFORMED=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request_target lifeodyssey/animichi 710 "" ""

echo
echo "--- source mutation probe: head validation is load-bearing (red -> restore -> green) ---"
MUT="$TMP/mut"
mkdir -p "$MUT"
reset_mut() { # reset_mut: restore pristine gate sources for the next probe
  rm -rf "$MUT/scripts/local-gates"
  mkdir -p "$MUT/scripts"
  cp -R "$ROOT/scripts/local-gates" "$MUT/scripts/local-gates"
}
reset_mut
MUT_STEP="$MUT/scripts/local-gates/pr-review-gate-step.sh"
python3 - "$MUT_STEP" <<'PY'
import sys

path = sys.argv[1]
source = open(path, encoding="utf-8").read()
needle = '  valid_sha "$head_sha" || block "resolved an invalid PR head for PR #$pr_number: $head_sha"'
assert needle in source, "resolve-head valid_sha guard not found"
open(path, "w", encoding="utf-8").write(source.replace(needle, '  true || block "resolved an invalid PR head for PR #$pr_number: $head_sha"', 1))
PY
run "red: mutated resolve-head accepts the empty head" 0 \
  env MOCK_HEAD_EMPTY=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$MUT_STEP" resolve-head pull_request_target lifeodyssey/animichi 710 "" ""
run "red: mutated resolve-head accepts the malformed head" 0 \
  env MOCK_HEAD_MALFORMED=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$MUT_STEP" resolve-head pull_request_target lifeodyssey/animichi 710 "" ""
run "restore: pristine sources restored" 0 reset_mut
run "green: pristine resolve-head still blocks the empty head" 2 \
  env MOCK_HEAD_EMPTY=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request_target lifeodyssey/animichi 710 "" ""
run "green: pristine resolve-head still blocks the malformed head" 2 \
  env MOCK_HEAD_MALFORMED=1 MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request_target lifeodyssey/animichi 710 "" ""

echo
echo "=== finding 2: pull_request_review_comment routes as a PR-bearing event ==="
PIN="$(env MOCK_STATUS_LOG="$STATUS_LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request_review_comment lifeodyssey/animichi 710 "" "")"
expect_head "resolve-head resolves the inline-thread event PR" "$PIN" "$HEAD"
run "collect-check passes for pull_request_review_comment" 0 "${GITHUB_ARGS[@]}" \
  "$STEP" collect-check lifeodyssey/animichi "$PIN" pull_request_review_comment 710 "" ""
run "inline-thread generation claims pending" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" claim-status lifeodyssey/animichi "$PIN" 90 1
run "finish-status posts the inline-thread event outcome" 0 \
  env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" finish-status lifeodyssey/animichi "$PIN" 90 1 success success
if grep -q "^success $PIN" "$STATUS_LOG"; then
  printf 'PASS %-44s\n' "inline-thread event runs the full head-bound status flow"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "inline-thread event runs the full head-bound status flow" "$(cat "$STATUS_LOG")"
fi

echo
echo "--- source mutation probe: inline-thread routing is load-bearing (red -> restore -> green) ---"
reset_mut
python3 - "$MUT_STEP" <<'PY'
import sys

path = sys.argv[1]
source = open(path, encoding="utf-8").read()
needle = "pull_request_target | pull_request_review | pull_request_review_comment)"
assert needle in source, "pull_request_review_comment routing not found"
open(path, "w", encoding="utf-8").write(source.replace(needle, "pull_request_target | pull_request_review)", 1))
PY
red_out="$(env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$MUT_STEP" resolve-head pull_request_review_comment lifeodyssey/animichi 710 "" "")" && red_rc=0 || red_rc=$?
if [ "$red_rc" -eq 0 ] && [ -z "$red_out" ]; then
  printf 'PASS %-44s\n' "red: mutated routing skips the inline-thread event (fail open)"
else
  fail=$((fail + 1)); printf 'FAIL %-44s rc=%s out=%s\n' "red: mutated routing skips the inline-thread event (fail open)" "$red_rc" "$red_out"
fi
run "restore: pristine sources restored" 0 reset_mut
green_out="$(env MOCK_STATUS_LOG="$STATUS_LOG" PATH="$MOCK_BIN:$PATH" \
  "$STEP" resolve-head pull_request_review_comment lifeodyssey/animichi 710 "" "")" && green_rc=0 || green_rc=$?
if [ "$green_rc" -eq 0 ] && [ "$green_out" = "$HEAD" ]; then
  printf 'PASS %-44s\n' "green: pristine routing still resolves the inline-thread event"
else
  fail=$((fail + 1)); printf 'FAIL %-44s rc=%s out=%s\n' "green: pristine routing still resolves the inline-thread event" "$green_rc" "$green_out"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check boundary-routing tests passed."
else
  echo "$fail boundary-routing test(s) failed." >&2
  exit 1
fi
