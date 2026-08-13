#!/usr/bin/env bash
# Collect-shape boundary tests for the required PR check (issue #1008).
#   Merge-base (finding 3): collect records the real merge-base of the PR head
#     and base branch from the GitHub compare API — a PR behind main records a
#     base distinct from the base branch tip, and approval binds to that
#     merge-base, not the tip.
#   Finding 6: a PR body with duplicate `review-gate brief:` records fails
#     closed (exactly one canonical record is allowed).
#   Finding 5: a finding-shaped comment with malformed (numeric) field types
#     fails closed at collect instead of stringifying into an ignorable author.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
BASE='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
MERGE_BASE='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
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

assert_grep() { # assert_grep <label> <file> <pattern>
  if grep -q "$3" "$2"; then
    printf 'PASS %-44s\n' "$1"
  else
    fail=$((fail + 1)); printf 'FAIL %-44s %s\n' "$1" "$(cat "$2")"
  fi
}

MOCK_BIN="$TMP/bin"
mkdir -p "$MOCK_BIN"
cp "$FIX/mock-gh.sh" "$MOCK_BIN/gh"
chmod +x "$MOCK_BIN/gh"
DIGEST='3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1'

echo "=== merge-base: the recorded base is the real merge-base, not the base tip ==="
# A PR behind main: baseRefOid is the base branch tip (aaa) and the compare
# API reports a distinct common ancestor (eee); collect must record eee and
# approval must bind to it.
printf '%s\n' "{\"merge_base_commit\":{\"sha\":\"$MERGE_BASE\"}}" > "$TMP/compare.json"
run "collect behind main records the merge-base" 0 \
  env MOCK_COMPARE_FILE="$TMP/compare.json" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/mb" --pr 123 --repo lifeodyssey/animichi
assert_grep "collected base is the merge-base (distinct from the base tip)" "$TMP/mb/base_sha.json" "$MERGE_BASE"
if [ "$(cat "$TMP/mb/base_sha.json")" = "{\"base_sha\": \"$MERGE_BASE\"}" ]; then
  printf 'PASS %-44s\n' "merge-base != base branch tip"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "merge-base != base branch tip"
fi
# A marker bound to the merge-base approves; the same PR with the marker bound
# to the base tip (aaa) is stale and blocks.
mkdir -p "$TMP/mb-approve"
printf '{"head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n' > "$TMP/mb-approve/head_sha.json"
printf '{"base_sha": "%s"}\n' "$MERGE_BASE" > "$TMP/mb-approve/base_sha.json"
printf '{"brief_digest": "%s"}\n' "$DIGEST" > "$TMP/mb-approve/brief_digest.json"
printf '{"unresolved": 0}\n' > "$TMP/mb-approve/threads.json"
mk_marker() { # mk_marker <outdir> <base> <head>
  printf '%s\n' "[{\"author_association\":\"OWNER\",\"login\":\"owner\",\"author_type\":\"User\",\"id\":\"IC_mb\",\"url\":\"u\",\"body\":\"review-gate approval: standards=approve spec=approve base=$2 head=$3 brief=$DIGEST\"}]" > "$1/comments.json"
}
mk_marker "$TMP/mb-approve" "$MERGE_BASE" "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
run "approval uses the merge-base (marker bound to merge-base passes)" 0 \
  "$CHECK" check "$TMP/mb-approve"
mkdir -p "$TMP/mb-tip"
cp "$TMP/mb-approve/head_sha.json" "$TMP/mb-approve/brief_digest.json" "$TMP/mb-approve/threads.json" "$TMP/mb-tip/"
printf '{"base_sha": "%s"}\n' "$MERGE_BASE" > "$TMP/mb-tip/base_sha.json"
mk_marker "$TMP/mb-tip" "$BASE" "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
run "marker bound to the base tip (not the merge-base) blocks" 1 "$CHECK" check "$TMP/mb-tip"

echo
echo "=== finding 6: exactly one canonical PR-body brief record ==="
printf '%s\n' "{\"body\":\"review-gate brief: $DIGEST\"}" > "$TMP/body-single.json"
run "single canonical record collects cleanly" 0 \
  env MOCK_PR_BODY_FILE="$TMP/body-single.json" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/brief-single" --pr 123 --repo lifeodyssey/animichi
