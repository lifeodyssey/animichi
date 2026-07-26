"""Web-facing tool definitions (web_search, translate_anime_title).

Extracted from animichi_tools.py to keep that file under 300 lines.
"""

from __future__ import annotations

import asyncio
from typing import cast

import httpx
from ddgs.exceptions import DDGSException
from pydantic_ai import RunContext
from pydantic_ai.common_tools.duckduckgo import (
    DuckDuckGoResult,
    duckduckgo_search_tool,
)
from pydantic_ai.tools import ToolFuncEither

from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_outcomes import TranslateTitleResult
from agent.agents.translation import TranslationResult, translate_title
from agent.agents.web_trust import (
    WebResult,
    wrap_untrusted_web_results,
)

_ddg_tool = duckduckgo_search_tool(max_results=5)
_SEARCH_ERRORS: tuple[type[Exception], ...] = (
    TimeoutError,
    OSError,
    RuntimeError,
    httpx.HTTPError,
    DDGSException,
)


async def _run_ddg_search(query: str) -> list[DuckDuckGoResult]:
    """Call the official pydantic-ai DuckDuckGo tool's search function."""
    raw = await _ddg_tool.function(query)  # untyped at the pydantic-ai boundary
    return cast(list[DuckDuckGoResult], raw)


def _to_web_result(raw: DuckDuckGoResult) -> WebResult:
    return WebResult(title=raw["title"], body=raw["body"], href=raw["href"])


def _as_web_result(raw: DuckDuckGoResult | WebResult) -> WebResult:
    if isinstance(raw, WebResult):
        return raw
    return _to_web_result(raw)


async def _run_configured_search(
    deps: RuntimeDeps, query: str
) -> list[DuckDuckGoResult] | list[WebResult]:
    searcher = deps.web_searcher if isinstance(deps, RuntimeDeps) else None
    if searcher is not None:
        return await searcher(query)
    return await _run_ddg_search(query)


async def web_search(
    ctx: RunContext[RuntimeDeps],
    *,
    query: str,
) -> str:
    """Search the web for QA and title enrichment using DuckDuckGo.

    Use this only when you need to:
    - Find the correct translation of an anime title
    - Verify a fact about an anime or an already-known location
    - Find community-accepted translations from 萌娘百科 or Wikipedia

    Do not use this tool to find pilgrimage locations or spots. Use the catalog
    tools search_nearby and search_bangumi for pilgrimage discovery.

    Args:
        query: The search query. Be specific. Include the language you want results in.
               Examples:
               - "響け！ユーフォニアム Chinese name 中文名"
               - "Your Name anime Japanese title"
               - "葬送のフリーレン English title Wikipedia"

    Returns a text summary of the top search results.
    """
    try:
        raw_results = await asyncio.wait_for(
            _run_configured_search(ctx.deps, query), timeout=10.0
        )
    except _SEARCH_ERRORS as exc:
        return f"Search failed for '{query}': {exc}"
    if not raw_results:
        return f"No results found for: {query}"
    results = [_as_web_result(raw) for raw in raw_results[:5]]
    return wrap_untrusted_web_results(results)


async def translate_anime_title(
    ctx: RunContext[RuntimeDeps],
    *,
    title: str,
    target_language: str,
) -> TranslateTitleResult:
    """Translate an anime title through catalog or tool-less localization.

    Chinese titles resolve through the authoritative catalog. English, Japanese,
    and catalog misses use a tool-less translation model.

    IMPORTANT: Always use this tool when you need to show an anime title in a
    different language from the original. Do not guess translations.

    Args:
        title: The anime title to translate. Can be in any language.
               Examples: "君の名は。", "Your Name", "你的名字"
        target_language: Target language code: "ja", "zh", or "en"

    Returns a TranslateTitleResult: original title, translated text, provenance
    source (catalog|llm|untranslated), and confidence (0.0-1.0).
    """
    result = await _translate_title(ctx, title, target_language)
    return TranslateTitleResult(
        original=result.original,
        translated=result.translated,
        source=result.source,
        confidence=result.confidence,
    )


async def _translate_title(
    ctx: RunContext[RuntimeDeps], title: str, target_language: str
) -> TranslationResult:
    deps = ctx.deps
    if deps.title_translator is not None:
        return await deps.title_translator(title, target_language)
    return await translate_title(
        title,
        target_locale=target_language,
        kind="anime_title",
        catalog=deps.catalog,
        ctx=ctx,
    )


TOOLS: list[ToolFuncEither[RuntimeDeps]] = [web_search, translate_anime_title]
