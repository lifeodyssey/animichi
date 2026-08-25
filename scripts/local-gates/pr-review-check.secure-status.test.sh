#!/usr/bin/env bash
# Trusted-producer boundary tests: PR/queue target resolution, status-generation
# ownership, pinned evidence, and fail-closed merge-queue bridging.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STEP="$ROOT/scripts/local-gates/pr-review-gate-step.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cp "$FIX/mock-gh.sh" "$TMP/bin/gh"
chmod +x "$TMP/bin/gh"

HEAD='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
QUEUE='cccccccccccccccccccccccccccccccccccccccc'
LOG="$TMP/status.log"
OUT="$TMP/output"
fail=0

run() { # run <label> <exit> <command...>
  local label="$1" want="$2" rc
  shift 2
  "$@" >/dev/null 2>&1 && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then printf 'PASS %s\n' "$label"; else fail=$((fail + 1)); printf 'FAIL %s want=%s got=%s\n' "$label" "$want" "$rc"; fi
}

mock() { # mock <command...>
  env PATH="$TMP/bin:$PATH" MOCK_STATUS_LOG="$LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" "$@"
}

resolve_pr() {
  : > "$OUT"
  GITHUB_OUTPUT="$OUT" mock "$STEP" resolve-target pull_request_target lifeodyssey/animichi 710 '' '' '' '' '' ''
}

resolve_queue() {
  : > "$OUT"
  GITHUB_OUTPUT="$OUT" mock "$STEP" resolve-target workflow_run lifeodyssey/animichi '' '' '' merge_group success "$QUEUE" 99
}

echo '=== trusted target resolution ==='
run 'pull_request_target resolves the pinned PR head' 0 resolve_pr
grep -q "head_sha=$HEAD" "$OUT" || fail=$((fail + 1))
run 'workflow_run resolves the synthetic merge-group SHA' 0 resolve_queue
grep -q "target_kind=queue" "$OUT" || fail=$((fail + 1))
run 'direct merge_group candidate event is ignored' 0 env GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" "$STEP" resolve-target merge_group lifeodyssey/animichi '' '' '' '' '' '' ''
run 'malformed workflow_run SHA fails closed' 2 env GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" "$STEP" resolve-target workflow_run lifeodyssey/animichi '' '' '' merge_group success nope 99

echo '=== newest generation owns final publication ==='
: > "$LOG"
run 'new generation claims pending' 0 mock "$STEP" claim-status lifeodyssey/animichi "$HEAD" 42 2
run 'owner can publish success' 0 mock "$STEP" finish-status lifeodyssey/animichi "$HEAD" 42 2 success success
grep -q "^success $HEAD .*runs/42/attempts/2" "$LOG" || fail=$((fail + 1))
before="$(wc -l < "$LOG")"
run 'superseded generation cannot overwrite' 0 env MOCK_CURRENT_STATUS_URL='https://github.com/lifeodyssey/animichi/actions/runs/43/attempts/1' PATH="$TMP/bin:$PATH" MOCK_STATUS_LOG="$LOG" "$STEP" finish-status lifeodyssey/animichi "$HEAD" 42 2 success success
after="$(wc -l < "$LOG")"
[ "$before" = "$after" ] || fail=$((fail + 1))
run 'failed job publishes failure' 0 mock "$STEP" claim-status lifeodyssey/animichi "$HEAD" 44 1
run 'failure overrides a claimed success state' 0 mock "$STEP" finish-status lifeodyssey/animichi "$HEAD" 44 1 failure success
grep -q "^failure $HEAD .*runs/44/attempts/1" "$LOG" || fail=$((fail + 1))

echo '=== pinned PR and merge-queue evidence ==='
run 'PR evidence passes against the pinned head' 0 env GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_STATUS_LOG="$LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" "$STEP" collect-target pr lifeodyssey/animichi "$HEAD" 710 ''
queue_gate() {
  env GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" \
    MOCK_STATUS_LOG="$LOG" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
    MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" "$@"
}

run 'queue passes only with live run and directly associated PR evidence' 0 queue_gate "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'run from another repository blocks the queue bridge' 2 env MOCK_RUN_REPO=someone/else GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'non-merge-group run blocks the queue bridge' 2 env MOCK_RUN_EVENT=pull_request GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'run for another synthetic SHA blocks the queue bridge' 2 env MOCK_RUN_HEAD="$HEAD" GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'run from another workflow path blocks the queue bridge' 2 env MOCK_RUN_PATH=.github/workflows/other.yml GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'failed live run blocks the queue bridge' 2 env MOCK_RUN_CONCLUSION=failure GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'stale CI check from another run blocks the bridge' 2 env GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_CI_RUN_ID=100 MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'missing PR Verification check blocks the bridge' 2 env MOCK_MISSING_CHECK='PR Verification' GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'missing Security check blocks the bridge' 2 env MOCK_MISSING_CHECK=Security GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'failed Security check blocks the bridge' 2 env MOCK_FAILED_CHECK=Security GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'queue without directly associated PRs fails closed' 2 env MOCK_QUEUE_PRS_JSON='[]' GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'duplicate associated PRs fail closed' 2 env MOCK_QUEUE_PRS_JSON='[{"number":710,"head":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"base":{"ref":"main"}},{"number":710,"head":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"base":{"ref":"main"}}]' GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'associated PR targeting another branch fails closed' 2 env MOCK_QUEUE_PRS_JSON='[{"number":710,"head":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"base":{"ref":"release"}}]' GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99
run 'malformed associated PR head fails closed' 2 env MOCK_QUEUE_PRS_JSON='[{"number":710,"head":{"sha":"bad"},"base":{"ref":"main"}}]' GITHUB_OUTPUT="$OUT" PATH="$TMP/bin:$PATH" MOCK_QUEUE_SHA="$QUEUE" "$STEP" collect-target queue lifeodyssey/animichi "$QUEUE" '' 99

if [ "$fail" -eq 0 ]; then
  echo 'All secure Review Gate status tests passed.'
else
  printf '%s secure status test(s) failed.\n' "$fail" >&2
  exit 1
fi
