#!/usr/bin/env bash
# Core-gate tests for the required PR check (issue #1008).
#   AC4 api: the check reads unresolved review threads, top-level managed
#     findings, the current head SHA, and an authorized acknowledgement bound
#     to the findings snapshot; an empty-evidence verdict fails the check
#     closed.
#   AC5 api: a new commit or a later managed finding makes an older ack stale
#     and the gate stays blocked; the findings snapshot is identity-aware, so a
#     later comment with the SAME numeric count still stales the ack.
#   AC5 api: a MEMBER bot's ACK/marker is never maintainer triage.
#   AC7 api: without a local verdict artifact the check requires a strict,
#     authorized, head/base/brief-bound human review-approval marker; missing,
#     malformed, rejected-axis, and stale markers all block. The marker's brief
#     must match the canonical PR-body brief-digest record, and a missing
#     canonical record fails closed (issue #1008 finding 7 rework).
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

pr_no_verdict() { # pr_no_verdict <label> <want> <dir>
  run "$1" "$2" "$CHECK" check "$FIX/$3"
}

echo "=== AC4: the four inputs the check reads ==="
pr "clean PR is eligible" 0 pr-clean "$APPROVE"
pr "unresolved threads block" 1 pr-threads-open "$APPROVE"
pr "managed findings without ack block" 1 pr-findings-unacked "$APPROVE"
pr "authorized ack bound to snapshot passes" 0 pr-findings-acked "$APPROVE"
pr "bot self-dismissal is not maintainer triage" 1 pr-bot-self-dismissal "$APPROVE"
pr "unauthorized ack is not maintainer triage" 1 pr-unauthorized-ack "$APPROVE"

head_out="$("$CHECK" check "$FIX/pr-clean" --verdict "$APPROVE" --brief "$BRIEF" --base "$BASE")"
if printf '%s' "$head_out" | grep -q '"head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"'; then
  printf 'PASS %-44s %s\n' "check reads the current head SHA" "$(printf '%s' "$head_out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["head_sha"])')"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "check reads the current head SHA"
fi

python3 - "$TMP/empty-evidence-verdict.json" "$FIX" <<'PY'
import json
import sys

path, fix = sys.argv[1], sys.argv[2]
verdict = json.load(open(f"{fix}/verdict-approve.json", encoding="utf-8"))
verdict["ac_to_test"] = []
verdict["gate_evidence"] = []
verdict["mutation_evidence"] = []
json.dump(verdict, open(path, "w"), indent=2)
PY
run "empty-evidence verdict fails the PR check closed" 2 "$CHECK" check "$FIX/pr-clean" \
  --verdict "$TMP/empty-evidence-verdict.json" --brief "$BRIEF" --base "$BASE"

echo
echo "=== AC5: staleness on a new commit or a later finding ==="
pr "new commit stales the older ack" 1 pr-findings-ack-stale-head "$APPROVE"
pr "same-count later finding stales the older ack" 1 pr-findings-ack-new-finding "$APPROVE"

echo
echo "=== AC5: a MEMBER bot can never self-acknowledge ==="
pr "MEMBER bot with ACK + approval marker is not triage" 1 pr-bot-member-ack "$APPROVE"

echo
echo "=== AC7: the human review-approval marker (no local verdict) ==="
pr_no_verdict "marker-bound PR passes without a local verdict" 0 pr-findings-acked
pr_no_verdict "missing marker blocks without a local verdict" 1 pr-findings-unacked
pr_no_verdict "stale marker (older head) blocks" 1 pr-marker-stale
pr_no_verdict "rejected-axis marker blocks" 1 pr-marker-rejected
pr_no_verdict "malformed marker blocks" 1 pr-marker-malformed

echo
echo "=== AC7: the marker's brief must match the canonical brief-digest record ==="
pr_no_verdict "wrong-but-well-formed marker brief blocks" 1 pr-marker-brief-mismatch
# An absent record is absent evidence, judged like any other; only a record that
# exists and is unreadable is an input the gate cannot trust at all.
pr_no_verdict "marker with no brief record to bind to blocks" 1 pr-marker-unbound
pr_no_verdict "no brief record and no marker blocks" 1 pr-brief-absent
pr_no_verdict "malformed brief record fails closed" 2 pr-brief-malformed

echo
echo "=== head SHA must be pinned and well-formed (fail closed) ==="
mkghost() { # mkghost <name> <head-sha-json>
  local dir="$TMP/head-$1"
  mkdir -p "$dir"
  printf '%s\n' "$2" > "$dir/head_sha.json"
  printf '{"base_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n' > "$dir/base_sha.json"
  printf '{"unresolved": 0}\n' > "$dir/threads.json"
  printf '[]\n' > "$dir/comments.json"
  printf '{"brief_digest": "3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1"}\n' > "$dir/brief_digest.json"
}
mkghost missing '{}'
mkghost empty '{"head_sha": ""}'
mkghost null '{"head_sha": null}'
mkghost short '{"head_sha": "abc"}'
mkghost nonhex '{"head_sha": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"}'
mkghost long '{"head_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'
mkghost numeric '{"head_sha": 1111111111111111111111111111111111111111}'
for name in missing empty null short nonhex long numeric; do
  run "malformed head SHA ($name) fails closed" 2 "$CHECK" check "$TMP/head-$name"
done
printf '{"brief_digest": 1111111111111111111111111111111111111111111111111111111111111111}\n' > "$TMP/head-numeric/brief_digest.json"
run "numeric brief digest fails closed (never stringified)" 2 "$CHECK" check "$TMP/head-numeric"

echo
if [ "$fail" -eq 0 ]; then
  echo "All pr-review-check core-gate tests passed."
else
  echo "$fail core-gate test(s) failed." >&2
  exit 1
fi
