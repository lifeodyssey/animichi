"""state_digest canonicalisation tests (TURN-2 #949)."""

from __future__ import annotations

from animichi.infrastructure.turn_reservation.postgres import state_digest


def test_state_digest_canonicalises_json_text() -> None:
    assert state_digest('{"b": 1, "a": 2}') == state_digest({"a": 2, "b": 1})


def test_state_digest_invalid_json_digests_as_empty() -> None:
    assert state_digest("not-json") == state_digest({})


def test_state_digest_non_dict_digests_as_empty() -> None:
    assert state_digest([1, 2]) == state_digest({})
