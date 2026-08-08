"""Unit tests for the selected-points catalog route bypass."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest

from animichi.agents.agent_result import AgentResult
from animichi.agents.catalog_adapter import build_search_payload
from animichi.agents.runtime_deps import OnStep, StepEvent
from animichi.agents.selected_route import execute_selected_route
from animichi.agents.session_state import ResultRef, SearchPayloadState, SessionState
from animichi.clients.catalog_client import Itinerary, Point
from animichi.clients.errors import APIError
from animichi.tests.eval.mock_catalog_client import FIXTURE_POINTS, MockCatalogClient

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
    "city",
}


def _ordered_rows(result: AgentResult) -> list[dict[str, object]]:
    state = result.session_state
    ref = state.route_lru[-1]
    return [row.model_dump(mode="json") for row in state.routes[ref].ordered_points]


def _euphonium_points() -> list[Point]:
    return [point.model_copy(deep=True) for point in FIXTURE_POINTS["115908"]]


def _spy_events() -> tuple[list[tuple[str, str]], OnStep]:
    events: list[tuple[str, str]] = []

    async def _record(event: StepEvent) -> None:
        events.append((event.tool, event.status))

    return events, _record


async def _run_empty_route(on_step: OnStep | None) -> AgentResult:
    return await execute_selected_route(
        point_ids=["ghost"],
        state=SessionState(),
        origin=None,
        locale="en",
        catalog=MockCatalogClient(),
        on_step=on_step,
    )


async def test_selected_route_rows_keep_catalog_point_fields() -> None:
    catalog = MockCatalogClient()
    result = await execute_selected_route(
        point_ids=["p004", "p005"],
        state=SessionState(),
        origin="34.8915,135.8075",
        locale="en",
        catalog=catalog,
    )

    rows = _ordered_rows(result)
    assert set(rows[0]) == _POINT_FIELDS
    assert rows[0] == _euphonium_points()[0].model_dump(mode="json")
    assert result.message == "Created a route with 2 selected stops."
    assert result.steps[0].model_initiated is False
    assert catalog.calls == [
        ("plan_itinerary", (("p004", "p005"), (34.8915, 135.8075), None))
    ]


async def test_selected_route_rows_match_search_payload_rows() -> None:
    catalog = MockCatalogClient()
    result = await execute_selected_route(
        point_ids=["p004", "p005", "p006"],
        state=SessionState(),
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
        state=SessionState(),
        origin=None,
        locale="en",
        catalog=MockCatalogClient(),
    )

    assert result.success is False
    assert result.steps[0].error == "point_ids is required"


class _FailingCatalog(MockCatalogClient):
    async def plan_itinerary(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Itinerary:
        raise APIError("catalog down")


async def test_selected_route_catalog_api_error_returns_error() -> None:
    result = await execute_selected_route(
        point_ids=["p004"],
        state=SessionState(),
        origin=None,
        locale="en",
        catalog=_FailingCatalog(),
    )

    assert result.success is False
    assert result.steps[0].error == "Catalog route unavailable"


async def test_selected_route_emits_running_and_done_steps() -> None:
    events: list[tuple[str, str]] = []

    async def _record(event: StepEvent) -> None:
        events.append((event.tool, event.status))

    await execute_selected_route(
        point_ids=["p004"],
        state=SessionState(),
        origin=None,
        locale="en",
        catalog=MockCatalogClient(),
        on_step=_record,
    )

    assert events == [("plan_selected", "running"), ("plan_selected", "done")]


async def test_selected_route_empty_route_returns_error() -> None:
    result = await _run_empty_route(on_step=None)

    assert result.success is False
    assert result.status == "error"
    assert result.steps[0].is_success is False
    assert result.steps[0].error == "No catalog route data"


async def test_selected_route_empty_route_emits_error_step() -> None:
    events, on_step = _spy_events()
    await _run_empty_route(on_step=on_step)

    assert events == [("plan_selected", "running"), ("plan_selected", "error")]


@pytest.mark.parametrize("origin", ["not-a-coord", "1,2,3", "999,0", "0,999"])
async def test_selected_route_malformed_origin_routes_without_origin(
    origin: str,
) -> None:
    catalog = MockCatalogClient()
    await execute_selected_route(
        point_ids=["p004"],
        state=SessionState(),
        origin=origin,
        locale="en",
        catalog=catalog,
    )

    assert catalog.calls == [("plan_itinerary", (("p004",), None, None))]


async def test_selected_route_preserves_hydrated_search_state() -> None:
    state = SessionState()
    source_ref = ResultRef("search:prior:1")
    state.store_search_result(
        source_ref,
        SearchPayloadState(
            kind="bangumi",
            rows=[point.model_dump(mode="json") for point in _euphonium_points()],
            row_count=3,
            anime_id="115908",
        ),
    )
    result = await execute_selected_route(
        point_ids=["p004", "p005"],
        state=state,
        origin=None,
        locale="en",
        catalog=MockCatalogClient(),
    )
    route = state.routes[state.route_lru[-1]]
    assert result.session_state.search_results[source_ref].row_count == 3
    assert route.source_ref is None


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
