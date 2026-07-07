"""Web-facing tool registrations (web_search, translate_anime_title).

Extracted from pilgrimage_tools.py to keep that file under 300 lines.
Import this module after ``pilgrimage_agent`` is created so the decorators
can attach to it.
"""

from __future__ import annotations

import asyncio
from typing import cast

from pydantic_ai import RunContext
from pydantic_ai.common_tools.duckduckgo import (
    DuckDuckGoResult,
    duckduckgo_search_tool,
)

from agent.agents.guardrails import (
    WebResult,
    detect_prompt_injection,
    wrap_untrusted_web_results,
)
from agent.agents.pilgrimage_agent import pilgrimage_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.translation import translate_title

_ddg_tool = duckduckgo_search_tool(max_results=5)


async def _run_ddg_search(query: str) -> list[DuckDuckGoResult]:
    """Call the official pydantic-ai DuckDuckGo tool's search function."""
    raw = await _ddg_tool.function(query)  # untyped at the pydantic-ai boundary
    return cast(list[DuckDuckGoResult], raw)


def _to_web_result(raw: DuckDuckGoResult) -> WebResult:
    return WebResult(title=raw["title"], body=raw["body"], href=raw["href"])


def _log_result_injections(results: list[WebResult]) -> None:
    """Detection also covers tool returns, not just user input (log-only)."""
    for result in results:
        detect_prompt_injection(f"{result.title} {result.body}", source="web_search")


@pilgrimage_agent.tool
async def web_search(
    ctx: RunContext[RuntimeDeps],
    *,
    query: str,
) -> str:
    """Search the web for information using DuckDuckGo.

    Use this when you need to:
    - Find the correct translation of an anime title
    - Look up information about a pilgrimage location
    - Verify facts about an anime or location
    - Find community-accepted translations from 萌娘百科 or Wikipedia

    Args:
        query: The search query. Be specific. Include the language you want results in.
               Examples:
               - "響け！ユーフォニアム Chinese name 中文名"
               - "Your Name anime Japanese title"
               - "宇治駅 anime pilgrimage spots"

    Returns a text summary of the top search results.
    """
    try:
        raw_results = await asyncio.wait_for(_run_ddg_search(query), timeout=10.0)
    except (TimeoutError, OSError, RuntimeError) as exc:
        return f"Search failed for '{query}': {exc}"
    if not raw_results:
        return f"No results found for: {query}"
    results = [_to_web_result(raw) for raw in raw_results[:5]]
    _log_result_injections(results)
    return wrap_untrusted_web_results(results)


@pilgrimage_agent.tool
async def translate_anime_title(
    ctx: RunContext[RuntimeDeps],
    *,
    title: str,
    target_language: str,
) -> dict[str, object]:
    """Translate an anime title to a target language using authoritative sources.

    This tool searches Bangumi, 萌娘百科, and Wikipedia for the community-accepted
    translation. It does NOT hard-translate — it finds the official localized title.

    IMPORTANT: Always use this tool when you need to show an anime title in a
    different language from the original. Do not guess translations.

    Args:
        title: The anime title to translate. Can be in any language.
               Examples: "君の名は。", "Your Name", "你的名字"
        target_language: Target language code: "ja", "zh", or "en"

    Returns: {"original": "...", "translated": "...", "source": "db|bangumi_api|web_search", "confidence": 0.0-1.0}
    """
    result = await translate_title(
        title,
        target_locale=target_language,
        db=ctx.deps.db,
    )
    return {
        "original": result.original,
        "translated": result.translated,
        "source": result.source,
        "confidence": result.confidence,
    }
