# Eval datasets

The canonical sets `eval_harness.py` loads (`EVAL_DATASET`) and
`packages/eval/scripts/export-fixtures.sh` exports into `packages/eval/fixtures/`.
Per-set notes live beside the set as `<set>.README.md`.

**Every case runs from an empty session on both sides.** The `context.last_search_data`
and `context.last_location` seeds that 76 cases carried were retired in #1398 — Python's
`_seed_tool_state` never had a `last_search_data` branch and nothing read the
`last_location` it assigned, and no `/v1/chat` body carries either — so those cases were
already starting from an empty session in the Python harness and in the TS one alike.
The one real starting state is `seeded_pending` (`phase1c_selection_v1`, 5 cases), which
#1380 establishes through the product's own store code.
