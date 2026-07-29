"""Unit tests for fact-ledger consumption, envelope serialization, and the
rollback-compatible parse path. Core append/supersede/bound behavior lives
in `test_fact_ledger.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from agent.agents.animichi_agent import trusted_session_context
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import SessionState
from agent.agents.tool_state import ToolState
from agent.domain.fact_ledger import FactLedger, HardConstraintRecord
from agent.interfaces import session_facade
from agent.interfaces.session_facade import (
    _parse_forward_compatible,
    _parse_runtime_state,
    _serialize_runtime_state,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


def _deps(session: SessionState) -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(),
        locale="en",
        query="q",
        catalog=MockCatalogClient(),
        tool_state=ToolState(session=session),
    )


def test_consumption_gate_hard_constraint_reaches_trusted_prompt_context() -> None:
    state = SessionState()
    state.fact_ledger.append_hard_constraint("packed", now=_NOW)

    context = trusted_session_context(_deps(state))

    assert "User hard constraint: packed pacing." in context
    assert "Apply this pacing to every subsequent plan_route call" in context


def test_consumption_gate_scene_reference_reaches_trusted_prompt_context() -> None:
    state = SessionState()
    state.fact_ledger.replace_scene_references(
        [("p1", "Episode 5 — 資生堂前 @ 340s")], now=_NOW
    )

    context = trusted_session_context(_deps(state))

    assert "Referenced scene: Episode 5 — 資生堂前 @ 340s." in context
    assert "durable point of interest" in context


def test_fresh_empty_ledger_round_trips_without_error() -> None:
    dumped = FactLedger().model_dump(mode="json")

    restored = FactLedger.model_validate(dumped)

    assert restored == FactLedger()
    assert restored.is_empty()


def test_fresh_empty_ledger_adds_no_key_to_the_serialized_envelope() -> None:
    dumped = _serialize_runtime_state(SessionState())

    assert "fact_ledger" not in dumped


def test_a_recorded_fact_is_present_in_the_serialized_envelope() -> None:
    state = SessionState()
    state.fact_ledger.append_hard_constraint("packed", now=_NOW)

    dumped = _serialize_runtime_state(state)

    assert "fact_ledger" in dumped


def test_fresh_empty_compaction_ledger_adds_no_key_to_the_serialized_envelope() -> None:
    """#476 P1-2: the new field must not regress the null/empty AC at the
    persistence layer just because it inherited `fact_ledger`'s field, not
    its `_serialize_runtime_state` pop discipline."""
    dumped = _serialize_runtime_state(SessionState())

    assert "compaction_retained_entities" not in dumped


def test_a_recorded_compaction_entity_is_present_in_the_serialized_envelope() -> None:
    state = SessionState()
    state.compaction_retained_entities.record("search_nearby", "資生堂前")

    dumped = _serialize_runtime_state(state)

    assert "compaction_retained_entities" in dumped


def test_an_unparseable_fact_ledger_is_dropped_not_left_to_sink_the_session() -> None:
    """A newer/rolled-back deploy's `fact_ledger` shape must not sink the
    rest of an otherwise-valid typed session (#473 review's rollback ask)."""
    dumped = SessionState().model_dump(mode="json")
    dumped["current_anime"] = {"bangumi_id": "1", "title": "Haruhi"}
    dumped["fact_ledger"] = {"hard_constraints": [{"not_a_real_field": True}]}

    restored = _parse_runtime_state(dumped)

    assert restored is not None
    assert restored.fact_ledger.is_empty()
    assert restored.current_anime is not None
    assert restored.current_anime.title == "Haruhi"


def test_dropping_fact_ledger_logs_a_logfire_visible_warning() -> None:
    """The rollback-compat path must be observable (#473 round 3), not a
    silent degrade — `logger.warning("fact_ledger_dropped", ...)`.

    Both allowlisted keys are dropped together (the retry is a batch of the
    intersection, not a per-key isolation) even though only `fact_ledger` is
    actually malformed here — `compaction_retained_entities` is present
    (empty, valid) and gets swept along, per #476's Task 5 review.
    """
    dumped = SessionState().model_dump(mode="json")
    dumped["fact_ledger"] = "not even a dict"

    with patch.object(session_facade, "logger") as mock_logger:
        restored = _parse_forward_compatible(dumped)

    assert restored == SessionState()
    mock_logger.warning.assert_called_once_with(
        "fact_ledger_dropped",
        dropped_keys=["compaction_retained_entities", "fact_ledger"],
    )


def test_parse_forward_compatible_only_drops_the_allowlisted_key() -> None:
    dumped = SessionState().model_dump(mode="json")
    dumped["fact_ledger"] = "not even a dict"

    restored = _parse_forward_compatible(dumped)

    assert restored == SessionState()


def test_genuine_corruption_still_returns_none_not_a_blanket_strip() -> None:
    assert _parse_runtime_state({"unknown": True}) is None


def test_unknown_field_is_rejected_at_the_model_boundary() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        FactLedger.model_validate({"hard_constraints": [], "bogus": True})


def test_malformed_record_is_rejected_at_the_model_boundary() -> None:
    with pytest.raises(ValidationError):
        FactLedger.model_validate(
            {
                "hard_constraints": [
                    {
                        "id": "a",
                        "value": "chill",
                        "recorded_at": _NOW.isoformat(),
                        "not_a_real_field": True,
                    }
                ]
            }
        )


def test_invalid_pacing_value_is_rejected_at_the_model_boundary() -> None:
    with pytest.raises(ValidationError):
        HardConstraintRecord.model_validate(
            {"id": "a", "value": "sprint", "recorded_at": _NOW.isoformat()}
        )
