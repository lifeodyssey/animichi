"""Translation delegation and injection-boundary tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai import RunContext
from pydantic_ai.exceptions import FallbackExceptionGroup
from pydantic_ai.models import Model
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.translation import (
    TranslationResult,
    translate_text,
    translate_title,
    translation_agent,
)
from agent.agents.web_tools import translate_anime_title
from agent.clients.catalog_client import (
    CatalogClientProtocol,
    ResolveNotFound,
)
from agent.domain.ports import DatabasePort


@dataclass(frozen=True)
class _ParentContext:
    model: Model
    usage: RunUsage


def _parent_context() -> _ParentContext:
    return _ParentContext(model=TestModel(), usage=RunUsage())


def _catalog_miss() -> MagicMock:
    catalog = MagicMock(spec=CatalogClientProtocol)
    catalog.resolve = AsyncMock(
        return_value=ResolveNotFound(outcome="not_found", reason="anime_not_found")
    )
    return catalog


def _agent_result(output: str) -> MagicMock:
    return MagicMock(output=output)


def test_translation_agent_exposes_no_tools() -> None:
    assert translation_agent._function_toolset.tools == {}


async def test_title_run_inherits_parent_usage_and_model() -> None:
    ctx = _parent_context()
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_result("你的名字。"))

    with patch("agent.agents.translation.translation_agent", agent):
        await translate_title(
            "unknown",
            target_locale="zh",
            kind="anime_title",
            catalog=_catalog_miss(),
            ctx=ctx,
        )

    assert agent.run.await_args.kwargs["usage"] is ctx.usage
    assert agent.run.await_args.kwargs["model"] is ctx.model


async def test_text_run_inherits_parent_usage_and_model() -> None:
    ctx = _parent_context()
    agent = MagicMock()
    agent.run = AsyncMock(return_value=_agent_result("你好"))

    with patch("agent.agents.translation.translation_agent", agent):
        await translate_text("hello", target_locale="zh", ctx=ctx)

    assert agent.run.await_args.kwargs["usage"] is ctx.usage
    assert agent.run.await_args.kwargs["model"] is ctx.model


async def test_title_tool_threads_catalog_and_parent_context() -> None:
    catalog = cast(CatalogClientProtocol, _catalog_miss())
    deps = RuntimeDeps(
        db=cast(DatabasePort, object()),
        locale="zh",
        query="title",
        catalog=catalog,
    )
    ctx = RunContext(deps=deps, model=TestModel(), usage=RunUsage())
    translated = TranslationResult("君の名は。", "你的名字。", "catalog")

    with patch(
        "agent.agents.web_tools.translate_title",
        new=AsyncMock(return_value=translated),
    ) as translate:
        await translate_anime_title(ctx, title="君の名は。", target_language="zh")

    assert translate.await_args.kwargs["catalog"] is catalog
    assert translate.await_args.kwargs["ctx"] is ctx
    assert translate.await_args.kwargs["kind"] == "anime_title"


async def test_injected_title_translator_override_still_wins() -> None:
    catalog = cast(CatalogClientProtocol, _catalog_miss())
    deps = RuntimeDeps(
        db=cast(DatabasePort, object()), locale="zh", query="title", catalog=catalog
    )
    translator = AsyncMock(
        return_value=TranslationResult("君の名は。", "你的名字。", "catalog")
    )
    deps.title_translator = translator
    ctx = RunContext(deps=deps, model=TestModel(), usage=RunUsage())

    with patch("agent.agents.web_tools.translate_title", new=AsyncMock()) as translate:
        await translate_anime_title(ctx, title="君の名は。", target_language="zh")

    translator.assert_awaited_once_with("君の名は。", "zh")
    translate.assert_not_awaited()


async def test_title_fallback_exception_group_returns_original() -> None:
    failure = FallbackExceptionGroup("all models failed", [RuntimeError("boom")])
    agent = MagicMock()
    agent.run = AsyncMock(side_effect=failure)

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_title(
            "unknown",
            target_locale="zh",
            kind="anime_title",
            catalog=_catalog_miss(),
        )

    assert result.translated == "unknown"
    assert result.source == "untranslated"


async def test_text_fallback_exception_group_returns_original() -> None:
    failure = FallbackExceptionGroup("all models failed", [RuntimeError("boom")])
    agent = MagicMock()
    agent.run = AsyncMock(side_effect=failure)

    with patch("agent.agents.translation.translation_agent", agent):
        result = await translate_text("hello", target_locale="zh")

    assert result == "hello"
