# Canonical eval datasets (frozen)

Byte-for-byte copies of the canonical sets that used to live in the retired Python agent's
`animichi/tests/eval/datasets/` (#1603). `@animichi/eval` reads them here:

- `src/gate/case-strata.ts` resolves this directory for a set's case strata.
- `test/gate-case-strata.test.ts` loads `agent_eval_v3`'s strata, proves every case and stratum
  count declared in `src/dataset-sets.ts` against the copy it names, and loads the pooled sets
  (`injection_g1_v1`, `input_guard_v1`, `phase1c_selection_v1`, `runtime_journey_v1`,
  `translation_v1`) for their one-stratum warning.
- `scripts/generate-agent-eval-v3-source.ts` re-derives `../source/agent_eval_v3.json` and its
  task-gap sidecar from `agent_eval_v3.json`.
- `test/native-source-agent-eval-v3.test.ts` compares the two, and reads `agent_eval_v3.json` as
  the original corpus plus all seven siblings — `runtime_journey_v1.json` and `translation_v1.json`
  included — so the whole corpus still counts and no sibling case has leaked into `agent_eval_v3`.

These files are committed inputs, not generated output, and nothing in this package regenerates
them. `runtime_journey_v1.json` and `translation_v1.json` have exactly two readers, both named
above: the pooled-strata test and the source-migration test. Changing a canonical set is an Eval
Story (#1557–#1560) decision, not a routine edit: it requires updating the copy here and whatever
consumes it in the same change.
