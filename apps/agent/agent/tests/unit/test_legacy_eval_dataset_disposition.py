"""Legacy eval-dataset disposition (S1.13 AC4).

`intent_cases` was a standalone 33-case intent dataset that no runner, test or
CI job executed. Its coverage is subsumed by the L0 smoke set, which reaches
every behavior path; this pins that claim so the deletion stays justified, and
guards against the file being reintroduced as a second source of truth.
"""

from __future__ import annotations

import json
from pathlib import Path

from agent.tests.eval.l0_selection import L0Case, select_l0_case_ids

_EVAL = Path(__file__).parents[1] / "eval"
_DATASET = _EVAL / "datasets" / "agent_eval_v3.json"
_L0_CAP = 80

# The intent vocabulary the retired dataset asserted, mapped onto the stage
# vocabulary the L0 set uses.
_RETIRED_INTENT_STAGES = {
    "search_by_bangumi": "search_bangumi",
    "search_by_location": "search_nearby",
    "plan_route": "plan_route",
    "general_qa": "general_qa",
    "unclear": "clarify",
}


def _rows() -> list[dict[str, object]]:
    return json.loads(_DATASET.read_text())


def _l0_rows() -> list[dict[str, object]]:
    rows = _rows()
    cases = [L0Case(row["id"], row["path"], row["locale"]) for row in rows]
    selected = set(select_l0_case_ids(cases, _L0_CAP))
    return [row for row in rows if row["id"] in selected]


def test_intent_cases_dataset_is_retired() -> None:
    assert not (_EVAL / "cases" / "intent_cases.json").exists()


def test_l0_set_covers_every_retired_intent() -> None:
    stages = {stage for row in _l0_rows() for stage in row["acceptable_stages"]}

    assert set(_RETIRED_INTENT_STAGES.values()) <= stages


def test_l0_set_covers_the_retired_intents_in_more_than_one_language() -> None:
    rows = _l0_rows()
    for stage in _RETIRED_INTENT_STAGES.values():
        locales = {row["locale"] for row in rows if stage in row["acceptable_stages"]}
        assert len(locales) >= 2, stage
