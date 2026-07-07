"""Integration parity between selected-route and chat-path catalog routing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from pydantic_ai import RunContext

from agent.agents.catalog_adapter import build_search_payload
from agent.agents.catalog_tools import _run_catalog_route
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.selected_route import execute_selected_route
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


def _ordered_ids(payload: dict[str, object]) -> list[str]:
    rows = cast(list[dict[str, object]], payload["ordered_points"])
    return [str(row["id"]) for row in rows]


async def test_selected_route_and_chat_route_use_same_catalog_order() -> None:
    catalog = MockCatalogClient()
    point_ids = ["p_euph_1", "p_euph_2"]

    selected = await execute_selected_route(
        point_ids=point_ids,
        origin=None,
        locale="ja",
        catalog=catalog,
    )

    deps = _deps(catalog)
    points = await catalog.search("響け")
    deps.tool_state["search_bangumi"] = build_search_payload(
        points, tool="search_bangumi"
    )
    await _run_catalog_route(_ctx(deps), catalog, params={})

    chat_payload = cast(dict[str, object], deps.tool_state["plan_route"])
    selected_payload = cast(dict[str, object], selected.tool_state["plan_selected"])
    assert _ordered_ids(selected_payload) == _ordered_ids(chat_payload)
