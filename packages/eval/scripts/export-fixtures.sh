#!/usr/bin/env bash
# Export the Python eval datasets into the TS eval package's fixtures (#1299).
#
# Two files per set, through the existing `run_agent_eval.py` CLI;
# `EVAL_DATASET` selects which canonical dataset `eval_harness` loads:
#   <set>.json        pydantic-evals `Dataset.to_file` — what `logfire/evals`
#                     `Dataset.fromFile` reads on the TS side (the round trip)
#   <set>.cases.json  the same cases as their Python dataclasses hold them —
#                     the independent expectation the TS deep-equal compares
#                     against, so a mutation to either file goes red
#
# Export must not need a model, a database, or a network: the two settings
# credentials below are the same placeholders the hermetic pytest conftest
# installs, and no evaluation runs in export mode.
#
# Usage: bash packages/eval/scripts/export-fixtures.sh [output-dir]
# Drift gate: scripts/local-gates/eval-fixture-drift.sh
set -euo pipefail

PACKAGE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$PACKAGE/../.." && pwd)"
OUT_DIR="${1:-$PACKAGE/fixtures}"

# The six sets the TS runner reads. Keep in sync with packages/eval/src/dataset-sets.ts.
SETS=(
  agent_eval_v3
  agent_eval_heldout_v1
  injection_g1_v1
  input_guard_v1
  long_context_v1
  phase1c_selection_v1
)

mkdir -p "$OUT_DIR"
for set_name in "${SETS[@]}"; do
  (cd "$ROOT/apps/agent" && env \
    -u EVAL_MAX_CASES -u EVAL_SMOKE -u EVAL_L3 \
    EVAL_DATASET="$set_name.json" \
    AGENT_SVC_DATABASE_URL="postgresql://test:test@localhost:5432/test" \
    ZEN_GO_API_KEY="test-key" \
    MIMO_API_KEY="test-key" \
    uv run python -m animichi.tests.eval.run_agent_eval \
      --export-dataset "$OUT_DIR/$set_name.json" \
      --export-cases "$OUT_DIR/$set_name.cases.json")
done

# The evaluator oracle (#1301): Python's own scores for a set of synthetic
# transcripts, which `packages/eval/test/evaluator-parity.test.ts` compares the
# TypeScript port against. Regenerated here so the drift gate also fails when
# the Python evaluators change without the TS numbers being re-proved.
(cd "$ROOT/apps/agent" && env \
  AGENT_SVC_DATABASE_URL="postgresql://test:test@localhost:5432/test" \
  ZEN_GO_API_KEY="test-key" \
  MIMO_API_KEY="test-key" \
  uv run python -m animichi.tests.eval.evaluator_oracle)
