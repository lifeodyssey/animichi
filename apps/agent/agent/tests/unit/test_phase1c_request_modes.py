"""Public request-mode exclusivity and normalization pins."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agent.interfaces.schemas import PublicAPIRequest


def test_plain_text_mode() -> None:
    request = PublicAPIRequest(text=" search ")
    assert request.text == "search"


def test_point_selection_mode() -> None:
    request = PublicAPIRequest(text="", selected_point_ids=[" p1 ", "p1", "p2"])
    assert request.selected_point_ids == ["p1", "p2"]


def test_candidate_selection_dedupes_before_cardinality() -> None:
    request = PublicAPIRequest(
        text="",
        selected_candidate_ids=[" place ", "place"],
        clarification_id=3,
    )
    assert request.selected_candidate_ids == ["place"]


def test_boolean_clarification_revision_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PublicAPIRequest(selected_candidate_ids=["1"], clarification_id=True)


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "query", "selected_point_ids": ["p1"]},
        {
            "text": "",
            "selected_point_ids": ["p1"],
            "selected_candidate_ids": ["1"],
            "clarification_id": 1,
        },
        {"text": "", "selected_candidate_ids": ["1"]},
        {"text": "query", "clarification_id": 1},
        {"text": "", "clarification_id": 1},
    ],
)
def test_mixed_or_incomplete_modes_are_rejected(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        PublicAPIRequest.model_validate(payload)
