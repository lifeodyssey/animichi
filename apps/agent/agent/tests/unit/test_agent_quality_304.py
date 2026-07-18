"""Issue #304 deterministic locale and retrieval regressions."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from agent.agents.catalog_tools import run_resolve
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_outcomes import ResolveNotFound
from agent.agents.translation import TranslationResult, translate_title
from agent.clients.catalog_client import AnimeCandidate, ResolveResolved
from agent.tests.eval.mock_catalog_client import MockCatalogClient

_DATASETS = Path(__file__).parents[1] / "eval" / "datasets"
_PENDING_EVAL_IDS = {
    "agent_eval_v3.json": {
        "Q304_locale_zh_001",
        "Q304_locale_en_001",
        "Q304_locale_ja_001",
        "Q304_retrieval_sequel_001",
        "Q304_retrieval_season_001",
        "Q304_retrieval_place_001",
        "Q304_retrieval_alias_001",
    },
    "translation_v1.json": {
        "Q304_T_SEQUEL_001",
        "Q304_T_PLACE_001",
        "Q304_T_ALIAS_001",
    },
}


def _deps(catalog: MockCatalogClient) -> RuntimeDeps:
    return RuntimeDeps(db=MagicMock(), locale="zh", query="query", catalog=catalog)


@pytest.mark.parametrize(
    ("query", "expected_id"),
    [
        pytest.param("涼宮ハルヒの消失", "3375", id="sequel-exact-title"),
        pytest.param("LoveLive! Sunshine!!", "165553", id="season-alias"),
        pytest.param("ＳＰＹ　ＦＡＭＩＬＹ", "396387", id="nfkc-community-alias"),
    ],
)
async def test_retrieval_prefers_normalized_specific_alias(
    query: str, expected_id: str
) -> None:
    outcome = await MockCatalogClient().resolve(query)

    assert isinstance(outcome, ResolveResolved)
    assert outcome.match.bangumi_id == expected_id


async def test_resolve_rejects_parent_entry_for_sequel_query() -> None:
    catalog = MockCatalogClient()
    catalog.resolve = AsyncMock(
        return_value=ResolveResolved(
            outcome="resolved",
            match=AnimeCandidate(
                bangumi_id="11291",
                title="涼宮ハルヒの憂鬱",
                title_cn="凉宫春日的忧郁",
            ),
        )
    )
    deps = _deps(catalog)

    outcome = await run_resolve(MagicMock(deps=deps), catalog, "涼宮ハルヒの消失")

    assert isinstance(outcome, ResolveNotFound)
    pending = deps.tool_state.session.pending_clarification
    assert pending is not None
    assert pending.reason == "anime_not_found"


async def test_place_name_translation_never_uses_anime_retrieval() -> None:
    catalog = MockCatalogClient()
    catalog.resolve = AsyncMock(
        side_effect=AssertionError("place name reached anime resolver")
    )
    translator = Agent(TestModel(custom_output_text="秋叶原"))

    with patch("agent.agents.translation.translation_agent", translator):
        result = await translate_title(
            "秋葉原",
            target_locale="zh",
            kind="place_name",
            catalog=catalog,
        )

    catalog.resolve.assert_not_awaited()
    assert result == TranslationResult("秋葉原", "秋叶原", "llm", 0.6)


def test_issue_304_eval_cases_are_tagged_and_pending() -> None:
    for filename, ids in _PENDING_EVAL_IDS.items():
        rows = json.loads((_DATASETS / filename).read_text())
        tagged = {
            row["id"]: row["metadata"]["tags"] for row in rows if row["id"] in ids
        }
        assert tagged.keys() == ids
        assert all(
            {"issue-304", "pending-eval"} <= set(tags) for tags in tagged.values()
        )
