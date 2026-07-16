"""Translation Agent — multilingual anime title and content translation.

Provides a web-search-backed translation tool for the pilgrimage agent.
Translation chain (cheapest first):
1. DB cache (bangumi table has title + title_cn)
2. Bangumi API (search_subject returns name + name_cn)
3. DuckDuckGo web search (萌娘百科, Wikipedia, etc.)
4. LLM fallback (last resort)

This module does NOT hard-translate anime titles. It searches authoritative
sources (Bangumi, 萌娘百科, Wikipedia) to find the community-accepted
translation, which may differ from a literal translation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, cast

import httpx
import structlog
from ddgs.exceptions import DDGSException
from pydantic_ai import Agent, RunContext
from pydantic_ai.common_tools.duckduckgo import (
    DuckDuckGoResult,
    duckduckgo_search_tool,
)
from pydantic_ai.exceptions import FallbackExceptionGroup
from pydantic_ai.models import Model
from pydantic_ai.usage import RunUsage

from agent.agents.base import resolve_model
from agent.agents.translation_bangumi import lookup_bangumi_api
from agent.agents.web_trust import WebResult, wrap_untrusted_web_results

logger = structlog.get_logger(__name__)

_SEARCH_ERRORS: tuple[type[Exception], ...] = (
    TimeoutError,
    OSError,
    RuntimeError,
    httpx.HTTPError,
    DDGSException,
)


@dataclass
class TranslationDeps:
    """Dependencies for the translation agent."""

    db: object | None = None
    source_locale: str = ""
    target_locale: str = ""


@dataclass
class TranslationResult:
    """Result of a translation lookup."""

    original: str
    translated: str
    source: str  # "db", "bangumi_api", "web_search", "llm_fallback"
    confidence: float = 1.0  # 1.0 = authoritative, 0.5 = web search, 0.3 = LLM guess


class TranslationContext(Protocol):
    """Parent run resources inherited by translation sub-agent calls."""

    @property
    def model(self) -> Model: ...

    @property
    def usage(self) -> RunUsage: ...


# ── Deterministic DB lookup (no LLM needed) ──────────────────────────


async def _lookup_db(db: object, title: str, target_locale: str) -> str | None:
    """Check if we already have a translation in the DB."""
    repo = getattr(db, "bangumi", None)
    find_all = getattr(repo, "find_all_by_title", None)
    if not callable(find_all):
        return None

    matches = await find_all(title)
    if not matches:
        return None

    best = matches[0]
    if target_locale == "zh":
        cn = best.get("title_cn")
        return str(cn) if cn else None
    if target_locale in ("ja", ""):
        ja = best.get("title")
        return str(ja) if ja else None
    # English — we don't have title_en yet, return None to trigger search
    return None


# ── Translation Agent (with web search) ─────────────────────────────

_TRANSLATION_INSTRUCTIONS = """\
You are a translation specialist for anime titles and pilgrimage-related content.

Your job: translate anime titles, place names, and user-facing text between
Japanese, Chinese, and English.

IMPORTANT RULES:
1. For anime titles, NEVER hard-translate. Search for the community-accepted
   translation using web search. Chinese must be Simplified Chinese (zh-Hans)
   as used on Bangumi/萌娘百科; convert or prefer Simplified variants over
   Traditional Chinese from Taiwan/Hong Kong Wikipedia. For example:
   - "君の名は。" → Chinese: "你的名字。" (NOT "你的名字是")
   - "進撃の巨人" → English: "Attack on Titan" (NOT "Advance of Giants")
   - "響け！ユーフォニアム" → Chinese: "吹响！悠风号" (NOT "响吧！上低音号")
   - "ソードアート・オンライン" → Chinese: "刀剑神域"
   - "あの日見た花の名前を僕達はまだ知らない。" → Chinese: "未闻花名",
     English: "Anohana"

2. Use web search to find translations from authoritative sources:
   - Bangumi (bgm.tv) name_cn and 萌娘百科 for Chinese translations
   - Official English licensors/Wikipedia for English titles
   - Prefer official localized English; if none exists, use the standard
     romanized Japanese title. NEVER literal word-by-word translation.
   - Examples: "銀魂" → English: "Gintama"; "化物語" → English:
     "Bakemonogatari"; "やはり俺の青春ラブコメはまちがっている。" →
     English: "My Teen Romantic Comedy SNAFU"

3. For Japanese place names, use the standard localized form. Use Hepburn
   romanization plus customary English generic suffixes: Station, Shrine,
   Temple, Park, Garden(s). Do NOT translate proper-noun meanings word-by-word.
   - "宇治駅" → Chinese: "宇治站", English: "Uji Station"
   - "秋葉原" → Chinese: "秋叶原", English: "Akihabara"
   - "須賀神社" → English: "Suga Shrine"
   - "新宿御苑" → English: "Shinjuku Gyoen"

