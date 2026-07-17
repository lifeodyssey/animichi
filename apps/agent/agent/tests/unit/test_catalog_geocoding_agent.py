"""Atomic pending-state transitions for catalog tool outcomes."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic_ai import RunContext

from agent.agents.agent_result import RejectedRoute, RejectedSearch
from agent.agents.catalog_route_tools import run_route
from agent.agents.catalog_tools import run_nearby_search, run_resolve
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import (
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from agent.clients.catalog_client import (
    AnimeCandidate,
    GeocodeCandidate,
    GeocodeKind,
    ResolveAmbiguous,
    ResolveNotFound,
)
from agent.clients.geocode import GeocodeSource
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.tool_event_helpers import project_tool_result, tool_context


def _deps() -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(), locale="en", query="test", catalog=MockCatalogClient()
    )


def _ctx(deps: RuntimeDeps) -> RunContext[RuntimeDeps]:
    return tool_context(deps)


def _place(identifier: str, kind: GeocodeKind) -> GeocodeCandidate:
    return GeocodeCandidate(
        id=identifier,
        label=identifier,
        name=identifier,
        lat=35.0,
        lng=139.0,
        kind=kind,
        source=GeocodeSource.MANUAL,
    )


class _Catalog(MockCatalogClient):
    def __init__(self, geocodes: list[GeocodeCandidate] | None = None) -> None:
        super().__init__()
        self.geocodes = geocodes or []

    async def geocode(self, query: str, *, limit: int = 5) -> list[GeocodeCandidate]:
        self.calls.append(("geocode", (query, limit)))
        return self.geocodes


@pytest.mark.parametrize(
    ("outcome", "reason"),
    [
        (
            ResolveNotFound(outcome="not_found", reason="anime_not_found"),
            "anime_not_found",
        ),
    ],
)
async def test_resolve_no_candidate_outcomes_write_pending(
    outcome: ResolveNotFound, reason: str
) -> None:
    deps = _deps()
    catalog = MagicMock()
    catalog.resolve = AsyncMock(return_value=outcome)
    await run_resolve(_ctx(deps), catalog, "missing")
    pending = deps.tool_state.session.pending_clarification
    assert pending is not None
    assert (pending.reason, pending.candidate_ids) == (reason, [])


async def test_resolve_ambiguity_writes_ordered_candidates_atomically() -> None:
    deps = _deps()
    catalog = MagicMock()
    catalog.resolve = AsyncMock(
        return_value=ResolveAmbiguous(
            outcome="needs_disambiguation",
            reason="anime_ambiguity",
            candidates=[
                AnimeCandidate(bangumi_id="1", title="One"),
                AnimeCandidate(bangumi_id="2", title="Two"),
            ],
        )
    )
    await run_resolve(_ctx(deps), catalog, "series")
    pending = deps.tool_state.session.pending_clarification
    assert pending is not None
    assert pending.candidate_ids == ["1", "2"]
    assert [item.title for item in pending.ordered_candidates] == ["One", "Two"]


@pytest.mark.parametrize(
    ("location", "geocodes", "reason"),
    [
        (None, [], "missing_location"),
        ("unknown", [], "unknown_place"),
        ("Tokyo", [_place("tokyo", GeocodeKind.PREFECTURE)], "place_too_broad"),
    ],
)
async def test_nearby_free_text_outcomes_write_empty_candidate_pending(
    location: str | None, geocodes: list[GeocodeCandidate], reason: str
) -> None:
    deps = _deps()
    await run_nearby_search(_ctx(deps), _Catalog(geocodes), location, None)
    pending = deps.tool_state.session.pending_clarification
    assert pending is not None
    assert (pending.reason, pending.candidate_ids) == (reason, [])


async def test_geocode_step_is_server_initiated() -> None:
    deps = _deps()

    await run_nearby_search(_ctx(deps), _Catalog([]), "unknown", None)

    assert deps.steps[0].tool == "geocode"
    assert deps.steps[0].model_initiated is False


async def test_place_ambiguity_stages_coords_and_pending_in_same_outcome() -> None:
    deps = _deps()
    places = [_place("a", GeocodeKind.CITY), _place("b", GeocodeKind.STATION)]
    outcome = await run_nearby_search(_ctx(deps), _Catalog(places), "Fuchu", None)
    await project_tool_result(deps, "search_nearby", {"location": "Fuchu"}, outcome)
    pending = deps.tool_state.session.pending_clarification
    assert pending is not None
    assert pending.reason == "place_ambiguity"
    assert pending.candidate_ids == ["a", "b"]
    assert [(item.lat, item.lng) for item in pending.ordered_candidates] == [
        (35.0, 139.0),
        (35.0, 139.0),
    ]
    assert deps.tool_state.session.geocode_staging is None
    assert deps.steps[-1].success is True
    assert isinstance(deps.steps[-1].provenance, RejectedSearch)


async def test_route_never_uses_hidden_last_result_default() -> None:
    deps = _deps()
    deps.tool_state.session = SessionState()
    outcome = await run_route(_ctx(deps), MockCatalogClient(), "missing-ref", None)
    await project_tool_result(
        deps, "plan_route", {"search_result_ref": "missing-ref"}, outcome
    )
    assert outcome.status == "stale_ref"
    assert deps.steps[-1].success is True
    assert isinstance(deps.steps[-1].provenance, RejectedRoute)


async def test_empty_route_is_a_successful_typed_step() -> None:
    deps = _deps()
    ref = ResultRef("search:empty")
    deps.tool_state.session.store_search_result(
        ref, SearchPayloadState(kind="bangumi", rows=[], row_count=0)
    )

    outcome = await run_route(_ctx(deps), MockCatalogClient(), str(ref), None)
    await project_tool_result(
        deps, "plan_route", {"search_result_ref": str(ref)}, outcome
    )

    assert (outcome.status, deps.steps[-1].success) == ("empty", True)
    assert isinstance(deps.steps[-1].provenance, RejectedRoute)


async def test_partial_route_is_pending_sync_and_never_calls_catalog_route() -> None:
    deps = _deps()
    ref = ResultRef("search:preview")
    deps.tool_state.session.store_search_result(
        ref,
        SearchPayloadState(
            kind="bangumi",
            rows=[PointState(id="preview-p1")],
            row_count=1,
            partial=True,
        ),
    )
    catalog = MockCatalogClient()

    outcome = await run_route(_ctx(deps), catalog, str(ref), None)
    await project_tool_result(
        deps, "plan_route", {"search_result_ref": str(ref)}, outcome
    )

    assert outcome.status == "pending_sync"
    assert all(call[0] != "route" for call in catalog.calls)
    assert isinstance(deps.steps[-1].provenance, RejectedRoute)


async def test_route_threads_optional_pacing_to_catalog() -> None:
    deps = _deps()
    ref = ResultRef("search:test")
    deps.tool_state.session.store_search_result(
        ref,
        SearchPayloadState(kind="bangumi", rows=[PointState(id="p004")], row_count=1),
    )
    catalog = MockCatalogClient()
    outcome = await run_route(_ctx(deps), catalog, str(ref), "packed")
    assert outcome.status == "ok"
    assert ("route", (("p004",), None, "packed")) in catalog.calls
