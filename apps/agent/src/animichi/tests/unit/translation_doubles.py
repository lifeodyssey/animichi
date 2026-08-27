"""Doubles for the translation agent suites: catalog stubs and models.

Named for what they build (naming-ownership rule); shared by
test_translation.py and test_translation_provenance.py (#1222 split).
"""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock

from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models import Model
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from animichi.agents.translation import (
    CatalogClientProtocol,
    TranslationKind,
    TranslationResult,
    translate_text,
    translate_title,
    translation_agent,
)
from animichi.clients.catalog_client import (
    AnimeCandidate,
    ResolveNotFound,
    ResolveResolved,
)


@dataclass(frozen=True)
class TranslationContext:
    model: Model
    usage: RunUsage


def catalog_stub(outcome: ResolveResolved | ResolveNotFound) -> MagicMock:
    catalog = MagicMock(spec=CatalogClientProtocol)
    catalog.resolve = AsyncMock(return_value=outcome)
    return catalog


def resolved_outcome(title_cn: str = "你的名字。") -> ResolveResolved:
    match = AnimeCandidate(bangumi_id="160209", title="君の名は。", title_cn=title_cn)
    return ResolveResolved(outcome="resolved", match=match)


def not_found_outcome() -> ResolveNotFound:
    return ResolveNotFound(outcome="not_found", reason="anime_not_found")


def text_model(output: str) -> TestModel:
    """A real Agent[None, str] run driven by a fixed text output — no tools."""
    return TestModel(call_tools=[], custom_output_text=output)


def counting_model(output: str) -> tuple[FunctionModel, list[int]]:
    """A FunctionModel that records every invocation, so a test can assert
    the LLM was (or was NOT) actually called — the behavior the old
    `agent.run.assert_awaited_once()` / `assert_not_awaited()` checked."""
    calls: list[int] = []

    def _respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        calls.append(1)
        return ModelResponse(parts=[TextPart(output)])

    return FunctionModel(_respond), calls


def raising_model(message: str) -> FunctionModel:
    """A FunctionModel whose request raises — the transport/model failure
    `_run_translation` catches and treats as an untranslated fallback."""

    def _fail(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        raise RuntimeError(message)

    return FunctionModel(_fail)


async def translate_with_context(
    title: str,
    *,
    target_locale: str,
    kind: TranslationKind,
    catalog: MagicMock,
    ctx: TranslationContext,
) -> TranslationResult:
    # conftest's autouse fixture already holds translation_agent.override(...)
    # open for the whole test; nest this test's own model on top of it so
    # ctx.model (the real per-call seam translate_title/_run_translation use)
    # actually drives the run instead of being shadowed by the outer override.
    with translation_agent.override(model=ctx.model):
        return await translate_title(
            title, target_locale=target_locale, kind=kind, catalog=catalog, ctx=ctx
        )


async def translate_text_with_context(
    text: str, *, target_locale: str, ctx: TranslationContext
) -> str:
    with translation_agent.override(model=ctx.model):
        return await translate_text(text, target_locale=target_locale, ctx=ctx)
