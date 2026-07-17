"""Deterministic web and translation stubs for trajectory evals."""

from __future__ import annotations

from agent.agents.translation import TranslationResult
from agent.agents.web_trust import WebResult
from agent.tests.eval.mock_catalog_client import (
    FIXTURE_POINTS,
    LOCATION_CENTERS,
    TITLE_ALIASES,
    TITLE_NAMES,
)
from agent.tests.eval.mock_catalog_fixtures import TitleNames


class MockWebSearcher:
    """Async callable that returns canned web results for fixture entities."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[str, ...]]] = []

    async def __call__(self, query: str) -> list[WebResult]:
        self.calls.append(("search", (query,)))
        bangumi_id = _match_title(query) or _match_location(query)
        if bangumi_id is None:
            return []
        return _web_results(bangumi_id)


class MockTitleTranslator:
    """Async callable that translates fixture anime names by table lookup."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[str, ...]]] = []

    async def __call__(self, title: str, target_locale: str) -> TranslationResult:
        self.calls.append(("translate", (title, target_locale)))
        bangumi_id = _match_title(title)
        if bangumi_id is None:
            return _translation_miss(title)
        return _translation_hit(title, target_locale, TITLE_NAMES[bangumi_id])


def _match_title(text: str) -> str | None:
    query = text.lower()
    for bangumi_id, names in TITLE_NAMES.items():
        if query in {names.ja.lower(), names.zh.lower(), names.en.lower()}:
            return bangumi_id
    for alias, bangumi_id in TITLE_ALIASES.items():
        if alias in query:
            return bangumi_id
    return None


def _match_location(text: str) -> str | None:
    query = text.lower()
    for alias, center in LOCATION_CENTERS.items():
        if alias in query:
            return center[2]
    return None


def _web_results(bangumi_id: str) -> list[WebResult]:
    names = TITLE_NAMES[bangumi_id]
    places = _place_names(bangumi_id)
    return [
        WebResult(
            title=f"{names.en} pilgrimage references",
            body=f"{names.ja} / {names.zh} appears around {places}.",
            href=f"https://guide.example.test/anime/{bangumi_id}",
        ),
        WebResult(
            title=f"{names.ja} location notes",
            body=f"Known fixture locations for {names.en}: {places}.",
            href=f"https://locations.example.test/anime/{bangumi_id}",
        ),
    ]


def _place_names(bangumi_id: str) -> str:
    points = FIXTURE_POINTS.get(bangumi_id, [])
    names = [point.name for point in points[:2]]
    return "、".join(names) if names else "known pilgrimage locations"


def _translation_hit(
    original: str, target_locale: str, names: TitleNames
) -> TranslationResult:
    translated = _translated_name(target_locale, names)
    return TranslationResult(
        original=original,
        translated=translated,
        source="catalog",
        confidence=1.0,
    )


def _translated_name(target_locale: str, names: TitleNames) -> str:
    if target_locale == "ja":
        return names.ja
    if target_locale == "zh":
        return names.zh
    if target_locale == "en":
        return names.en
    return names.ja


def _translation_miss(title: str) -> TranslationResult:
    return TranslationResult(
        original=title,
        translated=title,
        source="untranslated",
        confidence=0.0,
    )
