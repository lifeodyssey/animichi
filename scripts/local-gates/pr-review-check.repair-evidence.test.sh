#!/usr/bin/env bash
# AC6 repair-flow evidence module (issue #1008, findings 3+4 rework): runs the
# REAL gates + mutation probes on the repaired state and writes a fresh verdict
# whose evidence is captured from actually-executed commands (`reviewed_at` is
# generated, never hard-coded). The deterministic LOCAL harness rebuilds the
# repaired fixture; the verdict's `repair_evidence.mode` truthfully records
# `local-deterministic-harness` — it never claims an external OpenCode session
# ran (finding 5). An orchestrator that drives the flow through a real OpenCode
# session records `mode: opencode` with the actual command/session/log digest;
# this hermetic module proves the schema boundary without touching the network.
#
# Environment (set by the flow runner): REPAIR_EVIDENCE_ROOT / _DIR / _HEAD /
# _BASE / _BRIEF / _OUT.
set -euo pipefail

ROOT="${REPAIR_EVIDENCE_ROOT:?REPAIR_EVIDENCE_ROOT is required}"
CHECK="$ROOT/scripts/local-gates/pr-review-check.sh"
GATE="$ROOT/scripts/local-gates/review-verdict.sh"
FIX="$ROOT/scripts/local-gates/fixtures"
REPAIRED="${REPAIR_EVIDENCE_DIR:?REPAIR_EVIDENCE_DIR is required}"
HEAD="${REPAIR_EVIDENCE_HEAD:?REPAIR_EVIDENCE_HEAD is required}"
BASE="${REPAIR_EVIDENCE_BASE:?REPAIR_EVIDENCE_BASE is required}"
BRIEF="${REPAIR_EVIDENCE_BRIEF:?REPAIR_EVIDENCE_BRIEF is required}"
OUT="${REPAIR_EVIDENCE_OUT:?REPAIR_EVIDENCE_OUT is required}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
LAST_RC=0
run() { # run <label> <want-exit> <cmd...>; records the real exit in LAST_RC
  local label="$1" want="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)" && rc=0 || rc=$?
  LAST_RC="$rc"
  if [ "$rc" -eq "$want" ]; then printf 'PASS %-44s exit=%s\n' "$label" "$rc"; else
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

BRIEF_DIGEST="$("$GATE" digest "$BRIEF")"
MUT="$TMP/mut"
mkdir -p "$MUT/scripts"
reset_mut() { # reset_mut: restore pristine gate sources for the next probe
  rm -rf "$MUT/scripts/local-gates"
  cp -R "$ROOT/scripts/local-gates" "$MUT/scripts/local-gates"
}
reset_mut

# Real gate run on the repaired state (marker path, no local verdict): its exit
# becomes gate_evidence[0].
run "repaired state approves on the marker path (real gate)" 0 "$CHECK" check "$REPAIRED"
gate1="$LAST_RC"

echo
echo "--- mutation probe 1: pinned-SHA validation (red -> restore -> green) ---"
run "probe1: mutate drops the pinned-SHA validation" 0 python3 - \
  "$ROOT/scripts/local-gates/pr_review_check.py" "$MUT/scripts/local-gates/pr_review_check.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "if not isinstance(value, str) or len(value) != 40 or not HEX_RE.match(value):"
assert needle in source, "pinned-SHA validation not found in pr_review_check.py"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "if False:  # mutated: pinned SHA validation dropped", 1))
PY
run "probe1 red: mutated gate accepts the malformed head (no fail-closed)" 1 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$TMP/head-short"
sha_red="$LAST_RC"
run "probe1 restore: pristine sources restored" 0 reset_mut
sha_restore="$LAST_RC"
run "probe1 green: restored gate fails closed on the malformed head" 2 "$CHECK" check "$TMP/head-short"
sha_green="$LAST_RC"

echo
echo "--- mutation probe 2: marker brief binding (red -> restore -> green) ---"
run "probe2: mutate drops the marker brief comparison" 0 python3 - \
  "$ROOT/scripts/local-gates/pr_approval.py" "$MUT/scripts/local-gates/pr_approval.py" <<'PY'
import sys

src, dst = sys.argv[1], sys.argv[2]
source = open(src, encoding="utf-8").read()
needle = "    if brief == expected_brief:"
assert needle in source, "marker brief comparison not found in pr_approval.py"
open(dst, "w", encoding="utf-8").write(source.replace(needle, "    if True:  # mutated: marker brief comparison dropped", 1))
PY
run "probe2 red: mutated gate accepts the wrong-but-well-formed digest" 0 \
  "$MUT/scripts/local-gates/pr-review-check.sh" check "$FIX/pr-marker-brief-mismatch"
brief_red="$LAST_RC"
run "probe2 restore: pristine sources restored" 0 reset_mut
brief_restore="$LAST_RC"
run "probe2 green: restored gate rejects the wrong digest" 1 "$CHECK" check "$FIX/pr-marker-brief-mismatch"
brief_green="$LAST_RC"

