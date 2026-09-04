# packages/eval — AGENTS.md

The TS side of the eval move (W3 of `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`, umbrella
#1258). Plain **Node** package — it reads files and will later drive HTTP calls at staging, so it
must never enter a Workers bundle and never imports `workers/*`. Root guide: `../../AGENTS.md`.

It owns two proven things: the **file contract** between the Python exporter and `logfire/evals`,
and the **eight evaluators** (`src/evaluators/`) scoring identically to their Python originals.
W3-2, W3-4 and W3-5 (the staging task, the `gate.py` statistics port, the double run) build on both.

## Commands (from `packages/eval/`)

- `pnpm run test` — `node --test` over `test/*.test.ts` (Node's native TS type stripping; no bundler).
- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- From the repo root: `pnpm run test:eval`. Both run in the `eval` CI lane and in the pre-push
  `gate_eval`.

## The round trip (what is measured, not assumed)

`apps/agent` writes each dataset with pydantic-evals' `Dataset.to_file`; this package reads it with
`logfire/evals` `Dataset.fromFile`. Regenerate both artifacts with
`bash packages/eval/scripts/export-fixtures.sh`; `scripts/local-gates/eval-fixture-drift.sh` fails when the
committed fixtures are not what the exporter writes today.

Per set, `fixtures/` carries two files:

| File | Written by | Role |
|---|---|---|
| `<set>.json` | `Dataset.to_file(path, schema_path=None)` | the round-trip subject — what `Dataset.fromFile` reads |
| `<set>.cases.json` | `--export-cases` → `dataset_case_view.py` | the independent expectation, built from the Python dataclasses rather than pydantic-evals' serializer |

`fixtures/evaluator-oracle.json` is written by the same script, from
`apps/agent/src/animichi/tests/eval/evaluator_oracle.py`, and is the drift-guarded oracle for the
evaluators (below) rather than for the round trip.

Two files because one is not enough: comparing the loaded dataset against the file it was loaded
from compares that file with itself, and a mutated fixture would move both sides together.

**Measured with pydantic-evals 2.21.0 ↔ logfire 0.22.5** (751 cases across the six sets):

- Reading is lossless. `inputs`, `metadata`, `expected_output` and the evaluator specs deep-equal
  the Python objects; the wire keys are snake_case on both sides (`expected_output`), and only the
  TS in-memory accessor is camelCase (`case.expectedOutput`).
- Parameterless evaluators serialize as bare strings; both sides read them back as
  `{ name, arguments: null }` (`Evaluator.as_spec()` ↔ `Evaluator.getSpec()`).
- `expected_output: null` reads back as `null`, not `undefined`.
- JSON and YAML both load; we commit JSON because that is the canonical datasets' own format and
  it diffs readably.
- **Writing is not symmetric** — `Dataset.toObject()` re-emits a different key order, drops
  `report_evaluators` when empty and drops a case's `evaluators` when empty. W3 only reads, so this
  does not block "zero migration"; do not build a TS-side re-export on the assumption of byte parity.
- An unregistered evaluator name throws `Unknown evaluator name: "<name>" (registered: …)` — loud,
  named, never a silent drop. `src/evaluator-names.ts` is the single list; W3-3 implements against it.
- Registry key: a class's `static evaluatorName` **or** its runtime `name`. `evaluationName` is a
  per-instance result-name override, not the registry key.

## The eight evaluators (`src/evaluators/`)

One module per evaluator, named for its class; `src/evaluators/index.ts` is the registry list
`Dataset.fromFile` resolves the exported names against. Four are ports of pydantic-evals' official
agentic evaluators — which read an OTel span tree the TS side does not have — and four are the
project's own, ported from `evaluators.py`.

- **`transcript-view.ts` is the seam, and it is W3-2's type.** The evaluators read `TranscriptResult`
  from W3-2's `turn-transcript` module (#1300) and nothing else. Until that branch lands, the file carries a
  field-for-field copy with the one-edit replacement written at the top.
- **There is no span tree, and no need for one.** Every call the SD-9 stream publishes is a
  model-initiated tool call, so `trajectory` *is* the span tree and `stepCount` is
  `len(AgentResult.steps)` for every turn the wire can describe. `status` has three states:
  `"unsettled"` (made, never settled) is excluded wherever `include_failed=False` applies and counted
  by `MaxToolCalls`, which counts every attempt.
- **ANY-of-N lives in `accepted-chains.ts`.** A case names acceptable *stages*, each contributing
  chains; the tool and trajectory evaluators score once per chain and keep the best, and both
  selection turns accept only the empty chain. `bestOverChains` returns 1.0 for a case with no
  accepted chain — `_best(..., empty=1.0)`.
- **`{}` is not `0`.** `NonemptyResults` on an untagged case and `ArgumentCorrectness` on a turn with
  no successful call emit *no metric*. `test/evaluator-parity.test.ts` compares the whole score
  record, so a surplus zero fails there.
- **`_available_data_keys` is ported once, in W3-2.** `DataKeysPresent` reads `dataKeys`; it does not
  re-derive the rule. The oracle publishes Python's own `_available_data_keys` under that name, so it
  is the tripwire for `dataKeysOf` too.
- **The oracle, not a re-derivation.** `fixtures/evaluator-oracle.json` is what the *Python*
  evaluators score for 20 synthetic transcripts — every `_acceptable_min_steps` branch, the ANY-of-N
  ties, both empty-chain selections, the three call outcomes, and the `resolve_reply_language`
  decision points — paired with the wire transcript the TS side reads for the same turn. Changing an
  evaluator on either side means re-running `export-fixtures.sh` and re-proving the numbers in the
  same change; the drift gate is what forces it.
- `EVALUATOR_VERSION = 'official-v1'` mirrors `evaluators.py` and rides on every instance as
  `evaluatorVersion`. Bump both sides together or the two runners' baselines stop being comparable.

### Two places the wire cannot reach Python, and what they cost

- **`argument_correctness` is degenerate — do not read it as a passing score.** Python compares the
  span's raw arguments against `StepRecord.params`, the *separately* recorded normalized arguments
  for the same call. The stream publishes one `input` record per call and no second witness, so every
  settled call matches itself: the metric can only return `1.0` or `{}`. It stays wired, at the right
  name, so restoring it is one additive member on `TranscriptStep` (#1300's call). Until then it is
  unmeasured, not passing.
- **`nonempty_results` substitutes the published `results` for the itinerary's `source_ref` hop.** The
  stream carries row counts and points, never a ref to follow, so a routed turn is judged by the
  search it published. Python's two failure branches (no `source_ref`; a `source_ref` that misses the
  registry) both land on the same observable: no `results` in `data`.

`src/metric-names.ts` ports `eval_harness.metric_names` — same names, same order, checked against the
oracle's committed dump. Order is load-bearing: baselines and report tables are keyed positionally.

## Version pin

`PINS.json` declares pydantic-evals and logfire compatible **as a pair** — one writes the file the
other reads. `test/pins.test.ts` compares it against `packages/eval/package.json` (logfire, exact,
never a range) and `apps/agent/uv.lock` (pydantic-evals, resolved through the `pydantic-ai` extra;
it is not declared in `pyproject.toml`). Moving either version means re-exporting the fixtures and
re-proving the round trip in the same change.

## Conventions

- No `any`; `inputs.context` / `inputs.seeded_pending` stay open maps because the Python source
  declares them as `Mapping[str, object] | None` — mirroring it is the point.
- Fixtures are generated. Never hand-edit one; change the canonical dataset in
  `apps/agent/src/animichi/tests/eval/datasets/` (or, for the oracle, its scenarios in
  `apps/agent/src/animichi/tests/eval/evaluator_oracle_scenarios.py`) and re-export.
- Nothing under `src/evaluators/` may derive an expected score. Python decides the numbers; the
  tests only compare.

## The statistical gate (`src/gate/`, W3-4)

`gate.py` + `stats.py` ported for Node. The port is **numerically identical**, not
merely equivalent: `packages/eval/fixtures/stats-oracle.json` is written by
`apps/agent/src/animichi/tests/eval/stats_oracle.py` running the Python
originals, and every module here is asserted against it. Regenerate it with the
rest of the fixtures — `bash packages/eval/scripts/export-fixtures.sh` writes it
last, so
`scripts/local-gates/eval-fixture-drift.sh` fails when `stats.py` or `gate.py`
moved and this file did not.

Three CPython behaviours had to come along for the numbers to agree, each one
found by a red test rather than by reading:

| Module | Reproduces | Why a JS built-in is not enough |
|---|---|---|
| `python-random.ts` | `random.Random` (MT19937, `getrandbits`, `choice`) | any other generator gives a different, equally "correct" interval |
| `python-sum.ts` | `math.fsum` **and** `sum()` | since 3.12 `sum()` carries Neumaier's correction — `+=` drifts into the 4th decimal of a printed failure |
| `python-number-text.ts` | `.4f`, `.0%`, `repr` | Python rounds a decimal tie to even and writes `1.0`; `toFixed`/`String` do neither |

Notes for the rest of W3:

- **Warnings are returned, not logged.** Python's non-blocking half (INDETERMINATE,
  skipped metrics, stale baselines) goes to `logging`; here every gate returns
  `{ failures, warnings }` with the same strings. One of the five is not
  text-identical and cannot be: Python interpolates the pydantic `ValidationError`
  into `Invalid baseline for …`, and there is no such object on this side, so the
  message names the schema instead. The other four are pinned verbatim.
- **`baselines/` holds Python-written records.** `baselineRecordText` reproduces
  `model_dump_json(indent=2)` byte for byte, so a record written by either side is
  a no-op diff for the other; the committed
  `agent_l4_trajectory_openai-mimo-v2.5-…json` (662 cases) is the record W3-5
  compares against.
- **Strata come from the canonical dataset, not the exported fixture** (a W3-1
  finding, measured on `fixtures/agent_eval_v3.json`): `Dataset.to_file` keeps only
  `AgentExpected`, so a row's `path` does not survive the export. `case-strata.ts`
  reads `apps/agent/…/datasets/<set>.json`, exactly as `load_case_strata` does. A
  gate driven off the exported fixture alone would silently degrade to
  `unstratified`.
- **Assertions are folded into the case scores as 1/0.** Python's evaluators all
  return floats; a TS evaluator that returns a boolean lands in
  `report.assertions`, and dropping it would remove a metric the baseline expects.
