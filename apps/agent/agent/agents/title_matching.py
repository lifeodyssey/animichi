"""Pure title normalization and variant-conflict checks."""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping


def normalize_title(value: str) -> str:
    """NFKC-fold, case-fold, and remove formatting punctuation and spacing."""
    folded = unicodedata.normalize("NFKC", value).casefold()
    return "".join(char for char in folded if char.isalnum())


def best_alias_match(query: str, aliases: Mapping[str, str]) -> str | None:
    """Choose an exact normalized alias, then the longest contained alias."""
    normalized = normalize_title(query)
    matches = _alias_matches(normalized, aliases)
    return max(matches, key=lambda item: item[:2])[2] if matches else None


def _alias_matches(
    query: str, aliases: Mapping[str, str]
) -> list[tuple[bool, int, str]]:
    normalized = (
        (normalize_title(alias), work_id) for alias, work_id in aliases.items()
    )
    return [
        (alias == query, len(alias), work_id)
        for alias, work_id in normalized
        if alias in query
    ]


def looks_like_wrong_variant(query: str, titles: tuple[str, ...]) -> bool:
    """Detect a parent/season result that conflicts with a specific title query."""
    normalized_query = normalize_title(query)
    candidates = tuple(normalize_title(title) for title in titles if title)
    if normalized_query in candidates:
        return False
    return any(_variant_conflict(normalized_query, title) for title in candidates)


def _variant_conflict(query: str, title: str) -> bool:
    if title in query and len(query) - len(title) >= 2:
        return True
    prefix = _common_prefix_length(query, title)
    return prefix >= 4 and len(query) - prefix >= 2 and len(title) - prefix >= 2


def _common_prefix_length(left: str, right: str) -> int:
    return next(
        (
            index
            for index, pair in enumerate(zip(left, right, strict=False))
            if pair[0] != pair[1]
        ),
        min(len(left), len(right)),
    )