4. Return ONLY the translated text, no explanations.
"""

_ddg_tool = duckduckgo_search_tool(max_results=5)


async def _run_ddg_search(query: str) -> list[DuckDuckGoResult]:
    try:
        raw = await _ddg_tool.function(query)
    except _SEARCH_ERRORS:
        logger.warning("translation_web_search_failed", query=query[:100])
        return []
    return cast(list[DuckDuckGoResult], raw)


def _to_web_result(result: DuckDuckGoResult) -> WebResult:
    return WebResult(title=result["title"], body=result["body"], href=result["href"])


async def translation_web_search(
    ctx: RunContext[TranslationDeps], *, query: str
) -> str:
    """Search DDG and return only sanitized, delimited untrusted results."""
    del ctx
    results = [_to_web_result(item) for item in await _run_ddg_search(query)]
    return wrap_untrusted_web_results(results)


translation_agent: Agent[TranslationDeps, str] = Agent(
    resolve_model(None),
    name="translation",
    deps_type=TranslationDeps,
    output_type=str,
    instructions=_TRANSLATION_INSTRUCTIONS,
    tools=[translation_web_search],
    retries=1,
)


# ── Public API ──────────────────────────────────────────────────────


async def translate_title(
    title: str,
    *,
    target_locale: str,
    db: object | None = None,
    ctx: TranslationContext | None = None,
) -> TranslationResult:
    """Translate an anime title to the target locale.

    Tries DB → Bangumi API → DuckDuckGo web search → LLM fallback.
    """
    # 1. DB cache
    if db is not None:
        cached = await _lookup_db(db, title, target_locale)
        if cached and cached != title:
            logger.info("translation_db_hit", title=title, translated=cached)
            return TranslationResult(
                original=title, translated=cached, source="db", confidence=1.0
            )

    # 2. Bangumi API
    api_result = await lookup_bangumi_api(title, target_locale)
    if api_result and api_result != title:
        logger.info("translation_bangumi_hit", title=title, translated=api_result)
        return TranslationResult(
            original=title, translated=api_result, source="bangumi_api", confidence=0.9
        )

    # 3. Web search + LLM (via translation_agent)
    locale_names = {"ja": "Japanese", "zh": "Simplified Chinese", "en": "English"}
    target_name = locale_names.get(target_locale, target_locale)

    # Fence the title to prevent prompt injection from user-influenced input
    safe_title = title.replace("```", "")
    prompt = (
        f"What is the {target_name} name of the anime title OR Japanese place "
        f"name enclosed below?\n```\n{safe_title}\n```\n"
        f"For anime, search for the official or community-accepted title. "
        f"For places, return the standard localized form; use Hepburn "
        f"romanization plus English generic suffixes like Station, Shrine, "
        f"Temple, Park, or Garden when customary. Do not translate proper-noun "
        f"meanings word by word. Return ONLY the translated name, nothing else."
    )

    try:
        deps = TranslationDeps(
            db=db,
            target_locale=target_locale,
        )
        model, usage = _translation_run_scope(ctx)
        result = await translation_agent.run(
            prompt, deps=deps, usage=usage, model=model
        )
        translated = result.output.strip().strip('"').strip("'")

        if translated and translated != title:
            logger.info(
                "translation_web_search_hit",
                title=title,
                translated=translated,
            )
            return TranslationResult(
                original=title,
                translated=translated,
                source="web_search",
                confidence=0.7,
            )
    except (FallbackExceptionGroup, OSError, RuntimeError, ValueError) as exc:
        logger.warning("translation_agent_failed", title=title, error=str(exc))

    # 4. Fallback — return original
    return TranslationResult(
        original=title, translated=title, source="llm_fallback", confidence=0.3
    )


async def translate_text(
    text: str,
    *,
    target_locale: str,
    ctx: TranslationContext | None = None,
) -> str:
    """Translate a general text string to the target locale.

    Used for user-facing messages, clarification questions, etc.
    Does NOT use web search — just LLM direct translation.
    """
    if not text:
        return text

    locale_names = {"ja": "日本語", "zh": "中文", "en": "English"}
    target_name = locale_names.get(target_locale, target_locale)

    try:
        deps = TranslationDeps(db=None, target_locale=target_locale)
        model, usage = _translation_run_scope(ctx)
        result = await translation_agent.run(
            f"Translate the following text to {target_name}. "
            f"Return ONLY the translation:\n\n{text}",
            deps=deps,
            usage=usage,
            model=model,
        )
        return result.output.strip()
    except (FallbackExceptionGroup, OSError, RuntimeError, ValueError) as exc:
        logger.warning("text_translation_failed", error=str(exc))
        return text


def _translation_run_scope(
    ctx: TranslationContext | None,
) -> tuple[Model, RunUsage]:
    if ctx is not None:
        return ctx.model, ctx.usage
    return resolve_model(translation_agent.model), RunUsage()
