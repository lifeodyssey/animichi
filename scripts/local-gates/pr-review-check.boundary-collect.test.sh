#!/usr/bin/env bash
# GitHub-boundary collect tests for the required PR check (issue #1008).
#   AC4 api: the collect boundary reads top-level PR comments over GitHub
#     GraphQL (`author.__typename` present), reads the PR-body canonical
#     brief-digest record, normalizes each page's camelCase payload into the
#     internal snake_case shape, and combines the pages; a snapshot-bound
#     OWNER/MEMBER/COLLABORATOR human ACK is accepted only after normalization.
#     The old `gh pr view --json comments` shape (author.login only) is
#     rejected as non-canonical input.
#   AC4 api: the GraphQL thread collector counts only active unresolved threads
#     and fails closed on malformed/missing thread data.
#   The merge-base (finding 3), duplicate-brief (finding 6), and malformed-type
#     (finding 5) collect-shape tests live in
#     pr-review-check.boundary-shape.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
BASE='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
BRIEF="$FIX/brief.md"
APPROVE="$FIX/verdict-approve.json"
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
MOCK_COLLECT=(env MOCK_THREADS_FILE="$FIX/threads-empty.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" PATH="$MOCK_BIN:$PATH")

echo "=== AC4 boundary regression: real GitHub GraphQL comment payload ==="
run "collect combines paginated GraphQL comments" 0 \
  "${MOCK_COLLECT[@]}" "$CHECK" collect "$TMP/camelcase" --pr 123 --repo lifeodyssey/animichi
python3 - "$TMP/camelcase/comments.json" <<'PY'
import json
import sys

comments = json.load(open(sys.argv[1], encoding="utf-8"))
assert len(comments) == 3, comments
assert comments[0]["author_association"] == "MEMBER", comments[0]
assert comments[0]["author_type"] == "Bot", comments[0]
assert comments[0]["id"] == "IC_kwDOcamel1", comments[0]
assert comments[0]["url"].startswith("https://github.com/lifeodyssey/animichi/pull/1"), comments[0]
assert comments[2]["author_association"] == "OWNER", comments[2]
assert comments[2]["author_type"] == "User", comments[2]
assert comments[2]["login"] == "owner", comments[2]
assert comments[2]["body"].startswith("线程判定"), comments[2]
PY
if [ "$?" -eq 0 ]; then
  printf 'PASS %-44s\n' "collect writes normalized snake_case comments"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "collect writes normalized snake_case comments"
fi
digest_record="$(cat "$TMP/camelcase/brief_digest.json")"
if printf '%s' "$digest_record" | grep -q '3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1'; then
  printf 'PASS %-44s\n' "collect records the canonical brief digest from the PR body"
else
  fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "collect records the canonical brief digest from the PR body" "$digest_record"
fi
run "authorized snapshot-bound human ACK accepted after normalization" 0 \
  "$CHECK" check "$TMP/camelcase" --verdict "$APPROVE" --brief "$BRIEF" --base "$BASE"
run "normalized comments + marker pass the check without a verdict" 0 \
  "$CHECK" check "$TMP/camelcase"

echo
echo "=== AC4 boundary: the old gh pr view comments shape is non-canonical ==="
run "legacy gh pr view comments shape is rejected (non-canonical)" 2 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-camelcase-comments.json" \
  MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/legacy-shape" --pr 123 --repo lifeodyssey/animichi

echo
echo "=== AC4 thread contract: GraphQL collector parses committed fixtures ==="
thr_collect() { # thr_collect <label> <want> <fixture> <dir>
  run "$1" "$2" env MOCK_THREADS_FILE="$FIX/$3" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" \
    PATH="$MOCK_BIN:$PATH" "$CHECK" collect "$TMP/$4" --pr 123 --repo lifeodyssey/animichi
}
thr_collect "outdated unresolved threads are ignored" 0 threads-outdated-only.json thr-outdated
thr_collect "active unresolved thread blocks" 0 threads-active.json thr-active
thr_collect "pagination sums only active threads" 0 threads-paginated.json thr-paged
thr_collect "malformed isOutdated fails closed" 2 threads-malformed.json thr-malformed
thr_collect "missing thread structure fails closed" 2 threads-missing.json thr-missing
thr_collect "empty thread nodes are zero, not a block" 0 threads-empty.json thr-empty

assert_unresolved() { # assert_unresolved <dir> <want>
  [ "$(cat "$TMP/$1/threads.json")" = "{\"unresolved\": $2}" ] \
    && printf 'PASS %-44s unresolved=%s\n' "$1 counts only active threads" "$2" \
    || { fail=$((fail + 1)); printf 'FAIL %-44s\n' "$1 threads.json mismatch"; }
}
assert_unresolved thr-outdated 0
assert_unresolved thr-active 1
assert_unresolved thr-paged 1

check_dir() { # check_dir <label> <want> <dir>
  run "$1" "$2" "$CHECK" check "$TMP/$3" --verdict "$APPROVE" --brief "$BRIEF" --base "$BASE"
}
check_dir "outdated-only threads do not block the check" 0 thr-outdated
check_dir "active thread blocks the check" 1 thr-active
check_dir "paginated active threads block the check" 1 thr-paged
check_dir "empty threads are PR-eligible" 0 thr-empty

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check boundary-collect tests passed."
else
  echo "$fail boundary-collect test(s) failed." >&2
  exit 1
fi
