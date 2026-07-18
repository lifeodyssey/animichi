# CodeMode rematch lead runbook

This spike compares the current production tool loop with the same agent fixtures wrapped by
CodeMode and a MiMo-specific whole-script lesson. It never reads or writes eval baselines and
always uses the trajectory-tier `NullDatabase`, `MockCatalogClient`, and web fixtures.

## Exact commands

Run from the repository root. `MIMO_API_KEY` must already be available in the shell.

```bash
cd apps/agent
: "${MIMO_API_KEY:?set MIMO_API_KEY before running the rematch}"
export SUPABASE_DB_URL="${SUPABASE_DB_URL:-postgresql://unused:unused@127.0.0.1:1/unused}"
export EVAL_MODEL='openai:mimo-v2.5@https://api.xiaomimimo.com/v1'
export EVAL_MAX_CASES=80
export EVAL_CONCURRENCY=10
export EVAL_L3=0
export ANIMICHI_MANAGED_PROMPT=0
export ANIMICHI_SPIKE_OUT_BASE="$PWD/agent/spikes/codemode"

uv run python -m agent.spikes.codemode.rematch \
  --arm control \
  --out agent/spikes/codemode/rematch-control.json

uv run python -m agent.spikes.codemode.rematch \
  --arm codemode-taught \
  --out agent/spikes/codemode/rematch-codemode-taught.json

uv run python -m agent.spikes.codemode.compare \
  agent/spikes/codemode/rematch-control.json \
  agent/spikes/codemode/rematch-codemode-taught.json \
  --out agent/spikes/codemode/rematch-report.md
```

The two 80-case arms are expected to cost roughly **$1–2 total**. The JSON reports use the
same deterministic prefix-stratified case IDs and include the official-v1 eight metrics,
request p95, input/output/total tokens, and a MiMo-rate cost estimate.
The fallback `SUPABASE_DB_URL` only satisfies import-time settings validation; the trajectory
fixtures do not connect to it.

## Teaching treatment

ARM B keeps the production instructions (from ManagedPrompt when explicitly enabled, otherwise
the local prompt), current-turn language directive, hooks, native history compaction, dependencies,
tools, typed outputs, retries, and output validator. Its only treatment is `CodeMode` plus an
addendum telling MiMo to use one whole `run_code` script, showing one resolve → search → plan route
example with branching/error handling, and restating the Monty restrictions that caused Wave-2
failures. The commands above pin local instructions so both arms avoid remote prompt variance.

## Verdict

- **ADOPT**: ARM B tool correctness is within 0.01 of ARM A, request p95 is strictly lower,
  and estimated cost is no more than 15% higher.
- **BENCH AGAIN**: correctness is within 0.01, but request p95 or cost misses its threshold.
- **KILL**: ARM B tool correctness is more than 0.01 below ARM A.

Never compare either capped arm to a full-run mean. `compare` rejects different models,
evaluator versions, datasets, subset digests, or ordered case IDs.
