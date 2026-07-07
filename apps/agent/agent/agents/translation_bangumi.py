"""Bangumi-backed anime title resolution for translation lookups."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

import httpx
import structlog

logger = structlog.get_logger(__name__)

_BANGUMI_SEARCH_URL = "https://api.bgm.tv/v0/search/subjects"
_BANGUMI_USER_AGENT = (
    "Seichijunrei/1.0 (https://github.com/lifeodyssey/Seichijunrei-agent)"
)
_TITLE_NORMALIZE_RE = re.compile(
    r"[\s!！?？。・、．\.,，:：;；~〜～'\"「」『』【】()（）\[\]*＊☆★]"
)
_CONTAINMENT_RATIO = 0.5


def _normalize_title(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return _TITLE_NORMALIZE_RE.sub("", normalized)


def _titles_contain_each_other(query: str, candidate: str) -> bool:
    if query not in candidate and candidate not in query:
        return False
    ratio = min(len(query), len(candidate)) / max(len(query), len(candidate))
    return ratio >= _CONTAINMENT_RATIO


def _titles_match(query: str, candidate: str) -> bool:
    if not query or not candidate:
        return False
    return query == candidate or _titles_contain_each_other(query, candidate)


def _hit_candidate_titles(hit: Mapping[str, object]) -> tuple[str, ...]:
    candidates = (hit.get("name"), hit.get("name_cn"))
    return tuple(candidate for candidate in candidates if isinstance(candidate, str))


def hit_matches(title: str, hit: Mapping[str, object]) -> bool:
    query = _normalize_title(title)
    return any(
        _titles_match(query, _normalize_title(candidate))
        for candidate in _hit_candidate_titles(hit)
    )


def best_matching_hit(title: str, hits: object) -> Mapping[str, object] | None:
    if not isinstance(hits, list):
        return None
    for hit in hits:
        if isinstance(hit, Mapping) and hit_matches(title, hit):
            return hit
    return None


def _bangumi_search_body(title: str) -> Mapping[str, object]:
    return {"keyword": title, "filter": {"type": [2]}, "limit": 5}


async def _post_bangumi_search(title: str) -> httpx.Response:
    headers = {"User-Agent": _BANGUMI_USER_AGENT}
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await client.post(
            _BANGUMI_SEARCH_URL, json=_bangumi_search_body(title), headers=headers
        )


def _matching_search_hit(title: str, payload: object) -> Mapping[str, object] | None:
    if not isinstance(payload, Mapping):
        return None
    return best_matching_hit(title, payload.get("data"))


async def _search_bangumi_subject(title: str) -> Mapping[str, object] | None:
    """POST a five-result anime subject search to the Bangumi v0 API."""
    response = await _post_bangumi_search(title)
    if response.status_code >= 400:
        logger.warning("bangumi_search_http_error", status=response.status_code)
        return None
    return _matching_search_hit(title, response.json())


def _pick_locale_title(hit: Mapping[str, object], target_locale: str) -> str | None:
    """Choose the localized title from a Bangumi subject hit."""
    name_ja = hit.get("name")
    name_cn = hit.get("name_cn")
    if target_locale == "zh" and name_cn:
        return str(name_cn)
    if target_locale == "ja" and name_ja:
        return str(name_ja)
    # Bangumi has no English titles; name_cn is sometimes the international one.
    if target_locale == "en" and name_cn and str(name_cn).isascii():
        return str(name_cn)
    return None


async def lookup_bangumi_api(title: str, target_locale: str) -> str | None:
    """Search Bangumi API for the title translation."""
    try:
        hit = await _search_bangumi_subject(title)
    except (httpx.HTTPError, OSError, RuntimeError, ValueError) as exc:
        logger.warning("bangumi_api_translation_failed", title=title, error=str(exc))
        return None
    if hit is None:
        return None
    return _pick_locale_title(hit, target_locale)
