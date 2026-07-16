"""Unit tests for typed runner seeding."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from agent.agents.animichi_runner import _seed_tool_state
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.session_state import (
    CurrentAnime,
    OrderedCandidate,
    PendingClarification,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps(locale: str = "en") -> RuntimeDeps:
    return RuntimeDeps(
        db=MagicMock(), locale=locale, query="test", catalog=MockCatalogClient()
    )


def test_seed_tool_state_sets_run_inputs() -> None:
    deps = _deps("zh")
    _seed_tool_state(
        deps,
        {"last_location": "宇治", "origin_lat": 34.886, "origin_lng": 135.805},
    )
    assert deps.tool_state.locale == "zh"
    assert deps.tool_state.last_location == "宇治"
    assert deps.tool_state.origin_lat == pytest.approx(34.886)
    assert deps.tool_state.origin_lng == pytest.approx(135.805)


def test_seed_tool_state_restores_complete_typed_state() -> None:
    state = SessionState(
        current_anime=CurrentAnime(bangumi_id="485", title="Haruhi"),
        pending_clarification=PendingClarification(
            reason="anime_ambiguity",
            candidate_ids=["485", "3375"],
            ordered_candidates=[
                OrderedCandidate(id="485", title="Haruhi"),
                OrderedCandidate(id="3375", title="Disappearance"),
            ],
            revision=3,
        ),
        clarification_revision=3,
    )
    deps = _deps()
    _seed_tool_state(deps, {"session_state_v2": state.model_dump(mode="json")})
    assert deps.tool_state.session == state


def test_seed_tool_state_ignores_malformed_typed_state() -> None:
    deps = _deps()
    _seed_tool_state(deps, {"session_state_v2": {"unknown": True}})
    assert deps.tool_state.session == SessionState()


def test_seed_tool_state_has_narrow_current_anime_fallback() -> None:
    deps = _deps()
    _seed_tool_state(
        deps,
        {"current_bangumi_id": "115908", "current_anime_title": "Liz"},
    )
    assert deps.tool_state.session.current_anime == CurrentAnime(
        bangumi_id="115908", title="Liz"
    )


def test_seed_tool_state_does_not_restore_historical_payload_bags() -> None:
    deps = _deps()
    _seed_tool_state(
        deps,
        {
            "last_search_data": {"rows": [{"id": "p1"}]},
            "pending_clarify": True,
            "resolve_candidates": [{"bangumi_id": "485"}],
        },
    )
    assert deps.tool_state.session == SessionState()


def test_seed_tool_state_reserves_hydrated_registry_refs() -> None:
    state = SessionState(
        search_results={ResultRef("search:3:1"): SearchPayloadState(kind="bangumi")}
    )
    deps = _deps()
    _seed_tool_state(deps, {"session_state_v2": state.model_dump(mode="json")})
    assert deps.ref_factory("search", 3) == "search:3:2"
