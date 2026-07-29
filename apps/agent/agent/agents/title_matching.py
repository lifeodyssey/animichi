"""Pure title normalization and variant-conflict checks."""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping
from itertools import groupby


def normalize_title(value: str) -> str:
    """NFKC-fold, case-fold, and remove formatting punctuation and spacing."""
    folded = unicodedata.normalize("NFKC", value).casefold()
    return "".join(char for char in folded if char.isalnum())


def _split_script(text: str) -> list[str]:
    """Split an alnum string into maximal Latin(ascii)-vs-CJK(non-ascii) runs.

    Keys on ``str.isascii``: accented Latin (é) groups with CJK, so "pokémon"
    would split at the accent. Harmless today — no accented aliases exist — but
    a Latin-script-aware key is needed before the fixture gains one.
    """
    return ["".join(run) for _, run in groupby(text, key=str.isascii)] if text else []


def _alnum_tokens(value: str) -> list[str]:
    """Whitespace tokens, punctuation-stripped, then split at Latin↔CJK boundaries.

    ja/zh queries glue particles onto Latin titles with no space ("dunkの聖地"),
    so a script-transition split is needed for a Latin alias to whole-token match.
    """
    folded = unicodedata.normalize("NFKC", value).casefold()
    tokens: list[str] = []
    for chunk in folded.split():
        tokens.extend(_split_script("".join(c for c in chunk if c.isalnum())))
    return tokens


def best_alias_match(query: str, aliases: Mapping[str, str]) -> str | None:
    """Choose an exact normalized alias, then the longest contained alias."""
    normalized = normalize_title(query)
    query_tokens = _alnum_tokens(query)
    matches = [
        (norm == normalized, len(norm), work_id)
        for alias, work_id in aliases.items()
        for norm in [normalize_title(alias)]
        if norm
        and _alias_contained(norm, normalized, query_tokens, _alnum_tokens(alias))
    ]
    return max(matches, key=lambda item: item[:2])[2] if matches else None


def _alias_contained(
    norm: str, normalized_query: str, query_tokens: list[str], alias_tokens: list[str]
) -> bool:
    """Exact query match wins; else CJK substring or ASCII whole-token-run.

    A Latin alias must appear as a contiguous run of WHOLE query tokens, so a
    short romaji alias ("kon" from "k-on") cannot false-match inside an unrelated
    Latin word ("atta-CKON-titan" / "Ha-KON-e"). CJK aliases keep substring
    matching — normalization leaves them boundary-free and collision-free.
    """
    if norm == normalized_query:
        return True
    if norm not in normalized_query:
        return False
    if not norm.isascii():
        return True
    return _contains_token_run(query_tokens, alias_tokens)


def _contains_token_run(haystack: list[str], needle: list[str]) -> bool:
    """True if `needle` is a contiguous run of whole tokens inside `haystack`."""
    span = len(needle)
    return span > 0 and any(
        haystack[index : index + span] == needle
        for index in range(len(haystack) - span + 1)
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
