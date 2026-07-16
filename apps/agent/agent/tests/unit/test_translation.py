"""Unit tests for catalog-backed, tool-less translation."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agent.agents.translation import TranslationResult, translate_text, translate_title
from agent.clients.catalog_client import (
    AnimeCandidate,
    CatalogClientProtocol,
    ResolveNotFound,
    ResolveResolved,
)
from agent.tests.eval.translation_eval_cases import CASES


def _catalog(outcome: ResolveResolved | ResolveNotFound) -> MagicMock:
    catalog = MagicMock(spec=CatalogClientProtocol)
    catalog.resolve = AsyncMock(return_value=outcome)
    return catalog


def _resolved(title_cn: str = "你的名字。") -> ResolveResolved:
    match = AnimeCandidate(bangumi_id="160209", title="君の名は。", title_cn=title_cn)
    return ResolveResolved(outcome="resolved", match=match)


def _not_found() -> ResolveNotFound:
    return ResolveNotFound(outcome="not_found", reason="anime_not_found")


def _agent_output(output: str) -> MagicMock:
    return MagicMock(output=output)


def test_eval_cases_preserve_translation_kind() -> None:
    cases = {case.name: case.inputs for case in CASES}
    assert cases["T001"].kind == "anime_title"
    assert cases["T053"].kind == "place_name"


async def test_chinese_title_resolves_only_through_catalog() -> None:
    catalog = _catalog(_resolved())
    agent = MagicMock()
    agent.run = AsyncMock()

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            "君の名は。",
            target_locale="zh",
            kind="anime_title",
            catalog=catalog,
        )

    catalog.resolve.assert_awaited_once_with("君の名は。")
    agent.run.assert_not_awaited()
    assert result == TranslationResult("君の名は。", "你的名字。", "catalog", 1.0)


@pytest.mark.parametrize(
    ("title", "translated"),
    [("君の名は。", "Your Name"), ("宇治駅", "Uji Station")],
)
async def test_english_title_and_place_use_toolless_llm(
    title: str, translated: str
) -> None:
    catalog = _catalog(_not_found())
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_output(translated))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            title,
            target_locale="en",
            kind="anime_title" if title == "君の名は。" else "place_name",
            catalog=catalog,
        )

    catalog.resolve.assert_not_awaited()
    assert "deps" not in agent.run.await_args.kwargs
    assert result == TranslationResult(title, translated, "llm", 0.6)


async def test_model_cannot_claim_web_search_provenance() -> None:
    catalog = _catalog(_not_found())
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_output("web_search"))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            "unknown", target_locale="zh", kind="anime_title", catalog=catalog
        )

    assert result.translated == "web_search"
    assert result.source == "llm"
    assert result.confidence == pytest.approx(0.6)


async def test_untranslated_fallback_reports_zero_confidence() -> None:
    catalog = _catalog(_not_found())
    agent = MagicMock()
    agent.run = AsyncMock(side_effect=RuntimeError("model unavailable"))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            "unknown", target_locale="zh", kind="anime_title", catalog=catalog
        )

    assert result == TranslationResult("unknown", "unknown", "untranslated", 0.0)


async def test_chinese_place_name_bypasses_anime_catalog_collision() -> None:
    collision = AnimeCandidate(
        bangumi_id="3151", title="秋葉原電脳組", title_cn="秋叶原电脑组"
    )
    catalog = _catalog(ResolveResolved(outcome="resolved", match=collision))
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_output("秋叶原"))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            "秋葉原", target_locale="zh", kind="place_name", catalog=catalog
        )

    catalog.resolve.assert_not_awaited()
    agent.run.assert_awaited_once()
    assert result == TranslationResult("秋葉原", "秋叶原", "llm", 0.6)


async def test_successful_equal_model_output_keeps_llm_provenance() -> None:
    catalog = _catalog(_not_found())
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_output("CLANNAD"))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            "CLANNAD", target_locale="zh", kind="anime_title", catalog=catalog
        )

    assert result == TranslationResult("CLANNAD", "CLANNAD", "llm", 0.6)


async def test_blank_model_output_is_untranslated() -> None:
    catalog = _catalog(_not_found())
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_output("   "))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            "CLANNAD", target_locale="zh", kind="anime_title", catalog=catalog
        )

    assert result == TranslationResult("CLANNAD", "CLANNAD", "untranslated", 0.0)


async def test_general_text_uses_toolless_llm() -> None:
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_output("你好"))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_text("hello", target_locale="zh")

    assert result == "你好"
    assert "deps" not in agent.run.await_args.kwargs


async def test_translate_text_returns_original_on_error() -> None:
    agent = MagicMock()
    agent.run = AsyncMock(side_effect=RuntimeError("model unavailable"))

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_text("hello world", target_locale="zh")

    assert result == "hello world"
