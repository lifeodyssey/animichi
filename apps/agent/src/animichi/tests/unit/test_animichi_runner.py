"""Unit tests for typed runner seeding."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic_ai import ModelMessagesTypeAdapter
from pydantic_ai.exceptions import ContentFilterError
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.usage import RunUsage

from animichi.agents.animichi_runner import (
    _capped_partial_result,
    _neutral_usage,
    _seed_tool_state,
    deserialize_message_history,
    run_animichi_agent,
    to_model_turn_usage,
)
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.agents.session_state import (
    CurrentAnime,
    OrderedCandidate,
    PendingClarification,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from animichi.application.errors import InvalidInputError
from animichi.application.model_turn_port import ModelTurnUsage
from animichi.tests.eval.mock_catalog_client import MockCatalogClient


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


def test_neutral_usage_none_is_empty() -> None:
    assert _neutral_usage(None) == ModelTurnUsage()


def test_to_model_turn_usage_passes_neutral_usage_through() -> None:
    usage = ModelTurnUsage(completion_tokens=3, prompt_tokens=4, requests=2)

    assert to_model_turn_usage(usage) is usage


def test_deserialize_message_history_round_trips_non_empty() -> None:
    messages: list[ModelMessage] = [
        ModelRequest(parts=[UserPromptPart(content="hi")]),
        ModelResponse(parts=[TextPart(content="ok")]),
    ]
    raw = ModelMessagesTypeAdapter.dump_python(messages, mode="json")

    rebuilt = deserialize_message_history(raw)

    assert len(rebuilt) == 2
    assert isinstance(rebuilt[0], ModelRequest)
    assert isinstance(rebuilt[1], ModelResponse)


def test_capped_partial_result_reraises_content_filter() -> None:
    deps = _deps()

    with pytest.raises(ContentFilterError, match="filtered"):
        _capped_partial_result(deps, RunUsage(), ContentFilterError("filtered"))


async def test_run_animichi_agent_rejects_blank_text() -> None:
    with pytest.raises(InvalidInputError, match="must not be blank"):
        await run_animichi_agent(
            text="   ",
            db=MagicMock(),
            locale="ja",
            catalog=MockCatalogClient(),
        )
