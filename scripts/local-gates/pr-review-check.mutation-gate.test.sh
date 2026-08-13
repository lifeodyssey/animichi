#!/usr/bin/env bash
# Gate-level mutation tests for the required PR check (issue #1008).
#   Mutation probes (red -> restore -> green) prove the load-bearing gates:
#     pinned-SHA validation, identity-aware finding snapshot, and marker brief
#     binding.
#   Brief binding (finding 7 rework): the marker brief must match the canonical
#     record; dropping the comparison accepts a wrong-but-well-formed digest
#     (probed). The stable-identity guard and finding-5 malformed-type probes
#     live in pr-review-check.mutation-identity.test.sh; the collect boundary
#     probes live in pr-review-check.mutation-boundary.test.sh; the AC6 reject
#     -> repair -> fresh-approve flow lives in pr-review-check.repair.test.sh.
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

# A malformed-head fixture for the pinned-SHA mutation probe.
mkdir -p "$TMP/head-short"
printf '{"head_sha": "abc"}\n' > "$TMP/head-short/head_sha.json"
printf '{"base_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n' > "$TMP/head-short/base_sha.json"
printf '{"unresolved": 0}\n' > "$TMP/head-short/threads.json"
printf '[]\n' > "$TMP/head-short/comments.json"
printf '{"brief_digest": "3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1"}\n' > "$TMP/head-short/brief_digest.json"

MUT="$TMP/mut"
mkdir -p "$MUT/scripts"
reset_mut() { # reset_mut: restore pristine gate sources for the next probe
  rm -rf "$MUT/scripts/local-gates"
  cp -R "$ROOT/scripts/local-gates" "$MUT/scripts/local-gates"
}
reset_mut

echo
echo "=== mutation probes: pinned SHA, identity, human-only authorization ==="
reset_mut
python3 - "$ROOT/scripts/local-gates/pr_review_check.py" "$MUT/scripts/local-gates/pr_review_check.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "if not isinstance(value, str) or len(value) != 40 or not HEX_RE.match(value):"
assert needle in source, "pinned-SHA validation not found in pr_review_check.py"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "if False:  # mutated: pinned SHA validation dropped", 1))
PY
run "red: dropped SHA validation accepts a malformed head into the gate" 1 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$TMP/head-short"
run "restore+green: original validation fails closed" 2 "$CHECK" check "$TMP/head-short"

reset_mut
python3 - "$ROOT/scripts/local-gates/pr_findings.py" "$MUT/scripts/local-gates/pr_findings.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = 'return f"{kind}:{count}:{identity}:{body_digest}"'
assert needle in source, "identity-aware finding token not found in pr_findings.py"
open(dst, "w", encoding="utf-8").write(source.replace(needle, 'return f"{kind}:{count}"  # mutated: identity dropped', 1))
PY
python3 - "$TMP/identity" "$BASE" <<'PY'
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
     "id": "IC_probe1", "url": "u1",
     "body": "<code>🐞 Bugs (2)</code> <code>Rule violations (0)</code>"},
]
json.dump(comments, open(f"{outdir}/comments.json", "w"))
PY
mut_snap="$("$MUT/scripts/local-gates/pr-review-check.sh" check "$TMP/identity" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["findings"]["snapshot"])')" || true
python3 - "$TMP/identity" "$mut_snap" <<'PY'
import json
import sys

outdir, snapshot = sys.argv[1], sys.argv[2]
comments = json.load(open(f"{outdir}/comments.json", encoding="utf-8"))
comments.append({
    "author_association": "OWNER", "login": "owner", "author_type": "User",
    "id": "IC_probeack", "url": "uack",
    "body": "线程判定: triaged. snapshot=" + snapshot + "\n"
            "review-gate approval: standards=approve spec=approve "
            "base=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "
            "head=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "
            "brief=3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1",
})
comments.append({"author_association": "MEMBER", "login": "qodo-merge[bot]", "author_type": "Bot",
                 "id": "IC_probe2", "url": "u2", "body": "Code review update: Bugs (2)"})
json.dump(comments, open(f"{outdir}/comments.json", "w"))
PY
run "red: count-only tokens ignore the later same-count finding" 0 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$TMP/identity"
run "restore+green: identity-aware snapshot stales the old ACK" 1 \
  "$CHECK" check "$TMP/identity"

echo
echo "=== brief-binding rework: wrong-but-well-formed marker digest must block ==="
reset_mut
python3 - "$ROOT/scripts/local-gates/pr_approval.py" "$MUT/scripts/local-gates/pr_approval.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "    if brief == expected_brief:"
assert needle in source, "marker brief comparison not found in pr_approval.py"
open(dst, "w", encoding="utf-8").write(
    source.replace(needle, "    if True:  # mutated: marker brief comparison dropped", 1)
)
PY
run "red: dropped brief comparison accepts a wrong-but-well-formed digest" 0 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$FIX/pr-marker-brief-mismatch"
run "restore+green: original brief binding rejects the wrong digest" 1 \
  "$CHECK" check "$FIX/pr-marker-brief-mismatch"

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check mutation-gate tests passed."
else
  echo "$fail mutation-gate test(s) failed." >&2
  exit 1
fi
