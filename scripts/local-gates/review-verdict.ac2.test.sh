#!/usr/bin/env bash
# AC2 behavioral tests for the local review verdict gate (issue #1008).
#   AC2 integration: either axis rejecting blocks, and changing the reviewed
#     base/head/brief invalidates the approval (complete new review required).
#   Merge-base resolution (issue #1008 finding 1 rework): the gate's default
#     base is the real merge-base of origin/main and HEAD — never a guessed
#     HEAD^ — and every unresolvable reference fails closed instead of
#     guessing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/scripts/local-gates/review-verdict.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
BASE='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
HEAD='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
BRIEF="$FIX/brief.md"
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

gate() { # gate <label> <want> <verdict> [--base B] [--head H] [--brief F]
  local label="$1" want="$2" verdict="$3"
  shift 3
  run "$label" "$want" "$GATE" gate "$verdict" "$@"
}

echo "=== AC2: approve / axis rejection / head-bound invalidation ==="
python3 - "$TMP/drop-head.json" "$FIX" <<'PY'
import json
import sys

path, fix = sys.argv[1], sys.argv[2]
verdict = json.load(open(f"{fix}/verdict-approve.json", encoding="utf-8"))
del verdict["head_sha"]
json.dump(verdict, open(path, "w"), indent=2)
PY
gate "approve verdict passes" 0 "$FIX/verdict-approve.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
gate "standards reject blocks" 1 "$FIX/verdict-reject-standards.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
gate "spec reject blocks (aggregate pass must not hide it)" 1 "$FIX/verdict-reject-spec.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
gate "changed head invalidates approval" 1 "$FIX/verdict-approve.json" --base "$BASE" --head "cccccccccccccccccccccccccccccccccccccccc" --brief "$BRIEF"
gate "changed base invalidates approval" 1 "$FIX/verdict-approve.json" --base "dddddddddddddddddddddddddddddddddddddddd" --head "$HEAD" --brief "$BRIEF"
gate "changed brief invalidates approval" 1 "$FIX/verdict-approve.json" --base "$BASE" --head "$HEAD" --brief "$TMP/other.md"
run "schema violation blocks the gate" 1 "$GATE" gate "$TMP/drop-head.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"

echo
echo "=== base resolution: the real merge-base, never a guessed HEAD^ ==="
# A throwaway git repo with divergent origin/main and topic history; the gate's
# default base must be the merge-base commit, and every unresolvable reference
# must fail closed instead of guessing.
GR="$TMP/gitrepo"
mkdir -p "$GR"
git -C "$GR" init -q
git -C "$GR" config user.email test@example.com
git -C "$GR" config user.name test
printf 'base\n' > "$GR/f"
git -C "$GR" add f
git -C "$GR" commit -q -m base
BASE_CT="$(git -C "$GR" rev-parse HEAD)"
git -C "$GR" update-ref refs/remotes/origin/main "$BASE_CT"
git -C "$GR" checkout -q -b remote-side
printf 'remote\n' > "$GR/f"
git -C "$GR" commit -q -am remote1
git -C "$GR" update-ref refs/remotes/origin/main "$(git -C "$GR" rev-parse HEAD)"
git -C "$GR" checkout -q -b topic "$BASE_CT"
printf 'topic\n' > "$GR/f"
git -C "$GR" commit -q -am topic1
HEAD_CT="$(git -C "$GR" rev-parse HEAD)"
MB="$(git -C "$GR" merge-base origin/main HEAD)"
[ "$MB" = "$BASE_CT" ] || { fail=$((fail + 1)); printf 'FAIL %-44s\n' "fixture: merge-base is the common ancestor"; }
python3 - "$TMP/mb-verdict.json" "$FIX" "$MB" "$HEAD_CT" <<'PY'
import json
import sys

path, fix, base, head = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
verdict = json.load(open(f"{fix}/verdict-approve.json", encoding="utf-8"))
verdict["base_sha"] = base
verdict["head_sha"] = head
json.dump(verdict, open(path, "w"), indent=2)
PY
run "default base resolves to the real merge-base (divergent history)" 0 \
  env REVIEW_GATE_GIT_ROOT="$GR" "$GATE" gate "$TMP/mb-verdict.json" --brief "$BRIEF"
run "explicit --base still wins over git resolution" 1 \
  env REVIEW_GATE_GIT_ROOT="$GR" "$GATE" gate "$TMP/mb-verdict.json" --base "$BASE" --brief "$BRIEF"

GR_NO_REMOTE="$TMP/noremote"
mkdir -p "$GR_NO_REMOTE"
git -C "$GR_NO_REMOTE" init -q
git -C "$GR_NO_REMOTE" config user.email test@example.com
git -C "$GR_NO_REMOTE" config user.name test
printf 'x\n' > "$GR_NO_REMOTE/f"
git -C "$GR_NO_REMOTE" add f
git -C "$GR_NO_REMOTE" commit -q -m base
run "missing origin/main reference fails closed" 2 \
  env REVIEW_GATE_GIT_ROOT="$GR_NO_REMOTE" "$GATE" gate "$FIX/verdict-approve.json" --brief "$BRIEF"

run "non-git directory fails closed" 2 \
  env REVIEW_GATE_GIT_ROOT="$TMP/not-a-repo" "$GATE" gate "$FIX/verdict-approve.json" --brief "$BRIEF"

echo
if [ "$fail" -eq 0 ]; then
  echo "All review-verdict AC2 tests passed."
else
  echo "$fail AC2 test(s) failed." >&2
  exit 1
fi
