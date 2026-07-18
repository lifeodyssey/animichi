"""Discriminated outcome pins for the four Phase 1c data tools."""

from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from agent.agents.tool_outcomes import (
    NearbyToolResult,
    ResolveResult,
    RouteToolResult,
    SearchToolResult,
)


@pytest.mark.parametrize(
    "payload",
    [
        {"outcome": "resolved", "bangumi_id": "1", "anime_title": "One"},
        {
            "outcome": "needs_disambiguation",
            "clarification_reason": "anime_ambiguity",
            "candidate_ids": ["1", "2"],
        },
        {"outcome": "not_found", "clarification_reason": "anime_not_found"},
        {"outcome": "upstream_unavailable"},
    ],
)
def test_resolve_result_partition(payload: dict[str, object]) -> None:
    assert (
        TypeAdapter(ResolveResult).validate_python(payload).outcome
        == payload["outcome"]
    )


def test_ambiguous_resolve_requires_two_candidates() -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(ResolveResult).validate_python(
            {
                "outcome": "needs_disambiguation",
                "clarification_reason": "anime_ambiguity",
                "candidate_ids": ["1"],
            }
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"outcome": "ok", "result_ref": "search:1", "row_count": 1},
        {"outcome": "empty"},
    ],
)
def test_search_result_partition(payload: dict[str, object]) -> None:
    assert (
        TypeAdapter(SearchToolResult).validate_python(payload).outcome
        == payload["outcome"]
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"outcome": "ok", "result_ref": "search:1", "row_count": 1},
        {"outcome": "empty"},
        {
            "outcome": "place_ambiguity",
            "clarification_reason": "place_ambiguity",
            "place_candidate_ids": ["a", "b"],
        },
        {
            "outcome": "place_unresolved",
            "clarification_reason": "unknown_place",
        },
        {
            "outcome": "missing_location",
            "clarification_reason": "missing_location",
        },
        {"outcome": "upstream_unavailable"},
    ],
)
def test_nearby_result_partition(payload: dict[str, object]) -> None:
    assert (
        TypeAdapter(NearbyToolResult).validate_python(payload).outcome
        == payload["outcome"]
    )


@pytest.mark.parametrize(
    "payload",
    [
        {
            "status": "ok",
            "route_ref": "route:1",
            "point_count": 2,
            "total_minutes": 30,
        },
        {"status": "empty"},
        {"status": "stale_ref"},
        {"status": "upstream_unavailable"},
    ],
)
def test_route_result_partition(payload: dict[str, object]) -> None:
    assert (
        TypeAdapter(RouteToolResult).validate_python(payload).status
        == payload["status"]
    )
