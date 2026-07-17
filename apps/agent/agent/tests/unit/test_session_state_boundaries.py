"""Persistence-boundary tests for typed session-state snapshots."""

from __future__ import annotations

from typing import cast

import pytest
from pydantic import ValidationError

from agent.agents.session_state import (
    MAX_REFS,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)


def _search_payload() -> SearchPayloadState:
    return SearchPayloadState(kind="bangumi")


def _route_payload() -> RoutePayloadState:
    return RoutePayloadState()


def test_search_lru_survives_jsonb_registry_key_reordering() -> None:
    refs = [ResultRef(value) for value in ("z", "a", "b", "c", "d", "e", "f", "g")]
    assert len(refs) == MAX_REFS
    state = SessionState()
    for ref in refs:
        state.store_search_result(ref, _search_payload())
    serialized = state.model_dump(mode="json")
    registry = cast(dict[str, object], serialized["search_results"])
    serialized["search_results"] = {key: registry[key] for key in sorted(registry)}

    restored = SessionState.model_validate(serialized)
    restored.store_search_result(ResultRef("new"), _search_payload())

    assert refs[0] not in restored.search_results
    assert refs[1] in restored.search_results


def test_route_lru_survives_jsonb_registry_key_reordering() -> None:
    refs = [RouteRef(value) for value in ("z", "a", "b", "c", "d", "e", "f", "g")]
    state = SessionState()
    for ref in refs:
        state.store_route(ref, _route_payload())
    serialized = state.model_dump(mode="json")
    registry = cast(dict[str, object], serialized["routes"])
    serialized["routes"] = {key: registry[key] for key in sorted(registry)}

    restored = SessionState.model_validate(serialized)
    restored.store_route(RouteRef("new"), _route_payload())

    assert refs[0] not in restored.routes
    assert refs[1] in restored.routes


@pytest.mark.parametrize(
    "itinerary",
    [
        {"unknown": True},
        {
            "stops": [
                {
                    "cluster_id": "c1",
                    "name": "Uji Bridge",
                    "arrive": "09:00",
                    "depart": "09:10",
                    "dwell_minutes": 10,
                    "lat": 34.889,
                    "lng": 135.807,
                    "photo_count": 1,
                    "unknown": True,
                }
            ]
        },
        {
            "legs": [
                {
                    "from_id": "c1",
                    "to_id": "c2",
                    "mode": "walk",
                    "duration_minutes": 5,
                    "distance_m": 300.0,
                    "unknown": True,
                }
            ]
        },
    ],
)
def test_route_snapshot_recursively_rejects_unknown_fields(itinerary: object) -> None:
    snapshot = {"routes": {"route:0:1": {"timed_itinerary": itinerary}}}

    with pytest.raises(ValidationError, match="unknown"):
        SessionState.model_validate(snapshot)
