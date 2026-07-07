"""Unit tests for the selected-points catalog route bypass."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest

from agent.agents.agent_result import AgentResult
from agent.agents.catalog_adapter import build_search_payload
from agent.agents.selected_route import execute_selected_route
from agent.clients.catalog_client import PilgrimagePoint, Route
from agent.clients.errors import APIError
from agent.tests.eval.mock_catalog_client import FIXTURE_POINTS, MockCatalogClient

_POINT_FIELDS = {
    "id",
    "name",
    "name_cn",
    "episode",
    "time_seconds",
    "screenshot_url",
    "bangumi_id",
    "latitude",
    "longitude",
    "title",
    "title_cn",
    "distance_m",
    "origin",
    "cover_url",
}


def _payload(result: AgentResult) -> dict[str, object]:
    return cast(dict[str, object], result.tool_state["plan_selected"])


def _ordered_rows(result: AgentResult) -> list[dict[str, object]]:
    rows = _payload(result)["ordered_points"]
    assert isinstance(rows, list)
    return [cast(dict[str, object], row) for row in rows]


def _euphonium_points() -> list[PilgrimagePoint]:
    return [point.model_copy(deep=True) for point in FIXTURE_POINTS["100403"]]


async def test_selected_route_rows_keep_catalog_point_fields() -> None:
    catalog = MockCatalogClient()
    result = await execute_selected_route(
        point_ids=["p_euph_1", "p_euph_2"],
        origin="34.8915,135.8075",
        locale="en",
        catalog=catalog,
    )

    rows = _ordered_rows(result)
    assert set(rows[0]) == _POINT_FIELDS
    assert rows[0] == _euphonium_points()[0].model_dump(mode="json")
    assert catalog.calls == [("route", (("p_euph_1", "p_euph_2"), (34.8915, 135.8075)))]


async def test_selected_route_rows_match_search_payload_rows() -> None:
    catalog = MockCatalogClient()
    result = await execute_selected_route(
        point_ids=["p_euph_1", "p_euph_2"],
        origin=None,
        locale="ja",
        catalog=catalog,
    )
    search = build_search_payload(_euphonium_points(), tool="search_bangumi")

    search_rows = cast(list[dict[str, object]], search["rows"])
    assert _ordered_rows(result) == search_rows


async def test_selected_route_empty_point_ids_returns_error() -> None:
    result = await execute_selected_route(
        point_ids=[],
        origin=None,
        locale="en",
        catalog=MockCatalogClient(),
    )

    assert result.success is False
    assert result.steps[0].error == "point_ids is required"


class _FailingCatalog(MockCatalogClient):
    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route:
        raise APIError("catalog down")


async def test_selected_route_catalog_api_error_returns_error() -> None:
    result = await execute_selected_route(
        point_ids=["p_euph_1"],
        origin=None,
        locale="en",
        catalog=_FailingCatalog(),
    )

    assert result.success is False
    assert result.steps[0].error == "Catalog route unavailable"


async def test_selected_route_emits_running_and_done_steps() -> None:
    events: list[tuple[str, str]] = []

    async def _record(tool: str, status: str, _d: object, _a: str, _b: str) -> None:
        events.append((tool, status))

    await execute_selected_route(
        point_ids=["p_euph_1"],
        origin=None,
        locale="en",
        catalog=MockCatalogClient(),
        on_step=_record,
    )

    assert events == [("plan_selected", "running"), ("plan_selected", "done")]


@pytest.mark.parametrize("origin", ["not-a-coord", "1,2,3", "999,0", "0,999"])
async def test_selected_route_malformed_origin_routes_without_origin(
    origin: str,
) -> None:
    catalog = MockCatalogClient()
    await execute_selected_route(
        point_ids=["p_euph_1"],
        origin=origin,
        locale="en",
        catalog=catalog,
    )

    assert catalog.calls == [("route", (("p_euph_1",), None))]


def _agent_source_files() -> list[Path]:
    root = Path(__file__).parents[2]
    return [path for path in root.rglob("*.py") if "tests" not in path.parts]


def _import_lines(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [line for line in lines if line.lstrip().startswith(("import ", "from "))]


def test_route_optimizer_is_retired_from_agent_imports() -> None:
    refs = [
        (str(path), line)
        for path in _agent_source_files()
        for line in _import_lines(path)
        if "route_optimizer" in line
    ]
    route_optimizer = Path(__file__).parents[2] / "agents" / "route_optimizer.py"
    assert refs == []
    assert route_optimizer.exists() is False
