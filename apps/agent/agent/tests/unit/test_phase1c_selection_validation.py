"""Candidate selection membership, revision, and reason-cardinality pins."""

from __future__ import annotations

import pytest

from agent.agents.selection import SelectionError, validate_candidate_selection
from agent.agents.session_state import SessionState


def _state(reason: str, ids: list[str]) -> SessionState:
    return SessionState.model_validate(
        {
            "pending_clarification": {
                "reason": reason,
                "candidate_ids": ids,
                "ordered_candidates": [],
                "revision": 7,
            },
            "clarification_revision": 7,
        }
    )


def test_anime_selection_accepts_multiple_and_dedupes() -> None:
    selected = validate_candidate_selection(
        _state("anime_ambiguity", ["1", "2"]), ["2", "2", "1"], 7
    )
    assert selected.candidate_ids == ["2", "1"]


def test_place_selection_accepts_one_after_dedupe() -> None:
    selected = validate_candidate_selection(
        _state("place_ambiguity", ["a", "b"]), ["a", "a"], 7
    )
    assert selected.candidate_ids == ["a"]


@pytest.mark.parametrize(
    ("state", "ids", "revision"),
    [
        (_state("anime_ambiguity", ["1", "2"]), ["3"], 7),
        (_state("anime_ambiguity", ["1", "2"]), ["1"], 6),
        (_state("place_ambiguity", ["a", "b"]), ["a", "b"], 7),
        (_state("anime_not_found", []), ["1"], 7),
        (SessionState(), ["1"], 7),
    ],
)
def test_invalid_selection_is_rejected_wholesale(
    state: SessionState, ids: list[str], revision: int
) -> None:
    before = state.model_dump()
    with pytest.raises(SelectionError):
        validate_candidate_selection(state, ids, revision)
    assert state.model_dump() == before
