#!/usr/bin/env bash
# AC6 repair-flow test for the required PR check (issue #1008, findings 3+4
# rework): reject -> repair -> the REAL gates and mutation probes run on the
# repaired state (pr-review-check.repair-evidence.test.sh) -> a fresh verdict
# artifact records that real evidence -> fresh approve on the new head -> the
# old rejected/stale artifacts still block. The old evidence is kept immutable
# and is never enough to pass after the head or brief changes (a complete new
# review is required).
#
# AC6 evidence boundary (finding 5): this hermetic module proves the locally
# reproducible part — the deterministic harness rebuilds the repaired fixture
# and the fresh verdict records repair_evidence.mode=local-deterministic-harness,
# never claiming an external OpenCode session ran. When an orchestrator drives
# the same flow through a real OpenCode session it records mode=opencode with
# the actual command/session/log digest; this suite stays hermetic and never
# fabricates such a run. The full AC6 chain (reject -> OpenCode repair ->
# fresh approve -> PR-eligible) is the orchestrator's claim, evidenced by that
# opencode record.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
GATE="$ROOT/scripts/local-gates/review-verdict.sh"
EVIDENCE="$ROOT/scripts/local-gates/pr-review-check.repair-evidence.test.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
BASE='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
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

pr() { # pr <label> <want> <dir> <verdict-file>
  run "$1" "$2" "$CHECK" check "$FIX/$3" --verdict "$4" --brief "$BRIEF" --base "$BASE"
}

echo
echo "=== AC6 (local-harness proof): reject -> repair -> real gates/mutation -> fresh approve -> eligible ==="
pr "initial state: spec axis rejects + findings unacked" 1 pr-findings-unacked "$FIX/verdict-reject-spec.json"

head2='dddddddddddddddddddddddddddddddddddddddd'
BRIEF_DIGEST="$("$GATE" digest "$BRIEF")"
python3 - "$TMP/repaired" "$head2" "$BASE" "$BRIEF_DIGEST" <<'PY'
import json
import os
import sys

outdir, head, base, digest = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(outdir, exist_ok=True)
json.dump({"head_sha": head}, open(f"{outdir}/head_sha.json", "w"))
json.dump({"base_sha": base}, open(f"{outdir}/base_sha.json", "w"))
json.dump({"brief_digest": digest}, open(f"{outdir}/brief_digest.json", "w"))
json.dump({"unresolved": 0}, open(f"{outdir}/threads.json", "w"))
comments = [
    {"author_association": "MEMBER", "login": "coderabbitai[bot]", "author_type": "Bot",
     "id": "IC_ac6q1", "url": "https://github.com/lifeodyssey/animichi/pull/1#issuecomment-ac6q1",
     "body": "<code>🐞 Bugs (2)</code> <code>Rule violations (0)</code>"},
    {"author_association": "MEMBER", "login": "sonarcloud[bot]", "author_type": "Bot",
     "id": "IC_ac6q2", "url": "https://github.com/lifeodyssey/animichi/pull/1#issuecomment-ac6q2",
     "body": "## Quality Gate Failed"},
]
json.dump(comments, open(f"{outdir}/comments.json", "w"))
PY
no_marker_out="$("$CHECK" check "$TMP/repaired" 2>&1)" || true
snap2="$(printf '%s' "$no_marker_out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["findings"]["snapshot"])')"
python3 - "$TMP/repaired" "$snap2" "$head2" "$BASE" "$BRIEF_DIGEST" <<'PY'
import json
import sys

outdir, snapshot, head, base, digest = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
comments = json.load(open(f"{outdir}/comments.json", encoding="utf-8"))
comments.append({"author_association": "OWNER", "login": "owner", "author_type": "User",
                 "id": "IC_ac6ack", "url": "https://github.com/lifeodyssey/animichi/pull/1#issuecomment-ac6ack",
                 "body": "线程判定: repaired after review. snapshot=" + snapshot + "\n"
                         "review-gate approval: standards=approve spec=approve base=" + base +
                         " head=" + head + " brief=" + digest})
json.dump(comments, open(f"{outdir}/comments.json", "w"), indent=2)
PY

echo
echo "--- fresh evidence: real gate + mutation probes on the repaired state ---"
if env REPAIR_EVIDENCE_ROOT="$ROOT" REPAIR_EVIDENCE_DIR="$TMP/repaired" \
  REPAIR_EVIDENCE_HEAD="$head2" REPAIR_EVIDENCE_BASE="$BASE" \
  REPAIR_EVIDENCE_BRIEF="$BRIEF" REPAIR_EVIDENCE_OUT="$TMP/new-verdict.json" \
  "$EVIDENCE"; then
  printf 'PASS %-44s\n' "repair-evidence module produced the fresh verdict"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "repair-evidence module produced the fresh verdict"
fi

echo
echo "--- the fresh verdict + immutable old artifacts ---"
run "fresh approve on new head is PR eligible" 0 "$CHECK" check "$TMP/repaired" \
  --verdict "$TMP/new-verdict.json" --brief "$BRIEF" --base "$BASE"
run "fresh verdict validates" 0 "$GATE" validate "$TMP/new-verdict.json"
run "fresh verdict gates approve on the repaired head" 0 "$GATE" gate "$TMP/new-verdict.json" \
  --base "$BASE" --head "$head2" --brief "$BRIEF"
pr "old rejected state still blocks (no patch shortcut)" 1 pr-findings-unacked "$FIX/verdict-reject-spec.json"
run "old approve artifact (old head) cannot pass the repaired head" 1 "$CHECK" check "$TMP/repaired" \
  --verdict "$FIX/verdict-approve.json" --brief "$BRIEF" --base "$BASE"
printf '%s\n' "a materially different brief" > "$TMP/other.md"
run "old approve artifact cannot pass after the brief changes" 1 "$CHECK" check "$FIX/pr-clean" \
  --verdict "$FIX/verdict-approve.json" --brief "$TMP/other.md" --base "$BASE"

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check repair-flow tests passed."
else
  echo "$fail repair-flow test(s) failed." >&2
  exit 1
fi
