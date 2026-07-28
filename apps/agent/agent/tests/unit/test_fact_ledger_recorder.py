"""Unit tests for the deterministic post-turn fact-ledger recorder (OQ-4)."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from agent.domain.fact_ledger import FactLedger, record_turn_facts


@dataclass
class _FakeStep:
    """Minimal stand-in matching `_StepLike`'s structural shape."""

    tool: str
    success: bool
    params: dict[str, object] = field(default_factory=dict)
    data: dict[str, object] | None = None


def test_recorder_derives_pacing_from_a_successful_plan_route_step() -> None:
    ledger = FactLedger()
    steps = [_FakeStep(tool="plan_route", success=True, params={"pacing": "packed"})]

    record_turn_facts(ledger, steps)

    constraint = ledger.active_hard_constraint()
    assert constraint is not None
    assert constraint.value == "packed"


def test_recorder_derives_scene_references_from_selected_ordered_points() -> None:
    ledger = FactLedger()
    steps = [
        _FakeStep(
            tool="plan_selected",
            success=True,
            data={
                "ordered_points": [
                    {"id": "p1", "episode": 5, "name": "資生堂前", "time_seconds": 340}
                ]
            },
        )
    ]

    record_turn_facts(ledger, steps)

    refs = ledger.active_scene_references()
    assert len(refs) == 1
    assert refs[0].point_id == "p1"
    assert "Episode 5" in refs[0].value
    assert "資生堂前" in refs[0].value
    assert "340s" in refs[0].value


def test_recorder_records_nothing_for_ledger_irrelevant_steps() -> None:
    """A run whose steps carry no ledger-relevant tool output records nothing."""
    ledger = FactLedger()
    steps = [
        _FakeStep(tool="resolve_anime", success=True, params={"title": "Haruhi"}),
        _FakeStep(tool="search_bangumi", success=True, params={"bangumi_id": "1"}),
        _FakeStep(tool="plan_route", success=False, params={"pacing": "packed"}),
    ]

    record_turn_facts(ledger, steps)

    assert ledger.is_empty()


def test_recorder_ignores_a_missing_or_non_string_pacing_argument() -> None:
    ledger = FactLedger()
    steps = [
        _FakeStep(tool="plan_route", success=True, params={}),
        _FakeStep(tool="plan_route", success=True, params={"pacing": 7}),
    ]

    record_turn_facts(ledger, steps)

    assert ledger.hard_constraints == []


def test_recorder_performs_zero_model_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Determinism: patch every network-capable client; the recorder must
    still succeed, proving it never reaches out to a model or the network."""

    async def _forbidden_request(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("recorder must not perform network calls")

    monkeypatch.setattr("httpx.AsyncClient.request", _forbidden_request)
    ledger = FactLedger()
    steps = [_FakeStep(tool="plan_route", success=True, params={"pacing": "chill"})]

    record_turn_facts(ledger, steps)

    assert ledger.active_hard_constraint() is not None
