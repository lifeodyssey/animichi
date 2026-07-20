"""Pure title normalization and variant-conflict checks."""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping


def normalize_title(value: str) -> str:
    """NFKC-fold, case-fold, and remove formatting punctuation and spacing."""
    folded = unicodedata.normalize("NFKC", value).casefold()
    return "".join(char for char in folded if char.isalnum())


def _alnum_tokens(value: str) -> list[str]:
    folded = unicodedata.normalize("NFKC", value).casefold()
    stripped = ("".join(c for c in tok if c.isalnum()) for tok in folded.split())
    return [tok for tok in stripped if tok]


def best_alias_match(query: str, aliases: Mapping[str, str]) -> str | None:
    """Choose an exact normalized alias, then the longest contained alias."""
    normalized = normalize_title(query)
    query_tokens = _alnum_tokens(query)
    matches = [
        (norm == normalized, len(norm), work_id)
        for alias, work_id in aliases.items()
        for norm in [normalize_title(alias)]
        if norm and _alias_hit(alias, norm, normalized, query_tokens)
    ]
    return max(matches, key=lambda item: item[:2])[2] if matches else None


def _alias_hit(
    alias: str, norm: str, normalized_query: str, query_tokens: list[str]
) -> bool:
    if norm not in normalized_query:
        return False
    if not norm.isascii():
        # CJK aliases have no word boundaries once normalized; substring is the
        # only viable — and, being CJK, collision-free — match.
        return True
    # A Latin alias must appear as a contiguous run of WHOLE query tokens, so a
    # short romaji alias (e.g. "kon" from "k-on") cannot false-match inside an
    # unrelated Latin word ("atta-CKON-titan").
    alias_tokens = _alnum_tokens(alias)
    span = len(alias_tokens)
    if span == 0:
        return False
    return any(
        query_tokens[index : index + span] == alias_tokens
        for index in range(len(query_tokens) - span + 1)
    )


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
