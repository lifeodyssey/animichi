"""Catalog-backed anime title and tool-less text translation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

import structlog
from pydantic_ai import Agent
from pydantic_ai.exceptions import FallbackExceptionGroup
from pydantic_ai.models import Model
from pydantic_ai.usage import RunUsage

from agent.agents.base import resolve_model
from agent.agents.title_matching import looks_like_wrong_variant
from agent.clients.catalog_client import (
    CatalogClientProtocol,
    ResolveOutcome,
    ResolveResolved,
)
from agent.clients.errors import APIError

logger = structlog.get_logger(__name__)

TranslationSource = Literal["catalog", "llm", "untranslated"]
TranslationKind = Literal["anime_title", "place_name"]
_CATALOG_CONFIDENCE = 1.0
_LLM_CONFIDENCE = 0.6
_UNTRANSLATED_CONFIDENCE = 0.0


@dataclass
class TranslationResult:
    """A localized value with provenance assigned by the application."""

    original: str
    translated: str
    source: TranslationSource
    confidence: float = _CATALOG_CONFIDENCE


class TranslationContext(Protocol):
    """Parent run resources inherited by translation sub-agent calls."""

    @property
    def model(self) -> Model: ...

    @property
    def usage(self) -> RunUsage: ...


_TRANSLATION_INSTRUCTIONS = """\
You translate anime titles, Japanese place names, and user-facing text between
Japanese, Simplified Chinese, and English.

For anime titles, use the official or community-accepted localized title from
your existing knowledge, never a literal word-by-word rendering. For Japanese
places, use Hepburn romanization and customary English suffixes such as
Station, Shrine, Temple, Park, or Garden. Return only the translated text,
without explanations, provenance labels, confidence scores, or quotes.
"""

translation_agent: Agent[None, str] = Agent(
    resolve_model(None),
    name="translation",
    system_prompt=_TRANSLATION_INSTRUCTIONS,
    retries=1,
)


async def translate_title(
    title: str,
    *,
    target_locale: str,
    kind: TranslationKind,
    catalog: CatalogClientProtocol,
    ctx: TranslationContext,
) -> TranslationResult:
    """Translate by semantic kind, using catalog only for Chinese anime titles."""
    catalog_title = await _catalog_zh_title(catalog, title, target_locale, kind)
    if catalog_title is not None:
        return _result(title, catalog_title, "catalog", _CATALOG_CONFIDENCE)
    translated = await _translate_title_with_llm(title, target_locale, kind, ctx)
    if translated is not None:
        return _result(title, translated, "llm", _LLM_CONFIDENCE)
    return _result(title, title, "untranslated", _UNTRANSLATED_CONFIDENCE)


async def _catalog_zh_title(
    catalog: CatalogClientProtocol,
    title: str,
    target_locale: str,
    kind: TranslationKind,
) -> str | None:
    if kind != "anime_title" or target_locale != "zh":
        return None
    try:
        outcome = await catalog.resolve(title)
    except (APIError, OSError, RuntimeError, ValueError) as exc:
        logger.warning("translation_catalog_failed", title=title, error=str(exc))
        return None
    return _resolved_title_cn(outcome, title)


def _resolved_title_cn(outcome: ResolveOutcome, query: str) -> str | None:
    if not isinstance(outcome, ResolveResolved):
        return None
    match = outcome.match
    if looks_like_wrong_variant(query, (match.title, match.title_cn)):
        return None
    title_cn = match.title_cn.strip()
    return title_cn or None


async def _translate_title_with_llm(
    title: str,
    target_locale: str,
    kind: TranslationKind,
    ctx: TranslationContext,
) -> str | None:
    translated = await _run_translation(_title_prompt(title, target_locale, kind), ctx)
    if translated is None:
        return None
    return translated.strip('"').strip("'")


def _title_prompt(title: str, target_locale: str, kind: TranslationKind) -> str:
    target = _locale_name(target_locale)
    safe_title = title.replace("```", "")
    subject = "anime title" if kind == "anime_title" else "Japanese place name"
    return (
        f"Translate the {subject} below to {target}.\n"
        f"```\n{safe_title}\n```\n"
        "Return the accepted localized name only."
    )


async def translate_text(
    text: str,
    *,
    target_locale: str,
    ctx: TranslationContext,
) -> str:
    """Translate a general UI or clarification string without tools."""
    if not text:
        return text
    prompt = f"Translate this text to {_locale_name(target_locale)}:\n\n{text}"
    translated = await _run_translation(prompt, ctx)
    return translated or text


async def _run_translation(prompt: str, ctx: TranslationContext) -> str | None:
    try:
        result = await translation_agent.run(prompt, usage=ctx.usage, model=ctx.model)
    except (FallbackExceptionGroup, OSError, RuntimeError, ValueError) as exc:
        logger.warning("translation_agent_failed", error=str(exc))
        return None
    return result.output.strip() or None


def _locale_name(locale: str) -> str:
    names = {"ja": "Japanese", "zh": "Simplified Chinese", "en": "English"}
    return names.get(locale, locale)


def _result(
    original: str,
    translated: str,
    source: TranslationSource,
    confidence: float,
) -> TranslationResult:
    logger.info(
        "translation_complete", original=original, source=source, confidence=confidence
    )
    return TranslationResult(original, translated, source, confidence)
