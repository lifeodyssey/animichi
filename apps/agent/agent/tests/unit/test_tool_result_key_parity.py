"""Unit tests: AC3 regression signal — new models emit the legacy dict keys.

S7.8 is type-narrowing only: no output key may be added, dropped, or renamed
relative to the pre-refactor ``dict[str, object]`` payloads that reached
``tool_state`` / ``agent_result_to_response`` / ``PublicAPIResponse``. This
hardcodes those legacy key sets (from the dicts the tool functions built
before this refactor) and asserts the new models' ``model_dump(mode="json")``
still produces exactly the same keys.

This is the CI-safe stand-in for the live trajectory comparison eval
(``agent/tests/eval/test_agent_eval.py::test_agent``), which needs a live
model + DB and is not run in this worktree.
"""

from __future__ import annotations

import pytest

from agent.agents.tool_results import (
    ClarifyCandidate,
    ClarifyToolResult,
    MessageToolResult,
    ResolveAnimeResult,
    ResolveCandidate,
    RouteToolResult,
    SearchToolResult,
    TranslateTitleResult,
)

# Legacy dict[str, object] key sets, verbatim from the pre-S7.8 source.
_LEGACY_SEARCH_KEYS = {
    "rows",
    "items",
    "row_count",
    "strategy",
    "metadata",
    "nearby_groups",
    "status",
    "empty",
    "summary",
}
_LEGACY_RESOLVE_CANDIDATE_KEYS = {
    "title",
    "bangumi_id",
    "cover_url",
    "city",
    "points_count",
}
_LEGACY_RESOLVE_RESOLVED_KEYS = {"bangumi_id", "title", "candidates"}
_LEGACY_RESOLVE_AMBIGUOUS_KEYS = {"ambiguous", "candidates"}
_LEGACY_ROUTE_KEYS = {
    "ordered_points",
    "timed_itinerary",
    "point_count",
    "cover_url",
    "status",
    "summary",
}
_LEGACY_MESSAGE_KEYS = {"message", "status"}
_LEGACY_CLARIFY_CANDIDATE_KEYS = {"title", "cover_url", "spot_count", "city"}
# tool_state["clarify"] always ended up with action_required too — the
# original code mutated the same dict object after storing/emitting it.
_LEGACY_CLARIFY_KEYS = {
    "question",
    "options",
    "candidates",
    "status",
    "action_required",
}
_LEGACY_TRANSLATE_KEYS = {"original", "translated", "source", "confidence"}


def test_search_tool_result_matches_legacy_dict_keys() -> None:
    keys = set(SearchToolResult().model_dump(mode="json").keys())
    assert keys == _LEGACY_SEARCH_KEYS


def test_resolve_candidate_matches_legacy_dict_keys() -> None:
    keys = set(
        ResolveCandidate(title="t", bangumi_id="1").model_dump(mode="json").keys()
    )
    assert keys == _LEGACY_RESOLVE_CANDIDATE_KEYS


@pytest.mark.parametrize(
    ("result", "expected"),
    [
        (
            ResolveAnimeResult(bangumi_id="1", title="t", candidates=[]),
            _LEGACY_RESOLVE_RESOLVED_KEYS,
        ),
        (
            ResolveAnimeResult(ambiguous=True, candidates=[]),
            _LEGACY_RESOLVE_AMBIGUOUS_KEYS,
        ),
    ],
)
def test_resolve_anime_result_is_superset_of_legacy_keys(
    result: ResolveAnimeResult, expected: set[str]
) -> None:
    """The legacy dict only ever carried ONE of these two key subsets; the
    unified model always carries both (extra defaulted fields), which no
    consumer distinguishes from absence — see catalog_adapter.build_resolve_payload.
    """
    keys = set(result.model_dump(mode="json").keys())
    assert expected <= keys


def test_route_tool_result_matches_legacy_dict_keys() -> None:
    keys = set(RouteToolResult().model_dump(mode="json").keys())
    assert keys == _LEGACY_ROUTE_KEYS


def test_message_tool_result_matches_legacy_dict_keys() -> None:
    keys = set(MessageToolResult().model_dump(mode="json").keys())
    assert keys == _LEGACY_MESSAGE_KEYS


def test_clarify_candidate_matches_legacy_dict_keys() -> None:
    keys = set(ClarifyCandidate(title="t").model_dump(mode="json").keys())
    assert keys == _LEGACY_CLARIFY_CANDIDATE_KEYS


def test_clarify_tool_result_matches_legacy_stored_dict_keys() -> None:
    keys = set(ClarifyToolResult().model_dump(mode="json").keys())
    assert keys == _LEGACY_CLARIFY_KEYS


def test_translate_title_result_matches_legacy_dict_keys() -> None:
    result = TranslateTitleResult(
        original="a", translated="b", source="db", confidence=1.0
    )
    keys = set(result.model_dump(mode="json").keys())
    assert keys == _LEGACY_TRANSLATE_KEYS
