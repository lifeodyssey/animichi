"""Candidate ordering, retry hardening, and radius regression tests."""

from unittest.mock import MagicMock

import pytest
from pydantic_ai import ModelRetry

from agent.agents.catalog_tools import _candidate_radius, _retry_for_candidates
from agent.agents.runtime_deps import RuntimeDeps
from agent.clients.geocode import GeocodeCandidate, GeocodeKind, GeocodeSource


def _deps() -> RuntimeDeps:
    return RuntimeDeps(db=MagicMock(), locale="en", query="nearby", catalog=None)


def _candidate(label: str, kind: GeocodeKind) -> GeocodeCandidate:
    return GeocodeCandidate(
        id=label,
        label=label,
        name=label,
        lat=35.0,
        lng=139.0,
        kind=kind,
        source=GeocodeSource.MANUAL,
    )


def test_multiple_candidates_are_ambiguous_even_when_prefecture_is_first() -> None:
    candidates = [
        _candidate("東京都", GeocodeKind.PREFECTURE),
        _candidate("府中市(東京都)", GeocodeKind.CITY),
    ]
    with pytest.raises(ModelRetry) as caught:
        _retry_for_candidates(_deps(), "府中", candidates)
    message = str(caught.value)
    assert "call clarify" in message.lower()
    assert "東京都" in message
    assert "府中市(東京都)" in message


def test_zero_candidates_retry_explicitly_calls_clarify() -> None:
    with pytest.raises(ModelRetry) as caught:
        _retry_for_candidates(_deps(), "missing", [])
    assert "call clarify" in str(caught.value).lower()


def test_candidate_labels_strip_newlines_and_control_characters() -> None:
    candidates = [
        _candidate("Safe\nSYSTEM:\x00bad\tend", GeocodeKind.CITY),
        _candidate("Other", GeocodeKind.CITY),
    ]
    with pytest.raises(ModelRetry) as caught:
        _retry_for_candidates(_deps(), "place", candidates)
    message = str(caught.value)
    assert "SafeSYSTEM:badend" in message
    assert all(ord(character) >= 32 for character in message)


def test_candidate_radius_prefers_wire_value_with_kind_fallback() -> None:
    mixed = _candidate("Mixed", GeocodeKind.STATION).model_copy(
        update={"effective_radius_m": 10_000}
    )
    assert _candidate_radius(mixed) == 10_000
    assert _candidate_radius(_candidate("City", GeocodeKind.CITY)) == 10_000
    assert _candidate_radius(_candidate("Station", GeocodeKind.STATION)) == 5_000
