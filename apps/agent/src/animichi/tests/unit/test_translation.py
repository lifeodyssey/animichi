"""Unit tests for catalog-backed, tool-less translation."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from animichi.agents.translation import (
    TranslationKind,
    TranslationResult,
    translate_text,
    translate_title,
    translation_agent,
)
from animichi.clients.catalog_client import (
    AnimeCandidate,
    CatalogClientProtocol,
    ResolveNotFound,
    ResolveResolved,
)
from animichi.tests.eval.translation_eval_cases import CASES


@dataclass(frozen=True)
class _TranslationContext:
    model: Model
    usage: RunUsage


def _catalog(outcome: ResolveResolved | ResolveNotFound) -> MagicMock:
    catalog = MagicMock(spec=CatalogClientProtocol)
    catalog.resolve = AsyncMock(return_value=outcome)
    return catalog


def _resolved(title_cn: str = "你的名字。") -> ResolveResolved:
    match = AnimeCandidate(bangumi_id="160209", title="君の名は。", title_cn=title_cn)
    return ResolveResolved(outcome="resolved", match=match)


def _not_found() -> ResolveNotFound:
    return ResolveNotFound(outcome="not_found", reason="anime_not_found")


def _text_model(output: str) -> TestModel:
    """A real Agent[None, str] run driven by a fixed text output — no tools."""
    return TestModel(call_tools=[], custom_output_text=output)


def _counting_model(output: str) -> tuple[FunctionModel, list[int]]:
    """A FunctionModel that records every invocation, so a test can assert
    the LLM was (or was NOT) actually called — the behavior the old
    `agent.run.assert_awaited_once()` / `assert_not_awaited()` checked."""
    calls: list[int] = []

    def _respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        calls.append(1)
        return ModelResponse(parts=[TextPart(output)])

    return FunctionModel(_respond), calls


def _raising_model(message: str) -> FunctionModel:
    """A FunctionModel whose request raises — the transport/model failure
    `_run_translation` catches and treats as an untranslated fallback."""

    def _fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise RuntimeError(message)

    return FunctionModel(_fail)


async def _translate_title(
    title: str,
    *,
    target_locale: str,
    kind: TranslationKind,
    catalog: MagicMock,
    ctx: _TranslationContext,
) -> TranslationResult:
    # conftest's autouse fixture already holds translation_agent.override(...)
    # open for the whole test; nest this test's own model on top of it so
    # ctx.model (the real per-call seam translate_title/_run_translation use)
    # actually drives the run instead of being shadowed by the outer override.
    with translation_agent.override(model=ctx.model):
        return await translate_title(
            title, target_locale=target_locale, kind=kind, catalog=catalog, ctx=ctx
        )


async def _translate_text(
    text: str, *, target_locale: str, ctx: _TranslationContext
) -> str:
    with translation_agent.override(model=ctx.model):
        return await translate_text(text, target_locale=target_locale, ctx=ctx)


def test_eval_cases_preserve_translation_kind() -> None:
    cases = {case.name: case.inputs for case in CASES}
    assert cases["T001"].kind == "anime_title"
    assert cases["T053"].kind == "place_name"


async def test_chinese_title_resolves_only_through_catalog() -> None:
    catalog = _catalog(_resolved())
    model, calls = _counting_model("unused")
    ctx = _TranslationContext(model, RunUsage())

    result = await _translate_title(
        "君の名は。",
        target_locale="zh",
        kind="anime_title",
        catalog=catalog,
        ctx=ctx,
    )

    catalog.resolve.assert_awaited_once_with("君の名は。")
    assert calls == []
    assert result == TranslationResult("君の名は。", "你的名字。", "catalog", 1.0)


@pytest.mark.parametrize(
    ("title", "translated"),
    [("君の名は。", "Your Name"), ("宇治駅", "Uji Station")],
)
async def test_english_title_and_place_use_toolless_llm(
    title: str, translated: str
) -> None:
    catalog = _catalog(_not_found())
    ctx = _TranslationContext(_text_model(translated), RunUsage())

    result = await _translate_title(
        title,
        target_locale="en",
        kind="anime_title" if title == "君の名は。" else "place_name",
        catalog=catalog,
        ctx=ctx,
    )

    catalog.resolve.assert_not_awaited()
    assert result == TranslationResult(title, translated, "llm", 0.6)


async def test_model_cannot_claim_web_search_provenance() -> None:
    catalog = _catalog(_not_found())
    ctx = _TranslationContext(_text_model("web_search"), RunUsage())

    result = await _translate_title(
        "unknown", target_locale="zh", kind="anime_title", catalog=catalog, ctx=ctx
    )

    assert result.translated == "web_search"
    assert result.source == "llm"
    assert result.confidence == pytest.approx(0.6)


async def test_untranslated_fallback_reports_zero_confidence() -> None:
    catalog = _catalog(_not_found())
    ctx = _TranslationContext(_raising_model("model unavailable"), RunUsage())

    result = await _translate_title(
        "unknown", target_locale="zh", kind="anime_title", catalog=catalog, ctx=ctx
    )

    assert result == TranslationResult("unknown", "unknown", "untranslated", 0.0)


async def test_chinese_place_name_bypasses_anime_catalog_collision() -> None:
    collision = AnimeCandidate(
        bangumi_id="3151", title="秋葉原電脳組", title_cn="秋叶原电脑组"
    )
    catalog = _catalog(ResolveResolved(outcome="resolved", match=collision))
    model, calls = _counting_model("秋叶原")
    ctx = _TranslationContext(model, RunUsage())

    result = await _translate_title(
        "秋葉原", target_locale="zh", kind="place_name", catalog=catalog, ctx=ctx
    )

    catalog.resolve.assert_not_awaited()
    assert calls == [1]
    assert result == TranslationResult("秋葉原", "秋叶原", "llm", 0.6)


async def test_successful_equal_model_output_keeps_llm_provenance() -> None:
    catalog = _catalog(_not_found())
    ctx = _TranslationContext(_text_model("CLANNAD"), RunUsage())

    result = await _translate_title(
        "CLANNAD", target_locale="zh", kind="anime_title", catalog=catalog, ctx=ctx
    )

    assert result == TranslationResult("CLANNAD", "CLANNAD", "llm", 0.6)


async def test_blank_model_output_is_untranslated() -> None:
    catalog = _catalog(_not_found())
    ctx = _TranslationContext(_text_model("   "), RunUsage())

    result = await _translate_title(
        "CLANNAD", target_locale="zh", kind="anime_title", catalog=catalog, ctx=ctx
    )

    assert result == TranslationResult("CLANNAD", "CLANNAD", "untranslated", 0.0)


async def test_general_text_uses_toolless_llm() -> None:
    ctx = _TranslationContext(_text_model("你好"), RunUsage())

    result = await _translate_text("hello", target_locale="zh", ctx=ctx)

    assert result == "你好"


async def test_translate_text_returns_original_on_error() -> None:
    ctx = _TranslationContext(_raising_model("model unavailable"), RunUsage())

    result = await _translate_text("hello world", target_locale="zh", ctx=ctx)

    assert result == "hello world"
