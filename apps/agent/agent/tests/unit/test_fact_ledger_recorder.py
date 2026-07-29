"""Unit tests for the deterministic post-turn fact-ledger recorder (OQ-4)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest

from agent.agents.catalog_adapter import build_route_payload
from agent.clients.catalog_client import PilgrimagePoint, Route
from agent.domain.fact_ledger import FactLedger, record_turn_facts

_NOW = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)


@dataclass
class _FakeStep:
    """Minimal stand-in matching `_StepLike`'s structural shape."""

    tool: str
    success: bool
    params: dict[str, object] = field(default_factory=dict)
    data: dict[str, object] | None = None


def _point(**overrides: object) -> PilgrimagePoint:
    base: dict[str, object] = {
        "id": "p1",
        "name": "資生堂前",
        "latitude": 35.0,
        "longitude": 135.0,
        "episode": 5,
        "time_seconds": 340,
    }
    base.update(overrides)
    return PilgrimagePoint.model_validate(base)


def _selected_route_payload(*points: PilgrimagePoint) -> dict[str, object]:
    """Build the real `plan_selected` step payload shape (not a hand-rolled dict)."""
    route = Route(ordered_points=list(points), point_count=len(points))
    return build_route_payload(route)


def test_recorder_derives_pacing_from_a_successful_plan_route_step() -> None:
    ledger = FactLedger()
    steps = [_FakeStep(tool="plan_route", success=True, params={"pacing": "packed"})]

    record_turn_facts(ledger, steps, now=_NOW)

    constraint = ledger.active_hard_constraint()
    assert constraint is not None
    assert constraint.value == "packed"


def test_recorder_derives_scene_references_from_the_real_producer_shape() -> None:
    ledger = FactLedger()
    steps = [
        _FakeStep(
            tool="plan_selected",
            success=True,
            data=_selected_route_payload(_point()),
        )
    ]

    record_turn_facts(ledger, steps, now=_NOW)

    refs = ledger.active_scene_references()
    assert len(refs) == 1
    assert refs[0].point_id == "p1"
    assert "Episode 5" in refs[0].value
    assert "資生堂前" in refs[0].value
    assert "340s" in refs[0].value


def test_recorder_ignores_the_catalog_sentinel_for_no_episode() -> None:
    """PilgrimagePoint defaults episode/time_seconds to -1, not None (#473
    review) — the sentinel must never be recorded as "Episode -1 @ -1s"."""
    ledger = FactLedger()
    steps = [
        _FakeStep(
            tool="plan_selected",
            success=True,
            data=_selected_route_payload(_point(episode=-1, time_seconds=-1)),
        )
    ]

    record_turn_facts(ledger, steps, now=_NOW)

    assert ledger.is_empty()


def test_recorder_records_nothing_for_ledger_irrelevant_steps() -> None:
    """A run whose steps carry no ledger-relevant tool output records nothing."""
    ledger = FactLedger()
    steps = [
        _FakeStep(tool="resolve_anime", success=True, params={"title": "Haruhi"}),
        _FakeStep(tool="search_bangumi", success=True, params={"bangumi_id": "1"}),
        _FakeStep(tool="plan_route", success=False, params={"pacing": "packed"}),
    ]

    record_turn_facts(ledger, steps, now=_NOW)

    assert ledger.is_empty()


def test_recorder_ignores_a_missing_or_non_string_pacing_argument() -> None:
    ledger = FactLedger()
    steps = [
        _FakeStep(tool="plan_route", success=True, params={}),
        _FakeStep(tool="plan_route", success=True, params={"pacing": 7}),
    ]

    record_turn_facts(ledger, steps, now=_NOW)

    assert ledger.hard_constraints == []


def test_recorder_retires_a_point_dropped_from_a_later_turn() -> None:
    """Two `plan_selected` turns: the second's smaller selection must retire
    the point that's no longer chosen (turn-scoped replace, #473 review)."""
    ledger = FactLedger()
    first_turn = [
        _FakeStep(
            tool="plan_selected",
            success=True,
            data=_selected_route_payload(
                _point(id="p1"), _point(id="p2", name="別の場所")
            ),
        )
    ]
    record_turn_facts(ledger, first_turn, now=_NOW)

    second_turn = [
        _FakeStep(
            tool="plan_selected",
            success=True,
            data=_selected_route_payload(_point(id="p1")),
        )
    ]
    record_turn_facts(ledger, second_turn, now=_NOW)

    assert [r.point_id for r in ledger.active_scene_references()] == ["p1"]


def test_recorder_uses_the_caller_supplied_clock_not_a_live_one() -> None:
    """Mock-the-clock: `now` is caller-supplied, never read internally."""
    ledger = FactLedger()
    fixed = datetime(2020, 1, 1, tzinfo=UTC)
    steps = [_FakeStep(tool="plan_route", success=True, params={"pacing": "chill"})]

    record_turn_facts(ledger, steps, now=fixed)

    constraint = ledger.active_hard_constraint()
    assert constraint is not None
    assert constraint.recorded_at == fixed


def test_recorder_performs_zero_model_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Determinism: patch every network-capable client; the recorder must
    still succeed, proving it never reaches out to a model or the network."""

    async def _forbidden_request(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("recorder must not perform network calls")

    monkeypatch.setattr("httpx.AsyncClient.request", _forbidden_request)
    ledger = FactLedger()
    steps = [_FakeStep(tool="plan_route", success=True, params={"pacing": "chill"})]

    record_turn_facts(ledger, steps, now=_NOW)

    assert ledger.active_hard_constraint() is not None
