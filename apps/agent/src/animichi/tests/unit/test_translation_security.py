"""Translation delegation and injection-boundary tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic_ai import RunContext
from pydantic_ai.exceptions import FallbackExceptionGroup
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from animichi.agents.runtime_deps import RuntimeDeps
from animichi.agents.translation import (
    TranslationResult,
    translate_text,
    translate_title,
    translation_agent,
)
from animichi.agents.web_tools import translate_anime_title
from animichi.clients.catalog_client import (
    CatalogClientProtocol,
    ResolveNotFound,
)
from animichi.domain.ports import CatalogLookup


@dataclass(frozen=True)
class _ParentContext:
    model: Model
    usage: RunUsage


def _catalog_miss() -> MagicMock:
    catalog = MagicMock(spec=CatalogClientProtocol)
    catalog.resolve = AsyncMock(
        return_value=ResolveNotFound(outcome="not_found", reason="anime_not_found")
    )
    return catalog


def _text_model(output: str) -> FunctionModel:
    """A distinctive real model: if the run's OUTPUT carries this exact text,
    that proves this specific model instance — not conftest's autouse default
    override — is the one `_run_translation` actually invoked."""

    def _respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(output)])

    return FunctionModel(_respond)


def _raising_model(error: BaseException) -> FunctionModel:
    def _fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise error

    return FunctionModel(_fail)


def test_translation_agent_exposes_no_tools() -> None:
    assert translation_agent._function_toolset.tools == {}


async def test_title_run_inherits_parent_usage_and_model() -> None:
    # ctx.usage/ctx.model are the parent-run resources _run_translation must
    # thread into the sub-agent call (not silently swap in agent defaults).
    # Threading is now proven on the REAL pipeline, behaviorally: usage.requests
    # increments only if the SAME RunUsage instance was passed and accumulated
    # by a real run, and the result carries ctx.model's distinctive output only
    # if ctx.model (not conftest's autouse override) was the one invoked.
    ctx = _ParentContext(model=_text_model("你的名字。"), usage=RunUsage())

    with translation_agent.override(model=ctx.model):
        result = await translate_title(
            "unknown",
            target_locale="zh",
            kind="anime_title",
            catalog=_catalog_miss(),
            ctx=ctx,
        )

    assert ctx.usage.requests >= 1
    assert result == TranslationResult("unknown", "你的名字。", "llm", 0.6)


async def test_text_run_inherits_parent_usage_and_model() -> None:
    ctx = _ParentContext(model=_text_model("你好"), usage=RunUsage())

    with translation_agent.override(model=ctx.model):
        result = await translate_text("hello", target_locale="zh", ctx=ctx)

    assert ctx.usage.requests >= 1
    assert result == "你好"


async def test_title_tool_threads_catalog_and_parent_context() -> None:
    catalog = cast(CatalogClientProtocol, _catalog_miss())
    deps = RuntimeDeps(
        db=cast(CatalogLookup, object()),
        locale="zh",
        query="title",
        catalog=catalog,
    )
    ctx = RunContext(deps=deps, model=TestModel(), usage=RunUsage())
    translated = TranslationResult("君の名は。", "你的名字。", "catalog")

    with patch(
        "animichi.agents.web_tools.translate_title",
        new=AsyncMock(return_value=translated),
    ) as translate:
        await translate_anime_title(ctx, title="君の名は。", target_language="zh")

    assert translate.await_args.kwargs["catalog"] is catalog
    assert translate.await_args.kwargs["ctx"] is ctx
    assert translate.await_args.kwargs["kind"] == "anime_title"


async def test_injected_title_translator_override_still_wins() -> None:
    catalog = cast(CatalogClientProtocol, _catalog_miss())
    deps = RuntimeDeps(
        db=cast(CatalogLookup, object()), locale="zh", query="title", catalog=catalog
    )
    translator = AsyncMock(
        return_value=TranslationResult("君の名は。", "你的名字。", "catalog")
    )
    deps.title_translator = translator
    ctx = RunContext(deps=deps, model=TestModel(), usage=RunUsage())

    with patch(
        "animichi.agents.web_tools.translate_title", new=AsyncMock()
    ) as translate:
        await translate_anime_title(ctx, title="君の名は。", target_language="zh")

    translator.assert_awaited_once_with("君の名は。", "zh")
    translate.assert_not_awaited()


async def test_title_fallback_exception_group_returns_original() -> None:
    failure = FallbackExceptionGroup("all models failed", [RuntimeError("boom")])
    model = _raising_model(failure)

    with translation_agent.override(model=model):
        result = await translate_title(
            "unknown",
            target_locale="zh",
            kind="anime_title",
            catalog=_catalog_miss(),
            ctx=_ParentContext(model=model, usage=RunUsage()),
        )

    assert result.translated == "unknown"
    assert result.source == "untranslated"


async def test_text_fallback_exception_group_returns_original() -> None:
    failure = FallbackExceptionGroup("all models failed", [RuntimeError("boom")])
    model = _raising_model(failure)

    with translation_agent.override(model=model):
        result = await translate_text(
            "hello",
            target_locale="zh",
            ctx=_ParentContext(model=model, usage=RunUsage()),
        )

    assert result == "hello"
