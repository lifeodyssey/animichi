"""Deterministic multi/place selection and terminal-matrix pins."""

from __future__ import annotations

from typing import Literal

from agent.agents.selection import execute_multi_selection, execute_place_selection
from agent.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)
from agent.clients.catalog_client import PilgrimagePoint, Route, SearchResult
from agent.clients.catalog_errors import (
    RouteTooManyClustersData,
    RouteTooManyClustersError,
)
from agent.interfaces.response_builder import agent_result_to_response
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _point(pid: str, work: str) -> PilgrimagePoint:
    return PilgrimagePoint(
        id=pid,
        name=pid,
        bangumi_id=work,
        latitude=35.0,
        longitude=135.0,
        title=work,
    )


def _pending(reason: str = "anime_ambiguity") -> SessionState:
    candidates = [
        OrderedCandidate(id="1", title="One", lat=35.0, lng=135.0),
        OrderedCandidate(id="2", title="Two", lat=36.0, lng=136.0),
    ]
    return SessionState(
        pending_clarification=PendingClarification(
            reason=reason,
            candidate_ids=["1", "2"],
            ordered_candidates=candidates,
            revision=4,
        ),
        clarification_revision=4,
    )


class _Catalog(MockCatalogClient):
    def __init__(self, results: dict[str, SearchResult | BaseException]) -> None:
        super().__init__()
        self.results = results
        self.route_error: bool | BaseException = False
        self.nearby_rows: list[PilgrimagePoint] | None = None
        self.nearby_error = False

    async def points_by_work_id(self, work_id: str) -> SearchResult:
        self.calls.append(("points_by_work_id", (work_id,)))
        result = self.results[work_id]
        if isinstance(result, BaseException):
            raise result
        return result

    async def route(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Route:
        self.calls.append(("route", (tuple(point_ids), origin, pacing)))
        if isinstance(self.route_error, BaseException):
            raise self.route_error
        if self.route_error:
            raise RouteTooManyClustersError(
                RouteTooManyClustersData(cluster_count=51, max_clusters=50)
            )
        points = {
            point.id: point
            for result in self.results.values()
            if isinstance(result, SearchResult)
            for point in result.rows
        }
        ordered = [points[item] for item in point_ids]
        return Route(ordered_points=ordered, point_count=len(ordered))

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        self.calls.append(("nearby", (lat, lng, radius_m)))
        if self.nearby_error:
            raise OSError("down")
        if self.nearby_rows is not None:
            return self.nearby_rows
        return await super().nearby(lat, lng, radius_m=radius_m)


async def test_multi_selection_merges_in_selection_order_and_dedupes() -> None:
    catalog = _Catalog(
        {
            "1": SearchResult(rows=[_point("a", "1"), _point("shared", "1")]),
            "2": SearchResult(rows=[_point("shared", "2"), _point("b", "2")]),
        }
    )
    result = await execute_multi_selection(
        candidate_ids=["2", "1"], state=_pending(), locale="en", catalog=catalog
    )
    payload = result.session_state.search_results[result.session_state.last_result_ref]
    assert [point.id for point in payload.rows] == ["shared", "b", "a"]
    assert result.intent == "plan_multi"
    assert result.success is True
    assert result.session_state.pending_clarification is None


async def test_all_empty_is_t4_and_preserves_pending() -> None:
    catalog = _Catalog({"1": SearchResult(), "2": SearchResult()})
    state = _pending()
    result = await execute_multi_selection(
        candidate_ids=["1", "2"], state=state, locale="en", catalog=catalog
    )
    assert (result.status, result.success) == ("empty", False)
    assert state.pending_clarification is not None
    assert not state.routes


async def test_t4_does_not_project_a_route_from_a_prior_turn() -> None:
    catalog = _Catalog({"1": SearchResult(), "2": SearchResult()})
    state = _pending()
    prior_result_ref = ResultRef("search:prior:1")
    state.store_search_result(
        prior_result_ref,
        SearchPayloadState(
            kind="bangumi",
            rows=[PointState(id="old-point", bangumi_id="old-anime")],
            row_count=1,
            anime_id="old-anime",
        ),
    )
    state.store_route(
        RouteRef("route:prior:1"),
        RoutePayloadState(
            ordered_points=[PointState(id="old-point", bangumi_id="old-anime")],
            source_ref=prior_result_ref,
        ),
    )

    result = await execute_multi_selection(
        candidate_ids=["1", "2"], state=state, locale="en", catalog=catalog
    )
    response = agent_result_to_response(result, include_debug=False)

    assert response.status == "empty"
    assert set(response.data) == {"results"}
    assert response.data["results"]["rows"] == []
    assert state.pending_clarification is not None


async def test_all_failed_is_t5_without_registry_write() -> None:
    catalog = _Catalog({"1": OSError("down"), "2": OSError("down")})
    result = await execute_multi_selection(
        candidate_ids=["1", "2"], state=_pending(), locale="en", catalog=catalog
    )
    assert (result.status, result.success) == ("error", False)
    assert not result.session_state.search_results


async def test_501_points_is_t6_without_route_call() -> None:
    points = [_point(str(index), "1") for index in range(501)]
    catalog = _Catalog({"1": SearchResult(rows=points)})
    result = await execute_multi_selection(
        candidate_ids=["1"], state=_pending(), locale="en", catalog=catalog
    )
    assert result.status == "too_large"
    assert all(call[0] != "route" for call in catalog.calls)


async def test_place_selection_uses_staged_coords_without_geocode() -> None:
    catalog = _Catalog({})
    result = await execute_place_selection(
        candidate_id="1",
        state=_pending("place_ambiguity"),
        locale="en",
        catalog=catalog,
    )
    assert result.intent == "search_nearby"
    assert all(call[0] != "geocode" for call in catalog.calls)
    assert result.session_state.pending_clarification is None


async def test_place_selection_preserves_staged_effective_radius() -> None:
    catalog = _Catalog({})
    state = _pending("place_ambiguity")
    state.pending_clarification.ordered_candidates[0].effective_radius_m = 10_000

    await execute_place_selection(
        candidate_id="1", state=state, locale="en", catalog=catalog
    )

    assert ("nearby", (35.0, 135.0, 10_000)) in catalog.calls


async def test_place_empty_is_definitive_and_clears_pending() -> None:
    catalog = _Catalog({})
    catalog.nearby_rows = []
    state = _pending("place_ambiguity")
    result = await execute_place_selection(
        candidate_id="1", state=state, locale="en", catalog=catalog
    )
    assert (result.success, result.message) == (
        True,
        "No pilgrimage spots were found near that place.",
    )
    assert state.pending_clarification is None


async def test_place_failure_is_typed_and_preserves_pending() -> None:
    catalog = _Catalog({})
    catalog.nearby_error = True
    state = _pending("place_ambiguity")
    result = await execute_place_selection(
        candidate_id="1", state=state, locale="en", catalog=catalog
    )
    assert (result.status, result.success) == ("error", False)
    assert state.pending_clarification is not None
