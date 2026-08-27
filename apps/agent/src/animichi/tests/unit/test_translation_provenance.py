"""Provenance and fallback guarantees of the translation agent (#1222 split
from test_translation.py to honour the 200-line ceiling)."""

from __future__ import annotations

import pytest
from pydantic_ai.usage import RunUsage

from animichi.agents.translation import (
    TranslationResult,
)
from animichi.clients.catalog_client import AnimeCandidate, ResolveResolved
from animichi.tests.unit.translation_doubles import (
    TranslationContext as _TranslationContext,
)
from animichi.tests.unit.translation_doubles import (
    catalog_stub as _catalog,
)
from animichi.tests.unit.translation_doubles import (
    counting_model as _counting_model,
)
from animichi.tests.unit.translation_doubles import (
    not_found_outcome as _not_found,
)
from animichi.tests.unit.translation_doubles import (
    raising_model as _raising_model,
)
from animichi.tests.unit.translation_doubles import (
    text_model as _text_model,
)
from animichi.tests.unit.translation_doubles import (
    translate_text_with_context as _translate_text,
)
from animichi.tests.unit.translation_doubles import (
    translate_with_context as _translate_title,
)


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
