"""Public API helper seams (TURN-4 #955 coverage loop).

Direct unit coverage of the private bridge/projection helpers the route
harness never exercises in their unused branches: stage-sink bridging, the
context-delta extract port, gateway ownership checks, rejection responses,
span attribution with a bare span, the translation gate no-message and
failure branches, and the public usage-recording alias.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai.usage import RunUsage

from animichi.agents.agent_result import AttributedUsage
from animichi.agents.runtime_deps import StepEvent
from animichi.application.turn_types import TurnStageEvent
from animichi.infrastructure.supabase.client import SupabaseClient
from animichi.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    _apply_translation_gate,
    _extract_delta_port,
    _input_error_response,
    _record_result_span,
    _rejection_response,
    _RuntimeSessionGateway,
    _stage_sink,
    _to_on_step,
    record_attributed_usage,
)
from animichi.interfaces.usage_metering import UsagePrices
from animichi.tests.unit.conftest_public_api import make_result


def _api(db: MagicMock | None = None) -> RuntimeAPI:
    return RuntimeAPI(
        db or MagicMock(spec=SupabaseClient), model_http_client=MagicMock()
    )


def test_model_http_client_property_returns_the_bound_client() -> None:
    client = MagicMock()
    api = RuntimeAPI(MagicMock(spec=SupabaseClient), model_http_client=client)

    assert api.model_http_client is client


def test_input_error_response_rejects_oversized_text() -> None:
    request = PublicAPIRequest(text="x" * 20)

    rejection = _input_error_response(request, limit=10)

    assert rejection is not None
    assert rejection.success is False
    assert rejection.errors[0].code == "invalid_input"


def test_input_error_response_accepts_within_limit() -> None:
    request = PublicAPIRequest(text="x" * 5)

    assert _input_error_response(request, limit=10) is None


async def test_stage_sink_bridges_turn_events_to_step_events() -> None:
    captured: list[StepEvent] = []

    async def on_step(step: StepEvent) -> None:
        captured.append(step)

    sink = _stage_sink(on_step)
    assert sink is not None
    await sink(
        TurnStageEvent(
            tool="plan_route", call_id="c1", status="done", data={"route_ref": "r1"}
        )
    )

    assert captured[0].tool == "plan_route"
    assert captured[0].call_id == "c1"
    assert captured[0].data == {"route_ref": "r1"}


async def test_to_on_step_bridges_step_events_back_to_turn_events() -> None:
    captured: list[TurnStageEvent] = []

    async def sink(event: TurnStageEvent) -> None:
        captured.append(event)

    on_step = _to_on_step(sink)
    assert on_step is not None
    await on_step(StepEvent("resolve_anime", "c2", "running", {}))

    assert captured[0].tool == "resolve_anime"
    assert captured[0].status == "running"


def test_extract_delta_port_serializes_agent_results_only() -> None:
    extract = _extract_delta_port()

    assert extract("not-an-agent-result") == {}
    delta = extract(make_result())
    assert "session_state_v2" in delta


async def test_gateway_check_owner_short_circuits_without_both_ids() -> None:
    gateway = _RuntimeSessionGateway(
        _api(), request=PublicAPIRequest(text="京吹"), user_id=None
    )

    assert await gateway.check_owner(None, None) is True
    assert await gateway.check_owner(None, "user-1") is True
    assert await gateway.check_owner("s-1", None) is True


async def test_gateway_check_owner_false_without_a_wired_repo() -> None:
    gateway = _RuntimeSessionGateway(
        _api(), request=PublicAPIRequest(text="京吹"), user_id=None
    )

    assert await gateway.check_owner("s-1", "user-1") is False


async def test_gateway_check_owner_true_when_the_repo_confirms() -> None:
    db = MagicMock(spec=SupabaseClient)
    db.session = AsyncMock()
    db.session.check_session_owner = AsyncMock(return_value=True)
    gateway = _RuntimeSessionGateway(
        _api(db), request=PublicAPIRequest(text="京吹"), user_id=None
    )

    assert await gateway.check_owner("s-1", "user-1") is True


def test_rejection_response_without_a_rejection_falls_back_to_internal() -> None:
    response = _rejection_response(None)

    assert response.success is False
    assert response.status == "error"


def test_record_result_span_handles_a_bare_span() -> None:
    from animichi.application.turn_types import TurnResult

    result = TurnResult(outcome="completed", output=make_result())
    response = _api()._response(PublicAPIRequest(text="京吹"), result)

    _record_result_span(object(), PublicAPIRequest(text="京吹"), response)


async def test_translation_gate_skips_an_empty_message() -> None:
    result = make_result(message="")

    await _apply_translation_gate(result, "ja", None, model=None)

    assert result.message == ""


async def test_translation_gate_survives_a_translation_failure() -> None:
    result = make_result(intent="qa", message="こんにちは！")

    with patch(
        "animichi.interfaces.public_api.translate_text",
        new=AsyncMock(side_effect=OSError("translation backend down")),
    ):
        await _apply_translation_gate(result, "zh", None, model=None)

    assert result.message == "こんにちは！"


async def test_record_attributed_usage_alias_delegates_without_a_repo() -> None:
    item = AttributedUsage(RunUsage(requests=1), "platform")

    await record_attributed_usage(
        None, item, user_id=None, user_type=None, platform_prices=UsagePrices(0.0, 0.0)
    )
