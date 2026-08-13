#!/usr/bin/env bash
# AC1 behavioral tests for the local review verdict gate (issue #1008).
#   AC1 unit: the verdict schema records base/head SHA, brief digest, reviewer
#     identity/time, independent Standards and Spec axes, AC-to-test mapping
#     (with the ac_total ratchet: positive count, unique ids, len == ac_total),
#     gate evidence, mutation evidence — and rejects every tampered shape.
#   AC1 unit: empty ac_to_test / gate_evidence / mutation_evidence arrays are
#     rejected (approval is unverifiable without per-AC tests, per-run gate
#     evidence, and mutation probes; no narrower rule exists in
#     docs/ops/review-gate.md invariants 6-7 / Quality Ratchet), proven by a
#     red -> restore -> green source-mutation probe.
#   AC6 repair-evidence boundary (finding 5): the artifact records whether the
#     repair was the deterministic local harness or a real OpenCode session —
#     opencode mode requires the actual command/session/log digest, and a
#     fabricated or wrong-mode record fails closed.
#   Mutation probes: schema validation, axis rejection, head invalidation,
#     empty-evidence rejection, AC-mapping completeness (duplicate ids + count),
#     and the unknown-key / RFC3339 strictness (source-mutated red -> green).
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

mutate() { # mutate <src> <dst> <op>
  python3 "$FIX/mutate_verdict.py" "$1" "$2" "$3"
}

mutate_source() { # mutate_source <src> <dst> <op>
  python3 "$FIX/mutate_source.py" "$1" "$2" "$3"
}

gate() { # gate <label> <want> <verdict> [--base B] [--head H] [--brief F]
  local label="$1" want="$2" verdict="$3"
  shift 3
  run "$label" "$want" "$GATE" gate "$verdict" "$@"
}

echo "=== AC1: schema validation ==="
run "approve fixture validates" 0 "$GATE" validate "$FIX/verdict-approve.json"

for op in drop-head drop-ac-mapping bad-version spec-partial finding-line-zero \
  bad-test-type bad-mutation-flag bad-role unknown-field bad-reviewed-at \
  unknown-reviewer unknown-axes unknown-axis unknown-finding unknown-ac \
  unknown-gate unknown-mutation date-only-reviewed-at no-tz-reviewed-at \
  no-seconds-reviewed-at drop-ac-total bad-ac-total duplicate-ac-id \
  ac-count-mismatch repair-opencode-fabricated repair-bad-mode \
  repair-local-with-orchestrator; do
  mutate "$FIX/verdict-approve.json" "$TMP/$op.json" "$op"
  run "tamper: $op rejected" 1 "$GATE" validate "$TMP/$op.json"
done

printf '{"broken": json\n' > "$TMP/garbage.json"
run "non-JSON rejected" 1 "$GATE" validate "$TMP/garbage.json"

echo
echo "=== AC1 ratchet: empty evidence arrays are rejected ==="
# docs/ops/review-gate.md requires no narrower rule: the Quality Ratchet
# demands every AC carry a test (ac_to_test), invariant 6 requires per-run
# quoted gate evidence, and invariant 7 makes mutation probes the only valid
# green-light proof. So each collection is required non-empty.
run "non-empty evidence accepted" 0 "$GATE" validate "$FIX/verdict-approve.json"
for op in empty-ac-to-test empty-gate-evidence empty-mutation-evidence; do
  mutate "$FIX/verdict-approve.json" "$TMP/$op.json" "$op"
  run "empty $op rejected" 1 "$GATE" validate "$TMP/$op.json"
  run "empty $op blocks gate" 1 "$GATE" gate "$TMP/$op.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
done

echo
echo "=== AC1 ratchet: approval must be proven, not merely typed ==="
# Evidence is the executable proof of an approve, so an approval-claimed verdict
# with a non-zero gate run or any false mutation flag is rejected by both
# validate and gate — a reject artifact may describe failed evidence, an
# approve may not (issue #1008 review finding 2).
for op in bad-gate-exit bad-red bad-restore bad-green; do
  mutate "$FIX/verdict-approve.json" "$TMP/$op.json" "$op"
  run "tamper: $op rejected by validate" 1 "$GATE" validate "$TMP/$op.json"
  run "tamper: $op blocks gate" 1 "$GATE" gate "$TMP/$op.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
done
run "reject artifact may describe failed evidence" 0 "$GATE" validate "$FIX/verdict-reject-standards.json"

echo
echo "=== mutation probe: approval-evidence proof is load-bearing ==="
MUT2="$TMP/mut2"
mkdir -p "$MUT2"
for module in review_verdict review_verdict_cli verdict_parse verdict_schema verdict_types verdict_evidence; do
  cp "$ROOT/scripts/local-gates/$module.py" "$MUT2/$module.py"
done
mutate_source "$ROOT/scripts/local-gates/review_verdict.py" "$MUT2/review_verdict.py" drop-evidence-proof
for op in bad-gate-exit bad-red; do
  mutate "$FIX/verdict-approve.json" "$TMP/$op.json" "$op"
  run "red: dropped evidence-proof accepts $op" 0 python3 "$MUT2/review_verdict_cli.py" gate \
    "$TMP/$op.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
  run "restore+green: original validator rejects $op" 1 "$GATE" gate \
    "$TMP/$op.json" --base "$BASE" --head "$HEAD" --brief "$BRIEF"
done

echo
echo "=== mutation probe: empty-evidence rejection is load-bearing ==="
mutate "$FIX/verdict-approve.json" "$TMP/empty-all-evidence.json" empty-all-evidence
run "baseline: all-empty evidence rejected" 1 "$GATE" validate "$TMP/empty-all-evidence.json"
MUT="$TMP/mut"
mkdir -p "$MUT"
for module in review_verdict review_verdict_cli verdict_parse verdict_schema verdict_types verdict_evidence; do
  cp "$ROOT/scripts/local-gates/$module.py" "$MUT/$module.py"
