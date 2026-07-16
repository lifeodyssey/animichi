"""Phase 1d partial results persist through the normal turn path."""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai.messages import ModelRequest, UserPromptPart

from agent.agents.agent_result import AgentResult, ProducedRoute, TurnProvenance
from agent.agents.runtime_models import PartialResponseModel
from agent.agents.session_state import (
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI


def _partial_route_result() -> AgentResult:
    search_ref = ResultRef("search:partial")
    route_ref = RouteRef("route:partial")
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
    state.store_route(
        route_ref,
        RoutePayloadState(
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
            route=ProducedRoute(status="ok", route_ref=route_ref)
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


def _db() -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    db.user_memory.get_user_memory = AsyncMock(return_value=None)
    db.session.upsert_session = AsyncMock()
    db.insert_message = AsyncMock()
    db.insert_request_log = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-id")
    return db


async def test_partial_with_current_route_persists_assistant_and_route() -> None:
    store = InMemorySessionStore()
    db = _db()
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
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
    state = SessionState.model_validate(delta["session_state_v2"])
    assert state.last_result_ref == "search:partial"
    assert db.insert_message.await_count == 2
    assert db.insert_message.await_args_list[1].args[1] == "assistant"
    db.routes.save_route.assert_awaited_once()
    assert response.route_history[0]["route_id"] == "route-id"


async def test_message_only_partial_persists_assistant_without_route() -> None:
    db = _db()
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=_message_only_partial_result()),
    ):
        response = await RuntimeAPI(
            db, session_store=InMemorySessionStore(), model_http_client=MagicMock()
        ).handle(PublicAPIRequest(text="find it", locale="en"))
    assert db.insert_message.await_count == 2
    assert db.insert_message.await_args_list[1].args[1:] == (
        "assistant",
        "Partial results are shown.",
        {"intent": "partial", "success": False},
    )
    db.routes.save_route.assert_not_awaited()
    assert response.route_history == []
