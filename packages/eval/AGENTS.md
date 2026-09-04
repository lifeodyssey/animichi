# packages/eval — AGENTS.md

The TS side of the eval move (W3 of `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`, umbrella
#1258). Plain **Node** package — it reads files and will later drive HTTP calls at staging, so it
must never enter a Workers bundle and never imports `workers/*`. Root guide: `../../AGENTS.md`.

Today it owns exactly one proven thing: the **file contract** between the Python exporter and
`logfire/evals`. W3-2..W3-5 (evaluators, the `gate.py` statistics port, the staging task, the
double run) build on it.

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
  `apps/agent/src/animichi/tests/eval/datasets/` and re-export.