printf '%s\n' "{\"body\":\"review-gate brief: $DIGEST\"}" \
  "{\"body\":\"review-gate brief: $DIGEST\"}" \
  | python3 -c 'import sys,json; print(json.dumps({"body": "".join(json.loads(l)["body"]+"\n" for l in sys.stdin)}))' > "$TMP/body-dup.json"
run "duplicate brief records fail closed at collect" 2 \
  env MOCK_PR_BODY_FILE="$TMP/body-dup.json" MOCK_THREADS_FILE="$FIX/threads-empty.json" \
  MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-no-comments.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/brief-dup" --pr 123 --repo lifeodyssey/animichi
dup_out="$(printf '%s\n' "review-gate brief: $DIGEST" "review-gate brief: $DIGEST" \
  | python3 "$ROOT/scripts/local-gates/brief_record.py" 2>&1)" && dup_rc=0 || dup_rc=$?
if [ "$dup_rc" -eq 2 ]; then
  printf 'PASS %-44s\n' "brief_record rejects duplicate records directly"
else
  fail=$((fail + 1)); printf 'FAIL %-44s exit=%s %s\n' "brief_record rejects duplicate records directly" "$dup_rc" "$dup_out"
fi

echo
echo "=== finding 6: a canonical record coexisting with malformed text fails closed ==="
brief_case() { # brief_case <label> <want> <body-lines...>
  local label="$1" want="$2"; shift 2
  local out rc
  out="$(printf '%s\n' "$@" | python3 "$ROOT/scripts/local-gates/brief_record.py" 2>&1)" && rc=0 || rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf 'PASS %-44s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1)); printf 'FAIL %-44s want=%s got=%s %s\n' "$label" "$want" "$rc" "$out"
  fi
}
brief_case "single canonical record passes" 0 "review-gate brief: $DIGEST"
brief_case "no record yields an empty digest" 0 "no review record here"
brief_case "duplicate canonical records fail closed" 2 "review-gate brief: $DIGEST" "review-gate brief: $DIGEST"
brief_case "canonical + malformed marker-like record fails closed" 2 "review-gate brief: $DIGEST" "review-gate brief: not-a-digest"
brief_case "canonical + inline (non-canonical) marker text fails closed" 2 "review-gate brief: $DIGEST" "see the review-gate brief: $DIGEST in the docs"
brief_case "canonical + 65-hex digest fails closed" 2 "review-gate brief: $DIGEST" "review-gate brief: ${DIGEST}${DIGEST:0:1}"

echo
echo "=== finding 5: malformed GraphQL comment field types fail closed ==="
run "collect fails closed on numeric author_type/id" 2 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-malformed-types.json" \
  MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/malformed-types" --pr 123 --repo lifeodyssey/animichi
run "check fails closed on malformed field types in comments.json" 2 \
  "$CHECK" check "$FIX/pr-findings-malformed-types"

MUT="$TMP/mut"
mkdir -p "$MUT/scripts"
rm -rf "$MUT/scripts/local-gates"
cp -R "$ROOT/scripts/local-gates" "$MUT/scripts/local-gates"
python3 - "$ROOT/scripts/local-gates/comment_combine.py" "$MUT/scripts/local-gates/comment_combine.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "if value is not None and not isinstance(value, str):"
assert needle in source, "comment field type validation not found in comment_combine.py"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "if False:  # mutated: field type validation dropped", 1))
PY
run "red: dropped type validation stringifies the malformed fields" 0 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-malformed-types.json" \
  MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$MUT/scripts/local-gates/pr-review-check.sh" collect "$TMP/malformed-types-red" --pr 123 --repo lifeodyssey/animichi
run "restore+green: original type validation fails closed" 2 \
  env MOCK_GRAPHQL_COMMENTS_FILE="$FIX/github-graphql-malformed-types.json" \
  MOCK_THREADS_FILE="$FIX/threads-empty.json" PATH="$MOCK_BIN:$PATH" \
  "$CHECK" collect "$TMP/malformed-types-green" --pr 123 --repo lifeodyssey/animichi

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check boundary-shape tests passed."
else
  echo "$fail boundary-shape test(s) failed." >&2
  exit 1
fi
