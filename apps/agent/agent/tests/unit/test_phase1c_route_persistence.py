"""Typed route identity and normalized association persistence pins."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import asyncpg
import pytest

from agent.agents.agent_result import AgentResult, ProducedRoute, TurnProvenance
from agent.agents.runtime_models import RouteResponseModel
from agent.agents.session_state import (
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)
from agent.interfaces.persistence import maybe_persist_route
from agent.interfaces.response_builder import agent_result_to_response
from agent.interfaces.schemas import PublicAPIRequest


def _point(pid: str, anime_id: str | None) -> PointState:
    return PointState(id=pid, name=pid, bangumi_id=anime_id)


def _route_result(
    intent: str,
    route_rows: list[PointState],
    source: SearchPayloadState | None,
) -> AgentResult:
    state = SessionState()
    source_ref = ResultRef("search:test")
    if source is not None:
        state.store_search_result(source_ref, source)
    state.store_route(
        RouteRef("route:test"),
        RoutePayloadState(
            ordered_points=route_rows,
            source_ref=source_ref if source is not None else None,
        ),
    )
    return AgentResult(
        output=RouteResponseModel(message="Route ready."),
        intent=intent,
        session_state=state,
        provenance=TurnProvenance(
            route=ProducedRoute(status="ok", route_ref=RouteRef("route:test"))
        ),
    )


@pytest.mark.parametrize(
    ("intent", "source", "route_rows", "expected"),
    [
        (
            "plan_route",
            SearchPayloadState(kind="bangumi", anime_id="1"),
            [_point("p1", "1")],
            ["1"],
        ),
        ("plan_selected", None, [_point("p1", "2")], ["2"]),
        (
            "plan_multi",
            SearchPayloadState(
                kind="multi",
                anime_ids=["1", "2", "3"],
                omitted_work_ids=["2"],
            ),
            [_point("p1", "1"), _point("p3", "3")],
            ["1", "3"],
        ),
        (
            "plan_route",
            SearchPayloadState(
                kind="nearby",
                rows=[_point("p1", "3"), _point("p2", "4"), _point("p3", "3")],
                row_count=3,
            ),
            [_point("p1", "3"), _point("p2", "4")],
            ["3", "4"],
        ),
        (
            "plan_route",
            SearchPayloadState(kind="nearby", rows=[_point("p1", None)], row_count=1),
            [_point("p1", None)],
            [],
        ),
    ],
)
async def test_route_intents_derive_associations_from_typed_state(
    intent: str,
    source: SearchPayloadState | None,
    route_rows: list[PointState],
    expected: list[str],
) -> None:
    result = _route_result(intent, route_rows, source)
    response = agent_result_to_response(result, include_debug=False)
    db = MagicMock()
    db.routes.save_route = AsyncMock(return_value="route-id")
    record = await maybe_persist_route(
        db=db,
        session_id="session-id",
        request=PublicAPIRequest(text="route these"),
        result=result,
        response=response,
    )
    assert record is not None
    assert record["anime_ids"] == expected
    assert db.routes.save_route.await_args.args[1] == expected


async def test_route_persistence_filters_missing_anime_foreign_keys() -> None:
    result = _route_result(
        "plan_multi",
        [_point("p1", "1"), _point("p2", "missing")],
        SearchPayloadState(kind="multi", anime_ids=["1", "missing"]),
    )
    response = agent_result_to_response(result, include_debug=False)
    db = MagicMock()
    db.bangumi.filter_existing_ids = AsyncMock(return_value=["1"])
    db.routes.save_route = AsyncMock(return_value="route-id")
    record = await maybe_persist_route(
        db=db,
        session_id="session-id",
        request=PublicAPIRequest(text="route these"),
        result=result,
        response=response,
    )
    assert record is not None
    assert record["anime_ids"] == ["1"]
    assert db.routes.save_route.await_args.args[1] == ["1"]


async def test_route_persistence_swallows_foreign_key_violation() -> None:
    result = _route_result("plan_selected", [_point("p1", "missing")], source=None)
    response = agent_result_to_response(result, include_debug=False)
    db = MagicMock()
    db.bangumi.filter_existing_ids = AsyncMock(return_value=[])
    db.routes.save_route = AsyncMock(
        side_effect=asyncpg.ForeignKeyViolationError("missing bangumi")
    )
    record = await maybe_persist_route(
        db=db,
        session_id="session-id",
        request=PublicAPIRequest(text="route this"),
        result=result,
        response=response,
    )
    assert record is None


def test_route_anime_migration_backfills_then_removes_single_source() -> None:
    migration = (
        Path(__file__).resolve().parents[5]
        / "supabase/migrations/20260716120000_route_anime.sql"
    ).read_text()
    assert "CREATE TABLE IF NOT EXISTS route_anime" in migration
    assert "PRIMARY KEY (route_id, bangumi_id)" in migration
    assert "SELECT id, bangumi_id, 0" in migration
    assert (
        "GRANT SELECT, INSERT, UPDATE, DELETE ON route_anime TO agent_svc" in migration
    )
    assert "ALTER TABLE route_anime ENABLE ROW LEVEL SECURITY" in migration
    assert "REVOKE ALL ON TABLE route_anime FROM anon, authenticated" in migration
    assert "FOR ALL TO agent_svc USING (true) WITH CHECK (true)" in migration
    assert "ALTER TABLE routes DROP COLUMN IF EXISTS bangumi_id" in migration
    assert migration.index("INSERT INTO route_anime") < migration.index(
        "ALTER TABLE routes DROP COLUMN IF EXISTS bangumi_id"
    )
