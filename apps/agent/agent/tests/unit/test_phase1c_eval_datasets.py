"""Phase 1c eval data follows the compact output and D3 selection contract."""

from __future__ import annotations

import json
from pathlib import Path

from agent.agents.session_state import PendingClarification

_DATASETS = Path(__file__).parents[1] / "eval" / "datasets"
_RETIRED_CLARIFY_KEYS = {"question", "options", "status"}


def _rows(name: str) -> list[dict[str, object]]:
    raw = json.loads((_DATASETS / name).read_text())
    assert isinstance(raw, list)
    return [row for row in raw if isinstance(row, dict)]


def test_canonical_datasets_use_compact_clarify_keys() -> None:
    for name in ("agent_eval_v3.json", "runtime_journey_v1.json"):
        for row in _rows(name):
            keys = set(row.get("expected_data_keys", []))
            assert not keys & _RETIRED_CLARIFY_KEYS
            if "candidates" in keys:
                assert {"reason", "candidates"} <= keys


def test_canonical_greetings_use_greet_user_stage() -> None:
    agent_rows = [
        row for row in _rows("agent_eval_v3.json") if row.get("path") == "pure_greeting"
    ]
    journey_rows = [
        row
        for row in _rows("runtime_journey_v1.json")
        if isinstance(row.get("metadata"), dict)
        and row["metadata"].get("category") == "greet"
    ]
    assert agent_rows and all(
        row["acceptable_stages"] == ["greet_user"] for row in agent_rows
    )
    assert journey_rows and all(
        row["expected_stage"] == "greet_user" for row in journey_rows
    )


def test_d3_dataset_covers_selection_and_terminal_matrix() -> None:
    rows = _rows("phase1c_selection_v1.json")
    assert all(row.get("selected_candidate_ids") for row in rows)
    assert all(isinstance(row.get("clarification_id"), int) for row in rows)
    assert all(row.get("seeded_pending") for row in rows)
    key_sets = {tuple(row["expected_data_keys"]) for row in rows}
    assert {("results",), ("results", "route")} <= key_sets


def test_d3_seeded_pending_values_validate_as_typed_state() -> None:
    for row in _rows("phase1c_selection_v1.json"):
        pending = PendingClarification.model_validate(row["seeded_pending"])
        assert pending.revision == row["clarification_id"]
