#!/usr/bin/env bash
# GitHub-boundary mutation tests for the required PR check (issue #1008).
#   Mutation probes (red -> restore -> green) prove the collect boundary is
#     load-bearing: author_type normalization, `author.__typename` query
#     selection, and the active-thread (isOutdated) filter.
#   Identity (issue #1008 finding 5 rework) and the brief-binding probe live in
#     pr-review-check.mutation-gate.test.sh; the AC6 reject -> repair ->
#     fresh-approve flow lives in pr-review-check.repair.test.sh.
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

pr() { # pr <label> <want> <dir> <verdict-file>
  run "$1" "$2" "$CHECK" check "$FIX/$3" --verdict "$4" --brief "$BRIEF" --base "$BASE"
}

MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"
cp "$FIX/mock-gh.sh" "$MOCK_BIN/gh"
chmod +x "$MOCK_BIN/gh"

MUT="$TMP/mut"
mkdir -p "$MUT/scripts"
reset_mut() { # reset_mut: restore pristine gate sources for the next probe
  rm -rf "$MUT/scripts/local-gates"
  cp -R "$ROOT/scripts/local-gates" "$MUT/scripts/local-gates"
}
reset_mut

echo "=== mutation probes: the GitHub boundary is load-bearing ==="
python3 - "$ROOT/scripts/local-gates/pr-review-check.sh" "$MUT/scripts/local-gates/pr-review-check.sh" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "author_type: (.author.__typename // \"\"),"
assert needle in source, "author_type normalization not found in pr-review-check.sh"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "author_type: (\"\"),", 1))
PY
run "red: dropped author_type normalization fails closed on real-shape findings" 2 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$MUT/scripts/local-gates/pr-review-check.sh" collect "$TMP/camelcase-mut-red" --pr 123 --repo lifeodyssey/animichi
run "restore+green: original normalization collects the real shape" 0 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/camelcase-mut-green" --pr 123 --repo lifeodyssey/animichi
run "restore+green: real-shape snapshot-bound human ACK passes" 0 \
  "$CHECK" check "$TMP/camelcase-mut-green" --verdict "$APPROVE" --brief "$BRIEF" --base "$BASE"

reset_mut
python3 - "$ROOT/scripts/local-gates/pr-review-check.sh" "$MUT/scripts/local-gates/pr-review-check.sh" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "author{ __typename login }"
assert needle in source, "comments query __typename selection not found in pr-review-check.sh"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "author{ login }", 1))
PY
run "red: dropped __typename from the query fails closed on real-shape findings" 2 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$MUT/scripts/local-gates/pr-review-check.sh" collect "$TMP/typename-mut-red" --pr 123 --repo lifeodyssey/animichi
run "restore+green: original query records __typename and collects" 0 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-comments.json" MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/typename-mut-green" --pr 123 --repo lifeodyssey/animichi

reset_mut
python3 - "$ROOT/scripts/local-gates/pr-review-check.sh" "$MUT/scripts/local-gates/pr-review-check.sh" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "select(.isResolved == false and .isOutdated == false)"
assert needle in source, "active-thread filter not found in pr-review-check.sh"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "select(.isResolved == false)", 1))
PY
run "red: dropped isOutdated filter counts outdated threads" 0 \
  env MOCK_THREADS_FILE="$FIX/threads-outdated-only.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$MUT/scripts/local-gates/pr-review-check.sh" collect "$TMP/thr-mut-red" --pr 123 --repo lifeodyssey/animichi
run "red: outdated threads then block the check" 1 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$TMP/thr-mut-red" --verdict "$APPROVE" --brief "$BRIEF" --base "$BASE"
env MOCK_THREADS_FILE="$FIX/threads-outdated-only.json" MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/thr-outdated" --pr 123 --repo lifeodyssey/animichi
run "restore+green: real collector ignores outdated threads" 0 \
  "$CHECK" check "$TMP/thr-outdated" --verdict "$APPROVE" --brief "$BRIEF" --base "$BASE"

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check mutation-boundary tests passed."
else
  echo "$fail mutation-boundary test(s) failed." >&2
  exit 1
fi
