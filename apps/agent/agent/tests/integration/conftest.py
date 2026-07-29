"""Integration test fixtures — real PostgreSQL plus runtime API helpers."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_deps import OnStep, StepEvent, new_step_call_id
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.agents.session_state import (
    NearbyGroupState,
    OrderedCandidate,
    PendingClarification,
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchMetadataState,
    SearchPayloadState,
    SessionState,
    TimedItineraryState,
)
from agent.config.settings import Settings
from agent.infrastructure.session import create_session_store
from agent.infrastructure.supabase.client import SupabaseClient
from agent.interfaces.fastapi_service import create_fastapi_app
from agent.interfaces.public_api import RuntimeAPI
from agent.tests.conftest_db import DatabaseTarget

pytest_plugins = ("agent.tests.conftest_db",)


@pytest.fixture
async def tc_db(pg_container: DatabaseTarget) -> AsyncIterator[SupabaseClient]:
    """A real SupabaseClient connected to the testcontainer PostgreSQL."""
    client = SupabaseClient(
        pg_container.dsn,
        min_pool_size=1,
        max_pool_size=5,
        statement_cache_size=0,
    )
    await client.connect()
    yield client
    await client.close()


_CLARIFY_CANDIDATES = [
    OrderedCandidate(id="11291", title="凉宫春日的忧郁", points_count=2, city="西宫"),
    OrderedCandidate(id="3375", title="凉宫春日的消失", points_count=1, city="西宫"),
]

_NEARBY_POINTS = [
    PointState(
        id="pt-uji-1",
        name="宇治桥",
        title="響け！ユーフォニアム",
        bangumi_id="115908",
        distance_m=280.0,
        latitude=34.889,
        longitude=135.807,
        cover_url="https://example.com/eupho.jpg",
    ),
    PointState(
        id="pt-uji-2",
        name="京阪宇治站",
        title="響け！ユーフォニアム",
        bangumi_id="115908",
        distance_m=460.0,
        latitude=34.891,
        longitude=135.81,
        cover_url="https://example.com/eupho.jpg",
    ),
]

_NEARBY_GROUPS = [
    NearbyGroupState(
        bangumi_id="115908",
        title="響け！ユーフォニアム",
        cover_url="https://example.com/eupho.jpg",
        points_count=2,
        closest_distance_m=280.0,
    ),
]

_ROUTE_POINTS = [
    PointState(
        id="pt-uji-1",
        name="宇治桥",
        latitude=34.889,
        longitude=135.807,
        cover_url="https://example.com/eupho.jpg",
    ),
    PointState(
        id="pt-uji-2",
        name="京阪宇治站",
        latitude=34.891,
        longitude=135.81,
        cover_url="https://example.com/eupho.jpg",
    ),
]


def _clarify_state() -> SessionState:
    pending = PendingClarification(
        reason="anime_ambiguity",
        candidate_ids=[item.id for item in _CLARIFY_CANDIDATES],
        ordered_candidates=_CLARIFY_CANDIDATES,
        revision=1,
    )
    return SessionState(pending_clarification=pending, clarification_revision=1)


def _make_agent_result(text: str, _locale: str) -> AgentResult:
    if "宇治" in text and "附近" in text:
        output = SearchResponseModel(message="宇治站附近有 2 处相关圣地。")
        ref = ResultRef("search:nearby:1")
        state = SessionState()
        state.store_search_result(
            ref,
            SearchPayloadState(
                kind="nearby",
                rows=_NEARBY_POINTS,
                row_count=2,
                metadata=SearchMetadataState(source="geo", radius_m=5000),
                nearby_groups=_NEARBY_GROUPS,
            ),
        )
        return AgentResult(
            output=output,
            intent="search_nearby",
            session_state=state,
            steps=[StepRecord(tool="search_nearby", success=True)],
        )

    if "路线" in text or "ルート" in text:
        output = RouteResponseModel(message="已为你规划好 2 个巡礼点的路线。")
        route_ref = RouteRef("route:test:1")
        state = SessionState()
        state.store_route(
            route_ref,
            RoutePayloadState(
                ordered_points=_ROUTE_POINTS,
                timed_itinerary=TimedItineraryState(
                    total_minutes=75,
                    total_distance_m=2200.0,
                ),
            ),
        )
        return AgentResult(
            output=output,
            intent="plan_route",
            session_state=state,
            steps=[StepRecord(tool="plan_route", success=True)],
        )

    if text.strip() in {"你好", "你是谁"}:
        output = QAResponseModel(
            message="我是 Animichi，可以帮你查找动漫圣地并规划巡礼路线。"
        )
        return AgentResult(
            output=output,
            intent="general_qa",
            session_state=SessionState(),
        )

    state = _clarify_state()
    output = ClarifyResponseModel(
        reason="anime_ambiguity",
        message="你是指哪部凉宫？",
        candidate_ids=["11291", "3375"],
    )
    return AgentResult(
        output=output,
        intent="clarify",
        session_state=state,
        steps=[StepRecord(tool="clarify", success=True, model_initiated=False)],
    )


def _build_test_app(db: SupabaseClient) -> FastAPI:
    settings = Settings()
    settings_store = create_session_store(db=db)
    runtime_api = RuntimeAPI(
        db, session_store=settings_store, model_http_client=MagicMock()
    )

    @asynccontextmanager
    async def _noop_lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield

    app = create_fastapi_app(runtime_api=runtime_api, settings=settings, db=db)
    app.router.lifespan_context = _noop_lifespan
    app.state.settings = settings
    app.state.runtime_api = runtime_api
    app.state.db_client = db
    return app


class _AuthedClient:
    def __init__(self, client: TestClient) -> None:
        self._client = client

    @staticmethod
    def _headers(headers: dict[str, str] | None = None) -> dict[str, str]:
        merged = {"X-User-Id": "user-1", "X-User-Type": "human"}
        if headers:
            merged.update(headers)
        return merged

    def get(self, url: str, **kwargs: object):
        headers = kwargs.pop("headers", None)
        return self._client.get(url, headers=self._headers(headers), **kwargs)

    def post(self, url: str, **kwargs: object):
        headers = kwargs.pop("headers", None)
        return self._client.post(url, headers=self._headers(headers), **kwargs)


class _SSEClient:
    def __init__(self, client: TestClient) -> None:
        self._client = client

    def stream(self, url: str, **kwargs: object) -> list[dict[str, object]]:
        headers = kwargs.pop("headers", None)
        merged_headers = _AuthedClient._headers(headers)
        with self._client.stream("POST", url, headers=merged_headers, **kwargs) as resp:
            body = "".join(resp.iter_text())
        return _parse_sse_events(body)


def _parse_sse_events(raw: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    current_event: str | None = None
    current_data_lines: list[str] = []

    for line in raw.split("\n"):
        if line.startswith("event: "):
            current_event = line[len("event: ") :]
            continue
        if line.startswith("data: "):
            current_data_lines.append(line[len("data: ") :])
            continue
        if line != "" or current_event is None:
            continue

        payload = "\n".join(current_data_lines)
        events.append(
            {
                "event": current_event,
                **json.loads(payload),
            }
        )
        current_event = None
        current_data_lines = []

    return events


@pytest.fixture
def client(tc_db: SupabaseClient) -> AsyncIterator[_AuthedClient]:
    async def _fake_run_animichi_agent(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        message_history: object | None = None,
        on_step: OnStep | None = None,
        catalog: object | None = None,
        memory_store: object | None = None,
        user_id: str | None = None,
    ) -> AgentResult:
        _ = (
            db,
            model,
            context,
            message_history,
            on_step,
            catalog,
            memory_store,
            user_id,
        )
        return _make_agent_result(text, locale)

    app = _build_test_app(tc_db)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        side_effect=_fake_run_animichi_agent,
    ):
        with TestClient(app) as raw_client:
            yield _AuthedClient(raw_client)


@pytest.fixture
def sse_client(tc_db: SupabaseClient) -> AsyncIterator[_SSEClient]:
    async def _fake_run_animichi_agent(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        message_history: object | None = None,
        on_step: OnStep | None = None,
        catalog: object | None = None,
        memory_store: object | None = None,
        user_id: str | None = None,
    ) -> AgentResult:
        _ = (db, model, context, message_history, catalog, memory_store, user_id)
        result = _make_agent_result(text, locale)
        if on_step is not None:
            data = result.session_state.model_dump(mode="json", exclude_none=True)
            await on_step(
                StepEvent(result.intent, new_step_call_id(result.intent), "done", data)
            )
        return result

    app = _build_test_app(tc_db)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        side_effect=_fake_run_animichi_agent,
    ):
        with TestClient(app) as raw_client:
            yield _SSEClient(raw_client)
