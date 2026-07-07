"""Pure unit tests for deterministic translation helpers."""

from __future__ import annotations

from agent.agents.translation_bangumi import best_matching_hit, hit_matches


def test_matcher_accepts_exact_name_match() -> None:
    hit = {"name": "君の名は", "name_cn": "你的名字"}

    assert hit_matches("君の名は", hit)


def test_matcher_accepts_trailing_sentence_mark_match() -> None:
    hit = {"name": "君の名は。", "name_cn": "你的名字。"}

    assert hit_matches("君の名は", hit)


def test_matcher_rejects_sequel_mismatch() -> None:
    hit = {"name": "涼宮ハルヒの憂鬱", "name_cn": "凉宫春日的忧郁"}

    assert best_matching_hit("涼宮ハルヒの消失", [hit]) is None


def test_matcher_accepts_name_cn_match() -> None:
    hit = {"name": "君の名は。", "name_cn": "你的名字。"}

    assert hit_matches("你的名字", hit)


def test_matcher_rejects_short_fragment_containment() -> None:
    hit = {"name": "君の名は。", "name_cn": "你的名字。"}

    assert not hit_matches("君", hit)


def test_matcher_rejects_place_name_mismatch() -> None:
    hit = {"name": "秋葉原電脳組物語", "name_cn": "秋叶原电脑组物语"}

    assert best_matching_hit("秋葉原", [hit]) is None