echo
echo "--- fresh verdict records only the captured real evidence ---"
# Draft the verdict WITHOUT the self-referential gate run; the real
# review-verdict.sh gate command runs on the draft and its captured exit is
# then appended as gate_evidence[1] — the artifact never claims a command ran
# unless it was actually executed (finding 4). `reviewed_at` is generated from
# the actual run (`date -u`) in RFC-3339 form, and the reviewer identity
# records the deterministic LOCAL repair harness — not an external session
# that never ran (finding 9).
REVIEWED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$OUT" "$HEAD" "$BASE" "$BRIEF_DIGEST" "$REVIEWED_AT" \
  "$gate1" "$sha_red" "$sha_restore" "$sha_green" "$brief_red" "$brief_restore" "$brief_green" <<'PY'
import json
import sys

path, head, base, digest, reviewed_at = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
(gate1, sha_red, sha_restore, sha_green, brief_red, brief_restore, brief_green) = (int(v) for v in sys.argv[6:13])
verdict = {
    "schema_version": 1,
    "base_sha": base,
    "head_sha": head,
    "brief_digest": digest,
    "reviewer": {"identity": "local-deterministic-repair-harness", "role": "reviewer-seat"},
    "reviewed_at": reviewed_at,
    "axes": {
        "standards": {"status": "approve", "findings": []},
        "spec": {"status": "approve", "findings": []},
    },
    "ac_total": 6,
    "ac_to_test": [
        {"ac_id": "AC1", "test_type": "unit", "test_path": "scripts/local-gates/review-verdict.test.sh"},
        {"ac_id": "AC2", "test_type": "integration", "test_path": "scripts/local-gates/review-verdict.test.sh"},
        {"ac_id": "AC3", "test_type": "unit", "test_path": "scripts/local-gates/review-gate-docs.test.sh"},
        {"ac_id": "AC4", "test_type": "api", "test_path": "scripts/local-gates/pr-review-check.test.sh"},
        {"ac_id": "AC5", "test_type": "api", "test_path": "scripts/local-gates/pr-review-check.test.sh"},
        {"ac_id": "AC6", "test_type": "integration", "test_path": "scripts/local-gates/pr-review-check.test.sh"},
    ],
    "repair_evidence": {"mode": "local-deterministic-harness"},
    "gate_evidence": [
        {"command": "scripts/local-gates/pr-review-check.sh check <repaired> (marker path)",
         "exit": gate1, "evidence": "repaired state approves the fresh head without a local verdict"},
    ],
    "mutation_evidence": [
        {"probe": "pinned-SHA validation",
         "mutation": "dropped pinned-SHA validation in pr_review_check.py",
         "red": sha_red != 2, "restore": sha_restore == 0, "green": sha_green == 2},
        {"probe": "brief-digest binding",
         "mutation": "dropped marker brief comparison in pr_approval.py",
         "red": brief_red == 0, "restore": brief_restore == 0, "green": brief_green == 1},
    ],
}
json.dump(verdict, open(path, "w"), indent=2)
PY
run "draft verdict gates approve on the repaired head (real command)" 0 \
  "$GATE" gate "$OUT" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
verdict_gate="$LAST_RC"
python3 - "$OUT" "$verdict_gate" <<'PY'
import json
import sys

path, exit_code = sys.argv[1], int(sys.argv[2])
verdict = json.load(open(path, encoding="utf-8"))
verdict["gate_evidence"].append({
    "command": "scripts/local-gates/review-verdict.sh gate <new-verdict> --base <B> --head <H> --brief <brief>",
    "exit": exit_code, "evidence": f"fresh verdict artifact gate command ran and exited {exit_code}"})
json.dump(verdict, open(path, "w"), indent=2)
PY
run "fresh verdict validates after appending the real gate evidence" 0 "$GATE" validate "$OUT"

echo
echo "--- AC6 evidence boundary: the artifact records what actually ran ---"
# The fresh verdict must truthfully record the local harness; a fabricated opencode record fails the schema.
python3 - "$OUT" "$TMP/fabricated.json" "$FIX/verdict-approve.json" <<'PY'
import json
import sys

out_path, fabricated_path, approve_path = sys.argv[1], sys.argv[2], sys.argv[3]
verdict = json.load(open(out_path, encoding="utf-8"))
record = verdict.get("repair_evidence", {})
assert record.get("mode") == "local-deterministic-harness", record
assert "command" not in record and "log_digest" not in record and "session" not in record, record
fabricated = json.load(open(approve_path, encoding="utf-8"))
fabricated["repair_evidence"] = {"mode": "opencode"}
json.dump(fabricated, open(fabricated_path, "w"), indent=2)
PY
if [ $? -eq 0 ]; then
  printf 'PASS %-44s\n' "fresh verdict records the local harness, no fabricated OpenCode run"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "fresh verdict records the local harness, no fabricated OpenCode run"
fi
run "schema rejects a fabricated opencode record (missing session/log)" 1 "$GATE" validate "$TMP/fabricated.json"

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check repair-evidence tests passed."
else
  echo "$fail repair-evidence test(s) failed." >&2
  exit 1
fi
