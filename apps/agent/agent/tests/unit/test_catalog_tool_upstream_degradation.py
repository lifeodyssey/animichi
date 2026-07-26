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
    ClarifyResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
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
from agent.tests.tool_event_helpers import project_tool_result, tool_context


def _deps(catalog: MockCatalogClient) -> RuntimeDeps:
    return RuntimeDeps(MagicMock(), "en", "test", catalog)


def _seed_stale_clarification(deps: RuntimeDeps) -> ClarifyResponseModel:
    candidate_ids = ["old-1", "old-2"]
    deps.tool_state.session.pending_clarification = PendingClarification(
        reason="anime_ambiguity",
        candidate_ids=candidate_ids,
        ordered_candidates=[
            OrderedCandidate(id="old-1", title="Old 1"),
            OrderedCandidate(id="old-2", title="Old 2"),
        ],
        revision=1,
    )
    deps.tool_state.session.clarification_revision = 1
    return ClarifyResponseModel(
        reason="anime_ambiguity",
        message="Which old result?",
        candidate_ids=candidate_ids,
    )


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

    outcome = await run_nearby_search(tool_context(deps), catalog, "Uji", None)
    await project_tool_result(deps, "search_nearby", {"location": "Uji"}, outcome)

    assert isinstance(outcome, NearbyUpstreamDown)
    assert deps.steps[-1].data == {"outcome": "upstream_unavailable"}
    assert isinstance(deps.steps[-1].provenance, RejectedSearch)
    context = MagicMock(deps=deps)
    stale_response = SearchResponseModel(message="stale")
    with pytest.raises(ModelRetry):
        await validate_output(context, stale_response)
    assert runtime_stage(QAResponseModel(message="retry"), deps.steps) == "general_qa"


async def test_nearby_api_error_becomes_nearby_upstream_down() -> None:
    catalog = _NearbyDownCatalog()
    deps = _deps(catalog)
    stale_clarification = _seed_stale_clarification(deps)
    deps.tool_state.origin_lat = 34.9
    deps.tool_state.origin_lng = 135.8

    outcome = await run_nearby_search(tool_context(deps), catalog, None, None)
    await project_tool_result(deps, "search_nearby", {"location": None}, outcome)

    assert isinstance(outcome, NearbyUpstreamDown)
    assert deps.steps[-1].data == {"outcome": "upstream_unavailable"}
    assert isinstance(deps.steps[-1].provenance, RejectedSearch)
    assert deps.tool_state.session.pending_clarification is None
    context = MagicMock(deps=deps)
    with pytest.raises(ModelRetry):
        await validate_output(context, stale_clarification)


async def test_route_api_error_becomes_route_upstream_down() -> None:
    catalog = _RouteDownCatalog()
    deps = _deps(catalog)
    stale_clarification = _seed_stale_clarification(deps)
    ref = ResultRef("search:test")
    deps.tool_state.session.store_search_result(
        ref,
        SearchPayloadState(kind="nearby", rows=[PointState(id="p1")], row_count=1),
    )
    deps.tool_state.session.store_route(RouteRef("route:prior"), RoutePayloadState())

    outcome = await run_route(tool_context(deps), catalog, str(ref), None)
    await project_tool_result(
        deps, "plan_route", {"search_result_ref": str(ref)}, outcome
    )

    assert isinstance(outcome, RouteUpstreamDown)
    assert deps.steps[-1].data == {"status": "upstream_unavailable"}
    assert isinstance(deps.steps[-1].provenance, RejectedRoute)
    assert deps.tool_state.session.pending_clarification is None
    context = MagicMock(deps=deps)
    stale_route = RouteResponseModel(message="stale")
    with pytest.raises(ModelRetry):
        await validate_output(context, stale_route)
    with pytest.raises(ModelRetry):
        await validate_output(context, stale_clarification)
