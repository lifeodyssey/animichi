"""Unit tests for catalog-backed, tool-less translation."""

from __future__ import annotations

import pytest
from pydantic_ai.usage import RunUsage

from animichi.agents.translation import (
    TranslationResult,
)
from animichi.tests.eval.translation_eval_cases import CASES
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
    resolved_outcome as _resolved,
)
from animichi.tests.unit.translation_doubles import (
    text_model as _text_model,
)
from animichi.tests.unit.translation_doubles import (
    translate_with_context as _translate_title,
)


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
