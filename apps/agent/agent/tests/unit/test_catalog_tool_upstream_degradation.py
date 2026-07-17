"""Catalog tool failures degrade to typed, current-turn outcomes."""

from __future__ import annotations

from typing import Literal
from unittest.mock import MagicMock

import pytest
from pydantic_ai import ModelRetry

from agent.agents.agent_result import RejectedRoute, RejectedSearch
from agent.agents.animichi_agent import validate_output
from agent.agents.animichi_runner import runtime_stage
from agent.agents.catalog_route_tools import run_route
from agent.agents.catalog_tools import run_nearby_search
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import (
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.agents.session_state import (
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
)
from agent.agents.tool_outcomes import NearbyUpstreamDown, RouteUpstreamDown
from agent.clients.catalog_client import GeocodeCandidate, PilgrimagePoint, Route
from agent.clients.errors import APIError
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps(catalog: MockCatalogClient) -> RuntimeDeps:
    return RuntimeDeps(MagicMock(), "en", "test", catalog)


class _GeocodeDownCatalog(MockCatalogClient):
    async def geocode(self, query: str, *, limit: int = 5) -> list[GeocodeCandidate]:
        raise APIError("catalog down")


class _NearbyDownCatalog(MockCatalogClient):
    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        raise APIError("catalog down")


class _RouteDownCatalog(MockCatalogClient):
    async def route(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Route:
        raise APIError("catalog down")


async def test_geocode_api_error_becomes_nearby_upstream_down() -> None:
    catalog = _GeocodeDownCatalog()
    deps = _deps(catalog)
    prior_ref = ResultRef("search:prior")
    deps.tool_state.session.store_search_result(
        prior_ref,
        SearchPayloadState(kind="nearby", rows=[PointState(id="old")], row_count=1),
    )

    outcome = await run_nearby_search(MagicMock(deps=deps), catalog, "Uji", None)

    assert isinstance(outcome, NearbyUpstreamDown)
    assert deps.steps[-1].data == {"outcome": "upstream_unavailable"}
    assert isinstance(deps.steps[-1].provenance, RejectedSearch)
    with pytest.raises(ModelRetry):
        await validate_output(
            MagicMock(deps=deps), SearchResponseModel(message="stale")
        )
    assert runtime_stage(QAResponseModel(message="retry"), deps.steps) == "general_qa"


async def test_nearby_api_error_becomes_nearby_upstream_down() -> None:
    catalog = _NearbyDownCatalog()
    deps = _deps(catalog)
    deps.tool_state.origin_lat = 34.9
    deps.tool_state.origin_lng = 135.8

    outcome = await run_nearby_search(MagicMock(deps=deps), catalog, None, None)

    assert isinstance(outcome, NearbyUpstreamDown)
    assert deps.steps[-1].data == {"outcome": "upstream_unavailable"}
    assert isinstance(deps.steps[-1].provenance, RejectedSearch)


async def test_route_api_error_becomes_route_upstream_down() -> None:
    catalog = _RouteDownCatalog()
    deps = _deps(catalog)
    ref = ResultRef("search:test")
    deps.tool_state.session.store_search_result(
        ref,
        SearchPayloadState(kind="nearby", rows=[PointState(id="p1")], row_count=1),
    )
    deps.tool_state.session.store_route(RouteRef("route:prior"), RoutePayloadState())

    outcome = await run_route(MagicMock(deps=deps), catalog, str(ref), None)

    assert isinstance(outcome, RouteUpstreamDown)
    assert deps.steps[-1].data == {"status": "upstream_unavailable"}
    assert isinstance(deps.steps[-1].provenance, RejectedRoute)
    with pytest.raises(ModelRetry):
        await validate_output(MagicMock(deps=deps), RouteResponseModel(message="stale"))
