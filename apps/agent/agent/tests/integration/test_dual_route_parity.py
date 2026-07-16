"""Integration parity between selected-route and chat-path catalog routing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from pydantic_ai import RunContext

from agent.agents.catalog_adapter import build_search_state
from agent.agents.catalog_tools import run_route
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.selected_route import execute_selected_route
from agent.agents.session_state import ResultRef, SessionState
from agent.domain.ports import DatabasePort
from agent.tests.eval.mock_catalog_client import MockCatalogClient


@dataclass
class _Ctx:
    deps: RuntimeDeps


def _ctx(deps: RuntimeDeps) -> RunContext[RuntimeDeps]:
    return cast(RunContext[RuntimeDeps], _Ctx(deps))


def _deps(catalog: MockCatalogClient) -> RuntimeDeps:
    return RuntimeDeps(
        db=cast(DatabasePort, object()),
        locale="ja",
        query="route",
        catalog=catalog,
    )


def _route_ids(deps: RuntimeDeps) -> list[str]:
    ref = deps.tool_state.session.route_lru[-1]
    return [
        point.id or "" for point in deps.tool_state.session.routes[ref].ordered_points
    ]


async def test_selected_route_and_chat_route_use_same_catalog_order() -> None:
    catalog = MockCatalogClient()
    points = await catalog.search("響け")
    point_ids = [point.id for point in points]

    selected = await execute_selected_route(
        point_ids=point_ids,
        state=SessionState(),
        origin=None,
        locale="ja",
        catalog=catalog,
    )

    deps = _deps(catalog)
    result_ref = ResultRef("search:test")
    deps.tool_state.session.store_search_result(
        result_ref,
        build_search_state(points, kind="bangumi", anime_id="115908"),
    )
    await run_route(_ctx(deps), catalog, str(result_ref))

    selected_ref = selected.session_state.route_lru[-1]
    selected_ids = [
        point.id or ""
        for point in selected.session_state.routes[selected_ref].ordered_points
    ]
    assert selected_ids == _route_ids(deps)
