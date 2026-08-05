"""Current-turn reply-language policy shared by runtime and evals."""

from __future__ import annotations

_HAN_RANGES = (
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xF900, 0xFAFF),
    (0x20000, 0x2FA1F),
)
_KANA_RANGES = ((0x3040, 0x30FF), (0x31F0, 0x31FF), (0xFF66, 0xFF9D))
_LOCALE_NAMES = {"en": "English", "ja": "Japanese", "zh": "Simplified Chinese"}
_SIMPLIFIED_HINTS = frozenset("为么这请绍仪动欢凉宫间过发见处门车边还让圣")


def _in_ranges(char: str, ranges: tuple[tuple[int, int], ...]) -> bool:
    point = ord(char)
    return any(start <= point <= end for start, end in ranges)


def _is_latin(char: str) -> bool:
    point = ord(char)
    return (char.isascii() and char.isalpha()) or 0x00C0 <= point <= 0x024F


def _script_counts(text: str) -> tuple[int, int, int]:
    kana = sum(_in_ranges(char, _KANA_RANGES) for char in text)
    han = sum(_in_ranges(char, _HAN_RANGES) for char in text)
    latin = sum(_is_latin(char) for char in text)
    return kana, han, latin


def detect_language(text: str) -> str:
    """Detect ja/zh/en from Unicode scripts, defaulting unknown text to English."""
    kana, han, latin = _script_counts(text)
    if kana and kana + han >= latin:
        return "ja"
    if han and han >= latin:
        return "zh"
    return "en"


def resolve_reply_language(text: str, fallback: str) -> str:
    """Prefer meaningful current-turn script evidence over the runtime fallback."""
    kana, han, latin = _script_counts(text)
    if han and any(char in _SIMPLIFIED_HINTS for char in text):
        return "zh"
    if kana or latin >= 2:
        return detect_language(text)
    if han:
        return fallback if fallback in {"ja", "zh"} else "zh"
    return fallback if fallback in _LOCALE_NAMES else "ja"


def locale_name(locale: str) -> str:
    """Return the model-facing name for one supported locale."""
    return _LOCALE_NAMES.get(locale, "Japanese")
