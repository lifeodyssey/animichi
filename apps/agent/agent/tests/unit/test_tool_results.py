"""Unit tests for the named Pydantic result models of the catalog tools.

Covers resolve_anime / search_bangumi / search_nearby / plan_route — the four
tools whose results flow through ``tool_state`` into ``PublicAPIResponse``.
Each test asserts the model serializes to the exact key set the legacy
``dict[str, object]`` payload used, so the response mapper sees no change.
"""

from __future__ import annotations

from agent.agents.tool_results import (
    ResolveAnimeResult,
    ResolveCandidate,
    RouteSummary,
    RouteToolResult,
    SearchPreviewRow,
    SearchToolPreview,
    SearchToolResult,
)


def test_resolve_candidate_serializes_expected_keys() -> None:
    candidate = ResolveCandidate(
        title="君の名は。", bangumi_id="160209", cover_url="c.jpg"
    )
    dumped = candidate.model_dump(mode="json")
    assert set(dumped) == {"title", "bangumi_id", "cover_url", "city", "points_count"}


def test_resolve_anime_result_resolved_shape() -> None:
    result = ResolveAnimeResult(
        bangumi_id="160209",
        title="君の名は。",
        candidates=[ResolveCandidate(title="君の名は。", bangumi_id="160209")],
    )
    dumped = result.model_dump(mode="json")
    assert dumped["bangumi_id"] == "160209"
    assert dumped["ambiguous"] is False
    assert len(dumped["candidates"]) == 1


def test_resolve_anime_result_empty_has_no_candidates() -> None:
    assert ResolveAnimeResult().candidates == []


def test_search_tool_result_key_order_matches_legacy_payload() -> None:
    result = SearchToolResult(row_count=0, strategy="bangumi")
    assert list(result.model_dump(mode="json").keys()) == [
        "rows",
        "items",
        "row_count",
        "strategy",
        "metadata",
        "nearby_groups",
        "status",
        "empty",
        "summary",
    ]


def test_search_tool_result_defaults_status_ok() -> None:
    assert SearchToolResult().status == "ok"


def test_search_preview_row_has_name_and_episode() -> None:
    row = SearchPreviewRow(name="須賀神社", episode=1)
    assert row.model_dump(mode="json") == {"name": "須賀神社", "episode": 1}


def test_search_tool_preview_carries_note_and_preview_rows() -> None:
    preview = SearchToolPreview(
        row_count=12,
        preview=[SearchPreviewRow(name="a", episode=1)],
        note="Found 12 spots",
    )
    assert preview.row_count == 12
    assert preview.note == "Found 12 spots"
    assert len(preview.preview) == 1


def test_route_tool_result_key_order_matches_legacy_payload() -> None:
    result = RouteToolResult()
    assert list(result.model_dump(mode="json").keys()) == [
        "ordered_points",
        "timed_itinerary",
        "point_count",
        "cover_url",
        "status",
        "summary",
    ]


def test_route_summary_default_counts_are_zero() -> None:
    summary = RouteSummary()
    assert summary.point_count == 0
    assert summary.with_coordinates == 0
    assert summary.without_coordinates == 0
