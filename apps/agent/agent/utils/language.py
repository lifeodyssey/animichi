"""Script-based language detection for user queries and agent replies.

Shared by the eval ``LocaleMatch`` evaluator, the agent's reply-language
directive, and the interface-layer translation gate. Pilgrimage content
necessarily quotes Japanese proper nouns (anime titles, station names), so
naive first-CJK-char detection misreads correct Chinese/English prose as
Japanese; these helpers strip quoted spans first and judge the prose that
remains.
"""

from __future__ import annotations

import re

_KANA_RE = re.compile(r"[぀-ヿ]")
_HAN_RE = re.compile(r"[一-鿿]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_QUOTED_RE = re.compile(r"[「『《【（(\[].*?[」』》】）)\]]")
_TABLE_ROW_RE = re.compile(r"^\s*\|.*$", re.MULTILINE)
_BOLD_RE = re.compile(r"\*\*.*?\*\*")

# Han forms used in Simplified Chinese but not in Japanese, and vice versa.
# ponytail: curated high-frequency subsets, not exhaustive — han-only text
# with no hit stays ambiguous and callers fall back to the browser locale.
_ZH_ONLY_HAN = frozenset(
    "你您们吗哪说请这谁么为发圣别觉话张爱见时动众龙线轻风节实过还进选篮"
)
_JA_ONLY_HAN = frozenset("気駅発楽対仮険絵覧様帰応変辺売読働囲図団戦歳庁観")


def _strip_quoted(text: str) -> str:
    """Drop quoted spans, bold spans, and table rows (proper-noun carriers)."""
    text = _TABLE_ROW_RE.sub(" ", text)
    text = _BOLD_RE.sub(" ", text)
    previous = None
    while previous != text:
        previous = text
        text = _QUOTED_RE.sub(" ", text)
    return text


def _core_text(text: str) -> str:
    """Prose with quoted proper nouns removed; raw text when nothing remains."""
    core = _strip_quoted(text)
    if _KANA_RE.search(core) or _HAN_RE.search(core) or _LATIN_RE.search(core):
        return core
    return text


def _script_counts(text: str) -> tuple[int, int, int]:
    """(kana, han, latin) character counts of *text*."""
    kana = len(_KANA_RE.findall(text))
    han = len(_HAN_RE.findall(text))
    latin = len(_LATIN_RE.findall(text))
    return kana, han, latin


def detect_language(text: str) -> str:
    """Detect the prose language of *text*: ``ja``, ``zh``, or ``en``.

    Quoted anime titles and place names are ignored, so a Chinese or English
    reply that cites Japanese proper nouns is not misread as Japanese.
    """
    kana, han, latin = _script_counts(_core_text(text))
    total = kana + han + latin
    if total == 0:
        return "en"
    if kana >= 2:
        return "ja"
    if han / total >= 0.30:
        return "zh"
    return "en"


def resolve_reply_language(query: str, locale: str) -> str:
    """Language the reply should use: query language first, locale fallback.

    Implements SD-17 (3): the current turn's text decides when its script is
    unambiguous; mixed-language and undecidable queries defer to *locale*.
    """
    core = _core_text(query)
    kana, han, latin = _script_counts(core)
    cjk = kana + han
    if cjk == 0:
        return "en" if latin else locale
    if latin / (cjk + latin) >= 0.5:
        return locale
    return _cjk_language(core, kana) or locale


def _cjk_language(core: str, kana: int) -> str | None:
    """Classify CJK-dominant prose by distinctive scripts; None if ambiguous."""
    if any(char in _ZH_ONLY_HAN for char in core):
        return "zh"
    if kana:
        return "ja"
    if any(char in _JA_ONLY_HAN for char in core):
        return "ja"
    return None
