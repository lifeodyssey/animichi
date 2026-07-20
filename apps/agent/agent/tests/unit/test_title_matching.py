"""Pins the best_alias_match contract: token-boundary ASCII, substring CJK."""

from __future__ import annotations

import pytest

from agent.agents.title_matching import best_alias_match

# Minimal faithful slice of the eval catalog aliases (alias -> work_id).
_ALIASES = {
    "k-on": "18809",
    "けいおん": "18809",
    "轻音少女": "18809",
    "slam dunk": "324720",
    "スラムダンク": "324720",
    "spy×family": "396387",
    "spy x family": "396387",
    "love live sunshine": "165553",
    "love live": "49294",
    "laid-back camp": "328609",
    "your name": "160209",
    "君の名は": "160209",
}


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        # A short romaji alias must not hide inside an unrelated Latin word.
        ("Attack on Titan pilgrimage spots", None),
        ("anime spots near Hakone", None),
        # Legitimate ASCII + CJK resolutions still land.
        ("k-on locations", "18809"),
        ("けいおんの聖地", "18809"),
        ("Your Name pilgrimage", "160209"),
        # ja/zh glue a particle onto the Latin title with no whitespace.
        ("THE FIRST SLAM DUNKの聖地巡礼", "324720"),
        ("SPY×FAMILYの聖地ルートを教えて", "396387"),
        # Longest-alias preference must survive the glued-CJK split (parent=49294).
        ("Love Live Sunshine的沼津圣地", "165553"),
        # Exact normalized equality wins even when tokens differ (spaced vs hyphen).
        ("laid back camp", "328609"),
        # A genuinely unknown franchise stays unresolved.
        ("One Piece pilgrimage spots", None),
    ],
)
def test_best_alias_match(query: str, expected: str | None) -> None:
    assert best_alias_match(query, _ALIASES) == expected