done
mutate_source "$ROOT/scripts/local-gates/verdict_schema.py" "$MUT/verdict_schema.py" drop-empty-evidence
run "red: dropped emptiness check accepts empty evidence" 0 python3 "$MUT/review_verdict_cli.py" validate "$TMP/empty-all-evidence.json"
run "restore+green: original validator rejects empty evidence" 1 "$GATE" validate "$TMP/empty-all-evidence.json"

echo
echo "=== mutation probe: recursive unknown-key + RFC3339 strictness is load-bearing ==="
mutate "$FIX/verdict-approve.json" "$TMP/unknown-reviewer.json" unknown-reviewer
mutate "$FIX/verdict-approve.json" "$TMP/date-only-reviewed-at.json" date-only-reviewed-at
MUT3="$TMP/mut3"
mkdir -p "$MUT3"
for module in review_verdict review_verdict_cli verdict_parse verdict_schema verdict_types verdict_evidence; do
  cp "$ROOT/scripts/local-gates/$module.py" "$MUT3/$module.py"
done
mutate_source "$ROOT/scripts/local-gates/verdict_schema.py" "$MUT3/verdict_schema.py" drop-unknown-keys
run "red: dropped unknown-key check accepts a nested unknown key" 0 python3 "$MUT3/review_verdict_cli.py" validate "$TMP/unknown-reviewer.json"
run "restore+green: original validator rejects the nested unknown key" 1 "$GATE" validate "$TMP/unknown-reviewer.json"
mutate_source "$ROOT/scripts/local-gates/verdict_schema.py" "$MUT3/verdict_schema.py" drop-rfc3339
run "red: dropped RFC3339 check accepts a date-only timestamp" 0 python3 "$MUT3/review_verdict_cli.py" validate "$TMP/date-only-reviewed-at.json"
run "restore+green: original validator rejects the date-only timestamp" 1 "$GATE" validate "$TMP/date-only-reviewed-at.json"

echo
echo "=== mutation probe: AC mapping completeness is load-bearing ==="
# The Quality Ratchet is proven by mutation: dropping the duplicate-ac_id or
# ac_total count validation must accept the tampered mapping, and the pristine
# validator must reject it (docs/ops/review-gate.md §1.7, finding 3).
mutate "$FIX/verdict-approve.json" "$TMP/duplicate-ac-id.json" duplicate-ac-id
mutate "$FIX/verdict-approve.json" "$TMP/ac-count-mismatch.json" ac-count-mismatch
MUT4="$TMP/mut4"
mkdir -p "$MUT4"
for module in review_verdict review_verdict_cli verdict_parse verdict_schema verdict_types verdict_evidence; do
  cp "$ROOT/scripts/local-gates/$module.py" "$MUT4/$module.py"
done
mutate_source "$ROOT/scripts/local-gates/verdict_evidence.py" "$MUT4/verdict_evidence.py" drop-ac-unique
run "red: dropped duplicate-id check accepts duplicate AC ids" 0 python3 "$MUT4/review_verdict_cli.py" validate "$TMP/duplicate-ac-id.json"
run "restore+green: original validator rejects duplicate AC ids" 1 "$GATE" validate "$TMP/duplicate-ac-id.json"
mutate_source "$ROOT/scripts/local-gates/verdict_evidence.py" "$MUT4/verdict_evidence.py" drop-ac-count
run "red: dropped count check accepts the ac_total mismatch" 0 python3 "$MUT4/review_verdict_cli.py" validate "$TMP/ac-count-mismatch.json"
run "restore+green: original validator rejects the ac_total mismatch" 1 "$GATE" validate "$TMP/ac-count-mismatch.json"

echo
echo "=== AC6 repair-evidence boundary: locally proven vs opencode-orchestrated ==="
# finding 5: the artifact records what actually happened. An opencode-mode
# record must carry the real command/session/log digest; a fabricated opencode
# record, a bad mode, or orchestrator fields on the local harness all fail.
run "approve fixture records local-deterministic-harness mode" 0 "$GATE" validate "$FIX/verdict-approve.json"
mutate "$FIX/verdict-approve.json" "$TMP/repair-local-with-orchestrator.json" \
  repair-local-with-orchestrator
run "tamper: local harness with orchestrator fields rejected" 1 "$GATE" validate "$TMP/repair-local-with-orchestrator.json"
mutate "$FIX/verdict-approve.json" "$TMP/repair-opencode-complete.json" \
  repair-opencode-complete
run "opencode mode with the real command/session/log digest validates" 0 "$GATE" validate "$TMP/repair-opencode-complete.json"

echo
echo "=== digest determinism (AC1 brief pin) ==="
d1="$("$GATE" digest "$BRIEF")"
d2="$("$GATE" digest "$BRIEF")"
if [ "$d1" = "$d2" ] && [ -n "$d1" ]; then
  printf 'PASS %-44s %s\n' "brief digest deterministic" "$d1"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "brief digest deterministic"
fi
printf '%s\n' "a materially different brief" > "$TMP/other.md"
d3="$("$GATE" digest "$TMP/other.md")"
if [ "$d3" != "$d1" ]; then
  printf 'PASS %-44s\n' "different brief -> different digest"
else
  fail=$((fail + 1)); printf 'FAIL %-44s\n' "different brief -> different digest"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "All review-verdict AC1 tests passed."
else
  echo "$fail AC1 test(s) failed." >&2
  exit 1
fi
