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


def test_matcher_accepts_english_alias_from_infobox() -> None:
    hit = {
        "name": "君の名は。",
        "name_cn": "你的名字。",
        "infobox": [
            {"key": "别名", "value": [{"v": "Kimi no Na wa."}, {"v": "Your Name."}]}
        ],
    }

    assert hit_matches("Your Name", hit)


def test_best_hit_selects_english_alias_over_unrelated() -> None:
    kimi = {
        "name": "君の名は。",
        "name_cn": "你的名字。",
        "infobox": [{"key": "别名", "value": [{"v": "Your Name."}]}],
    }
    other = {"name": "Your Friend the Rat", "name_cn": "你的老鼠朋友"}

    assert best_matching_hit("Your Name", [other, kimi]) is kimi


def test_best_hit_prefers_exact_over_containing_sequel() -> None:
    sequel = {"name": "Sound! Euphonium 2", "name_cn": "吹响！上低音号 2"}
    original = {
        "name": "響け！ユーフォニアム",
        "name_cn": "吹响！上低音号",
        "infobox": [{"key": "别名", "value": [{"v": "Sound! Euphonium"}]}],
    }

    assert best_matching_hit("Sound! Euphonium", [sequel, original]) is original


def test_matcher_ignores_non_alias_infobox_rows() -> None:
    hit = {
        "name": "君の名は。",
        "name_cn": "你的名字。",
        "infobox": [{"key": "话数", "value": "1"}],
    }

    assert not hit_matches("Your Name", hit)


def test_matcher_accepts_alias_value_as_plain_string() -> None:
    hit = {
        "name": "ヴァイオレット",
        "infobox": [{"key": "别名", "value": "Violet Evergarden"}],
    }

    assert hit_matches("Violet Evergarden", hit)


def test_matcher_ignores_non_list_non_str_alias_value() -> None:
    hit = {
        "name": "君の名は。",
        "infobox": [{"key": "别名", "value": 123}],
    }

    assert not hit_matches("Your Name", hit)


def test_best_hit_empty_title_returns_none() -> None:
    assert best_matching_hit("", [{"name": "君の名は。"}]) is None


def test_best_hit_rejects_non_list_hits() -> None:
    assert best_matching_hit("君の名は", None) is None
