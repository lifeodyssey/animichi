#!/bin/bash
# Mutation/behavioral test for check-pr-comments.sh against the tracked repo
# copy. The hook delegates to the canonical gate (scripts/local-gates/
# pr-review-check.sh) when present and falls back to the inline two-path check
# for repos without it; gh is mocked so no live GitHub call happens. The
# fallback ACK requires a real GitHub User (author type `User`) with an
# authorized association — a MEMBER bot's self-ACK must block (issue #1008
# finding 3 rework).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.claude/hooks/check-pr-comments.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$ROOT/review-verdict.json" "$ROOT/review-brief.md"' EXIT

MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"
cp "$FIX/mock-gh.sh" "$MOCK_BIN/gh"
chmod +x "$MOCK_BIN/gh"

fail=0
# run <label> <want> <command> <cwd> [env K=V ...]
run() {
  local label="$1" want="$2" cmd="$3" cwd="$4"
  shift 4
  local json out rc
  json="$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$cmd")"
  out="$(cd "$cwd" && printf '{"tool_input":{"command":%s}}' "$json" | env "$@" bash "$HOOK" 2>&1)" && rc=0 || rc=$?
  printf '%-52s exit=%s  %s\n' "$label" "$rc" "$(printf '%s' "$out" | head -1)"
  if [ "$rc" -ne "$want" ]; then fail=$((fail + 1)); fi
}

M="gh pr merge"
EMPTY_THREADS="$FIX/threads-empty.json"
ACTIVE_THREADS="$FIX/threads-active.json"
GRAPHQL_CLEAN="$FIX/github-graphql-comments.json"
GRAPHQL_FINDINGS_ONLY="$FIX/github-graphql-findings-only.json"
GRAPHQL_BOT_MEMBER="$FIX/github-graphql-bot-member-ack.json"

echo "--- canonical gate (Animichi): unresolved threads must BLOCK (exit 2) ---"
run "canonical: unresolved threads block" 2 "$M 710 -R lifeodyssey/animichi --rebase" "$ROOT" \
  MOCK_THREADS_FILE="$ACTIVE_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH"

echo
echo "--- canonical gate: top-level findings must be triaged by an authorized human ---"
run "canonical: unacked findings block" 2 "$M 710 -R lifeodyssey/animichi --rebase" "$ROOT" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_FINDINGS_ONLY" PATH="$MOCK_BIN:$PATH"
run "canonical: MEMBER bot ACK + marker block" 2 "$M 710 -R lifeodyssey/animichi --rebase" "$ROOT" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_BOT_MEMBER" PATH="$MOCK_BIN:$PATH"

echo
echo "--- canonical gate: clean threads + human ACK + marker PASS (exit 0) ---"
run "canonical: reviewed + acknowledged PR merges" 0 "$M 710 -R lifeodyssey/animichi --rebase" "$ROOT" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH"

echo
echo "--- canonical gate: local verdict artifact supplies the review decision ---"
cp "$FIX/brief.md" "$TMP/review-brief.md"
cp "$FIX/verdict-approve.json" "$TMP/review-verdict.json"
run "canonical: verdict artifact pair passes the check" 0 "$M 710 -R lifeodyssey/animichi" "$ROOT" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH" \
  REVIEW_VERDICT_FILE="$TMP/review-verdict.json" REVIEW_BRIEF_FILE="$TMP/review-brief.md"
run "canonical: verdict without its brief blocks (missing brief)" 2 "$M 710 -R lifeodyssey/animichi" "$ROOT" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH" \
  REVIEW_VERDICT_FILE="$TMP/review-verdict.json" REVIEW_BRIEF_FILE="$TMP/absent-brief.md"

echo
echo "--- canonical gate: verdict artifacts are never defaulted to the repo root ---"
# No env vars: the marker path applies and the hook must NOT read a repo-root
# review-verdict.json (root-artifact prohibition, issue #1008 finding 7). A
# planted repo-root artifact must be ignored, not silently consumed.
cp "$FIX/verdict-approve.json" "$ROOT/review-verdict.json"
cp "$FIX/brief.md" "$ROOT/review-brief.md"
run "canonical: no env vars uses the marker path (repo-root artifact ignored)" 0 "$M 710 -R lifeodyssey/animichi" "$ROOT" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH"
rm -f "$ROOT/review-verdict.json" "$ROOT/review-brief.md"
run "canonical: only one env var blocks (pair required)" 2 "$M 710 -R lifeodyssey/animichi" "$ROOT" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH" \
  REVIEW_VERDICT_FILE="$TMP/review-verdict.json"

echo
echo "--- non-Animichi fallback: the inline two-path guard still protects ---"
mkdir -p "$TMP/legacy"
run "fallback: unresolved threads block" 2 "$M 710 -R lifeodyssey/animichi --rebase" "$TMP/legacy" \
  MOCK_THREADS_FILE="$ACTIVE_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH"
run "fallback: unacked findings block" 2 "$M 710 -R lifeodyssey/animichi --rebase" "$TMP/legacy" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_FINDINGS_ONLY" PATH="$MOCK_BIN:$PATH"
run "fallback: MEMBER bot ACK blocks (not a User)" 2 "$M 710 -R lifeodyssey/animichi --rebase" "$TMP/legacy" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_BOT_MEMBER" PATH="$MOCK_BIN:$PATH"
run "fallback: authorized human ACK passes" 0 "$M 710 -R lifeodyssey/animichi --rebase" "$TMP/legacy" \
  MOCK_THREADS_FILE="$EMPTY_THREADS" MOCK_GRAPHQL_COMMENTS_FILE="$GRAPHQL_CLEAN" PATH="$MOCK_BIN:$PATH"

echo
echo "--- must PASS (exit 0): not an actual invocation ---"
run "unrelated command" 0 "git status" "$ROOT" PATH="$MOCK_BIN:$PATH"
run "words quoted in a message" 0 "git commit -m 'guard matched only \`$M <digits>\` before'" "$ROOT" PATH="$MOCK_BIN:$PATH"
run "words as a search pattern" 0 "grep -rn '$M' docs/" "$ROOT" PATH="$MOCK_BIN:$PATH"

echo
echo "--- fail-closed: broken gh must BLOCK, not wave through ---"
mkdir -p "$TMP/fakegh"
run "gh returns error" 2 "$M 710 -R lifeodyssey/animichi" "$ROOT" PATH="$TMP/fakegh:$PATH"

echo
if [ "$fail" -eq 0 ]; then
  echo "All check-pr-comments tests passed."
else
  echo "$fail test(s) failed." >&2
  exit 1
fi
