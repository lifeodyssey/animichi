"""Unit tests for the typed, bounded session fact ledger (S1.7 Task 4)."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from agent.agents.animichi_agent import trusted_session_context
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import SessionState
from agent.agents.tool_state import ToolState
from agent.domain.fact_ledger import (
    MAX_RECORDS_PER_FIELD,
    FactLedger,
    HardConstraintRecord,
    SceneReferenceRecord,
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


def test_each_field_accepts_an_independent_append_with_timestamp_and_kind() -> None:
    ledger = FactLedger()

    constraint = ledger.append_hard_constraint("chill", now=_NOW)
    scene = ledger.append_scene_reference(point_id="p1", value="Episode 3", now=_NOW)

    assert isinstance(constraint, HardConstraintRecord)
    assert constraint.kind == "pacing"
    assert constraint.recorded_at == _NOW
    assert isinstance(scene, SceneReferenceRecord)
    assert scene.kind == "episode_scene"
    assert scene.recorded_at == _NOW
    assert ledger.hard_constraints == [constraint]
    assert ledger.scene_references == [scene]


def test_a_correction_appends_and_tags_the_prior_record_superseded() -> None:
    ledger = FactLedger()
    first = ledger.append_hard_constraint("chill", now=_NOW)

    second = ledger.append_hard_constraint("packed", now=_NOW)

    assert first.superseded_by == second.id
    assert first.value == "chill"  # prior content stays readable, not deleted
    assert ledger.active_hard_constraint() == second
    assert first in ledger.hard_constraints


def test_scene_reference_correction_supersedes_only_the_same_point() -> None:
    ledger = FactLedger()
    other = ledger.append_scene_reference(point_id="other", value="Episode 1", now=_NOW)
    first = ledger.append_scene_reference(point_id="p1", value="Episode 3", now=_NOW)

    second = ledger.append_scene_reference(point_id="p1", value="Episode 4", now=_NOW)

    assert first.superseded_by == second.id
    assert other.superseded_by is None
    assert ledger.active_scene_references() == [other, second]


def test_consumption_gate_hard_constraint_reaches_trusted_prompt_context() -> None:
    state = SessionState()
    state.fact_ledger.append_hard_constraint("packed", now=_NOW)

    context = trusted_session_context(_deps(state))

    assert "User hard constraint: packed pacing." in context


def test_consumption_gate_scene_reference_reaches_trusted_prompt_context() -> None:
    state = SessionState()
    state.fact_ledger.append_scene_reference(
        point_id="p1", value="Episode 5 — 資生堂前 @ 340s", now=_NOW
    )

    context = trusted_session_context(_deps(state))

    assert "Referenced scene: Episode 5 — 資生堂前 @ 340s." in context


def test_fresh_empty_ledger_round_trips_and_adds_no_key_to_session_state() -> None:
    state = SessionState()
    before_keys = set(state.model_dump(mode="json"))

    dumped = state.fact_ledger.model_dump(mode="json")
    restored = FactLedger.model_validate(dumped)

    assert restored == FactLedger()
    assert restored.is_empty()
    assert set(state.model_dump(mode="json")) == before_keys


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


def test_boundary_cap_evicts_oldest_superseded_and_keeps_every_live_record() -> None:
    ledger = FactLedger()
    for index in range(MAX_RECORDS_PER_FIELD + 4):
        ledger.append_hard_constraint(f"value-{index}", now=_NOW)
    for index in range(MAX_RECORDS_PER_FIELD + 4):
        # Same point_id -> each append supersedes the prior one, so eviction
        # has superseded records to drop while the one live record survives.
        ledger.append_scene_reference(point_id="p1", value=f"Episode {index}", now=_NOW)

    assert len(ledger.hard_constraints) == MAX_RECORDS_PER_FIELD
    assert len(ledger.scene_references) == MAX_RECORDS_PER_FIELD
    last_constraint = ledger.active_hard_constraint()
    assert last_constraint is not None
    assert last_constraint.value == f"value-{MAX_RECORDS_PER_FIELD + 3}"
    live_scenes = [r for r in ledger.scene_references if r.superseded_by is None]
    assert len(live_scenes) == 1
    assert live_scenes[0].value == f"Episode {MAX_RECORDS_PER_FIELD + 3}"
    assert ledger.encoded_size_bytes() < 8 * 1024
