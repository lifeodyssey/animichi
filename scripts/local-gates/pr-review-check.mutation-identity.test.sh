#!/usr/bin/env bash
# Identity-rework mutation tests for the required PR check (issue #1008).
#   Identity (finding 5 rework): two malformed same-count findings with no
#     id/url must never collide into one token and preserve an old ack; the
#     stable-identity guard fails closed (probed).
#   Finding 5: a comments.json entry with malformed (numeric) author_type/id
#     fails closed at check instead of stringifying into an ignorable author;
#     dropping the type check lets the malformed finding become ignorable and
#     the gate pass (probed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
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
    printf 'PASS %-44s exit=%s\n' "$label" "$rc"
  else
    fail=$((fail + 1)); printf 'FAIL %-44s want=%s got=%s %s\n' "$label" "$want" "$rc" "$out"
  fi
}

MUT="$TMP/mut"
mkdir -p "$MUT/scripts"
reset_mut() { # reset_mut: restore pristine gate sources for the next probe
  rm -rf "$MUT/scripts/local-gates"
  cp -R "$ROOT/scripts/local-gates" "$MUT/scripts/local-gates"
}
reset_mut

echo
echo "=== identity rework: no stable id/url must fail closed, never collide ==="
reset_mut
python3 - "$ROOT/scripts/local-gates/pr_findings.py" "$MUT/scripts/local-gates/pr_findings.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = (
    '    if comment.id:\n'
    '        return comment.id\n'
    '    if comment.url:\n'
    '        return comment.url\n'
    '    raise ValueError(\n'
    '        "managed-finding comment has no stable identity; "\n'
    '        "both id and url are empty"\n'
    '    )'
)
assert needle in source, "stable identity not found in pr_findings.py"
open(dst, "w", encoding="utf-8").write(
    source.replace(needle, '    return "no-id"  # mutated: identity fallback restored', 1)
)
PY
python3 - "$TMP/no-id" "$BASE" <<'PY'
import json
import os
import sys

outdir, base = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
json.dump({"head_sha": "b" * 40}, open(f"{outdir}/head_sha.json", "w"))
json.dump({"base_sha": base}, open(f"{outdir}/base_sha.json", "w"))
json.dump({"brief_digest": "3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1"}, open(f"{outdir}/brief_digest.json", "w"))
json.dump({"unresolved": 0}, open(f"{outdir}/threads.json", "w"))
comments = [
    {"author_association": "MEMBER", "login": "coderabbitai[bot]", "author_type": "Bot",
     "id": "", "url": "", "body": "<code>🐞 Bugs (2)</code> <code>Rule violations (0)</code>"},
    {"author_association": "MEMBER", "login": "coderabbitai[bot]", "author_type": "Bot",
     "id": "", "url": "", "body": "<code>🐞 Bugs (2)</code> <code>Rule violations (0)</code>"},
]
json.dump(comments, open(f"{outdir}/comments.json", "w"))
PY
mut_snap="$("$MUT/scripts/local-gates/pr-review-check.sh" check "$TMP/no-id" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["findings"]["snapshot"])')" || true
python3 - "$TMP/no-id" "$mut_snap" <<'PY'
import json
import sys

outdir, snapshot = sys.argv[1], sys.argv[2]
comments = json.load(open(f"{outdir}/comments.json", encoding="utf-8"))
comments.append({"author_association": "OWNER", "login": "owner", "author_type": "User",
                 "id": "IC_noack", "url": "uack",
                 "body": "线程判定: triaged. snapshot=" + snapshot + "\n"
                         "review-gate approval: standards=approve spec=approve "
                         "base=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "
                         "head=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "
                         "brief=3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1"})
json.dump(comments, open(f"{outdir}/comments.json", "w"), indent=2)
PY
run "red: no-id fallback lets two malformed findings collide and keep the old ack" 0 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$TMP/no-id"
run "restore+green: stable identity fails closed on identity-less findings" 2 \
  "$CHECK" check "$TMP/no-id"

echo
echo "=== finding 5: check-level malformed field types fail closed ==="
run "restore+green: check fails closed on malformed author_type/id" 2 \
  "$CHECK" check "$FIX/pr-findings-malformed-types"
reset_mut
python3 - "$ROOT/scripts/local-gates/pr_review_check.py" "$MUT/scripts/local-gates/pr_review_check.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "    if not isinstance(value, str):"
assert needle in source, "comment field type validation not found in pr_review_check.py"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "    if False:  # mutated: field type validation dropped", 1))
PY
run "red: dropped type validation stringifies the malformed finding into ignorable" 0 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$FIX/pr-findings-malformed-types"

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check mutation-identity tests passed."
else
  echo "$fail mutation-identity test(s) failed." >&2
  exit 1
fi
