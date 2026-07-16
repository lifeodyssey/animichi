"""Tests for the additive typed session-state registry."""

from __future__ import annotations

import pytest
from pydantic import BaseModel, ValidationError

from agent.agents.session_state import (
    MAX_REFS,
    CurrentAnime,
    GeocodeStaging,
    NearbyGroupState,
    OrderedCandidate,
    PendingClarification,
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    RouteStaleRef,
    RouteSummaryState,
    SearchMetadataState,
    SearchPayloadState,
    SessionState,
)


def _search_payload(index: int = 0) -> SearchPayloadState:
    return SearchPayloadState(
        kind="bangumi",
        rows=[
            {
                "id": f"point-{index}",
                "name": "宇治橋",
                "latitude": 34.889,
                "longitude": 135.807,
            }
        ],
        row_count=1,
        anime_id="115908",
    )


def _route_payload(source_ref: ResultRef) -> RoutePayloadState:
    return RoutePayloadState(
        ordered_points=[],
        source_ref=source_ref,
    )


def test_session_state_round_trips_every_component() -> None:
    candidate = OrderedCandidate(id="115908", title="響け！ユーフォニアム")
    state = SessionState(
        current_anime=CurrentAnime(bangumi_id="115908", title=candidate.title),
        pending_clarification=PendingClarification(
            reason="anime_ambiguity",
            candidate_ids=[candidate.id],
            ordered_candidates=[candidate],
            revision=3,
        ),
        geocode_staging=GeocodeStaging(candidates=[candidate]),
        clarification_revision=3,
    )
    result_ref = ResultRef("bangumi:3:1")
    route_ref = RouteRef("route:3:1")
    state.store_search_result(result_ref, _search_payload())
    state.store_route(route_ref, _route_payload(result_ref))

    restored = SessionState.model_validate(state.model_dump(mode="json"))

    assert restored == state
    assert restored.last_result_ref == result_ref
    assert isinstance(restored.search_results[result_ref], SearchPayloadState)
    assert isinstance(restored.routes[route_ref], RoutePayloadState)


@pytest.mark.parametrize(
    ("model_type", "payload"),
    [
        (CurrentAnime, {"bangumi_id": "1", "title": "Anime"}),
        (PointState, {}),
        (SearchMetadataState, {}),
        (NearbyGroupState, {"bangumi_id": "1", "title": "Anime"}),
        (
            RouteSummaryState,
            {
                "point_count": 1,
                "total_minutes": 10,
                "total_distance_m": 100.0,
                "clusters": 1,
                "with_coordinates": 1,
                "without_coordinates": 0,
            },
        ),
        (SearchPayloadState, {"kind": "bangumi"}),
        (RoutePayloadState, {}),
        (OrderedCandidate, {"id": "1", "title": "Anime"}),
        (
            PendingClarification,
            {"reason": "anime_not_found", "revision": 1},
        ),
        (GeocodeStaging, {}),
        (SessionState, {}),
        (RouteStaleRef, {"status": "stale_ref"}),
    ],
)
def test_session_models_forbid_unknown_fields(
    model_type: type[BaseModel], payload: dict[str, object]
) -> None:
    with pytest.raises(ValidationError, match="unknown"):
        model_type.model_validate({**payload, "unknown": True})


def test_search_registry_evicts_least_recently_used_ref() -> None:
    state = SessionState()
    refs = [ResultRef(f"bangumi:0:{index}") for index in range(MAX_REFS)]
    for index, ref in enumerate(refs):
        state.store_search_result(ref, _search_payload(index))
    assert isinstance(state.get_search_result(refs[0]), SearchPayloadState)

    newest = ResultRef("bangumi:0:newest")
    state.store_search_result(newest, _search_payload(MAX_REFS))

    assert refs[0] in state.search_results
    assert refs[1] not in state.search_results
    assert len(state.search_results) == MAX_REFS
    assert state.last_result_ref == newest


def test_evicted_search_ref_returns_typed_stale_outcome() -> None:
    state = SessionState()
    refs = [ResultRef(f"nearby:0:{index}") for index in range(MAX_REFS + 1)]
    for index, ref in enumerate(refs):
        state.store_search_result(ref, _search_payload(index))

    outcome = state.get_search_result(refs[0])

    assert isinstance(outcome, RouteStaleRef)
    assert outcome.status == "stale_ref"


def test_route_registry_evicts_least_recently_used_ref() -> None:
    state = SessionState()
    source_ref = ResultRef("bangumi:0:source")
    refs = [RouteRef(f"route:0:{index}") for index in range(MAX_REFS)]
    for ref in refs:
        state.store_route(ref, _route_payload(source_ref))
    assert state.get_route(refs[0]) is not None

    newest = RouteRef("route:0:newest")
    state.store_route(newest, _route_payload(source_ref))

    assert refs[0] in state.routes
    assert refs[1] not in state.routes
    assert len(state.routes) == MAX_REFS


def test_restore_trims_oversized_registries_to_last_max_refs() -> None:
    refs = [ResultRef(f"bangumi:0:{index}") for index in range(MAX_REFS + 2)]
    state = SessionState.model_validate(
        {
            "search_results": {
                ref: _search_payload(index) for index, ref in enumerate(refs)
            }
        }
    )

    assert list(state.search_results) == refs[-MAX_REFS:]
