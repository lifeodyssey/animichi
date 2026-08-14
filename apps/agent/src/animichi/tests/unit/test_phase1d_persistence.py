"""Phase 1d partial results persist through the normal turn path."""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai.messages import ModelRequest, UserPromptPart

from animichi.agents.agent_result import AgentResult, ProducedItinerary, TurnProvenance
from animichi.agents.runtime_models import BlockedResponseModel, PartialResponseModel
from animichi.agents.session_state import (
    ItineraryPayloadState,
    ItineraryRef,
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from animichi.infrastructure.session.memory import InMemorySessionStore
from animichi.interfaces.public_api import PublicAPIRequest, RuntimeAPI


def _partial_route_result() -> AgentResult:
    search_ref = ResultRef("search:partial")
    itinerary_ref = ItineraryRef("route:partial")
    state = SessionState()
    state.store_search_result(
        search_ref,
        SearchPayloadState(
            kind="bangumi",
            rows=[PointState(id="p1", bangumi_id="1")],
            row_count=1,
            anime_id="1",
        ),
    )
    state.store_itinerary(
        itinerary_ref,
        ItineraryPayloadState(
            ordered_points=[PointState(id="p1", bangumi_id="1")],
            source_ref=search_ref,
        ),
    )
    return AgentResult(
        output=PartialResponseModel(message="Partial results are shown."),
        intent="partial",
        session_state=state,
        status="partial",
        success_override=False,
        provenance=TurnProvenance(
            itinerary=ProducedItinerary(status="ok", itinerary_ref=itinerary_ref)
        ),
    )


def _message_only_partial_result() -> AgentResult:
    return AgentResult(
        output=PartialResponseModel(message="Partial results are shown."),
        intent="partial",
        session_state=SessionState(),
        new_messages=[ModelRequest(parts=[UserPromptPart(content="find it")])],
        status="partial",
        success_override=False,
    )


def _blocked_result() -> AgentResult:
    return AgentResult(
        output=BlockedResponseModel(message="Request blocked. Please rephrase it."),
        intent="blocked",
        session_state=SessionState(),
        status="blocked",
        success_override=False,
    )


def _db() -> MagicMock:
    db = MagicMock()
    db.session.create = AsyncMock()
    db.session.upsert_session = AsyncMock()
    # #663: the real repo lives at `db.session`/`db.feedback`, not a flat
    # `db.insert_message`/`db.insert_request_log` — that was the production bug.
    db.session.insert_message = AsyncMock()
    db.feedback.insert_request_log = AsyncMock()
    return db


async def _run_result(db: MagicMock, result: AgentResult) -> None:
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=result),
    ):
        await RuntimeAPI(
            db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ).handle(PublicAPIRequest(text="test request", locale="en"))


async def test_partial_with_current_route_persists_assistant_and_route() -> None:
    store = InMemorySessionStore()
    db = _db()
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=_partial_route_result()),
    ):
        response = await RuntimeAPI(
            db, session_store=store, model_http_client=MagicMock()
        ).handle(PublicAPIRequest(text="find it"))
    assert response.session_id is not None
    saved = await store.get(response.session_id)
    assert saved is not None
    assert (saved["last_intent"], saved["last_status"]) == ("partial", "partial")
    interaction = cast(dict[str, object], saved["interactions"][0])
    assert interaction["success"] is False
    delta = cast(dict[str, object], interaction["context_delta"])
    assert "session_state_v2" not in delta
    state = SessionState.model_validate(saved["session_state_v2"])
    assert state.last_result_ref == "search:partial"
    assert db.session.insert_message.await_count == 2
    assert db.session.insert_message.await_args_list[1].args[1] == "assistant"
    assert response.route_history[0]["route_id"] is None


async def test_message_only_partial_persists_assistant_without_route() -> None:
    db = _db()
    with patch(
        "animichi.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=_message_only_partial_result()),
    ):
        response = await RuntimeAPI(
            db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ).handle(PublicAPIRequest(text="find it", locale="en"))
    assert db.session.insert_message.await_count == 2
    assert db.session.insert_message.await_args_list[1].args[1:] == (
        "assistant",
        "Partial results are shown.",
        {"intent": "partial", "success": False},
    )
    assert response.route_history == []


async def test_blocked_turn_persists_assistant_refusal() -> None:
    db = _db()
    await _run_result(db, _blocked_result())
    assert db.session.insert_message.await_count == 2
    assert db.session.insert_message.await_args_list[1].args[1:] == (
        "assistant",
        "Request blocked. Please rephrase it.",
        {"intent": "blocked", "success": False},
    )
