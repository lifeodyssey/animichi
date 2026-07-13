"""Unit tests for script-based language detection.

Samples mirror real agent outputs from the 2026-07-11 eval baseline run —
the exact shapes the previous single-char detector misclassified.
"""

from __future__ import annotations

from agent.utils.language import detect_language, resolve_reply_language


class TestDetectLanguagePlain:
    def test_chinese_template(self) -> None:
        assert detect_language("找到了3处圣地。") == "zh"

    def test_japanese_template(self) -> None:
        assert detect_language("3件の聖地が見つかりました。") == "ja"

    def test_english_template(self) -> None:
        assert detect_language("Found 3 pilgrimage spots.") == "en"

    def test_japanese_sentence(self) -> None:
        assert detect_language("東京の聖地を探しています") == "ja"

    def test_empty_string_is_english(self) -> None:
        assert detect_language("") == "en"


class TestDetectLanguageContaminated:
    """Correct-language prose quoting foreign proper nouns must not flip."""

    def test_chinese_prose_quoting_kana_title(self) -> None:
        text = "《你的名字》（君の名は。）的圣地主要分布在东京新宿·四谷地区。"
        assert detect_language(text) == "zh"

    def test_chinese_prose_with_japanese_place_names(self) -> None:
        text = "为你找到了吹响悠风号（響け！ユーフォニアム）的圣地：宇治桥（宇治橋）。"
        assert detect_language(text) == "zh"

    def test_english_prose_quoting_kana_title(self) -> None:
        text = "Here are the pilgrimage spots for **Your Name (君の名は。)**!"
        assert detect_language(text) == "en"

    def test_english_prose_with_kanji_only_names(self) -> None:
        text = "Visit the Suga Shrine stairs (須賀神社) in Yotsuya, Tokyo."
        assert detect_language(text) == "en"

    def test_english_prose_with_cjk_heavy_table(self) -> None:
        text = (
            "Here are the **Weathering with You (天気の子)** spots:\n"
            "| # | Spot | Episode |\n"
            "| 1 | 代々木会館跡 | Ep 1 |\n"
            "| 2 | 新宿駅南口 | Ep 2 |"
        )
        assert detect_language(text) == "en"

    def test_japanese_prose_quoting_chinese_translation(self) -> None:
        text = "「響け！ユーフォニアム」（吹响悠风号）の聖地巡礼スポットを3件見つけました。"
        assert detect_language(text) == "ja"

    def test_chinese_prose_with_single_stray_kana(self) -> None:
        assert detect_language("从千駄ヶ谷站出发，步行约10分钟。") == "zh"


class TestResolveReplyLanguage:
    def test_clear_japanese_query_wins_over_locale(self) -> None:
        assert resolve_reply_language("君の名は。の聖地", "zh") == "ja"

    def test_clear_chinese_query_wins_over_locale(self) -> None:
        assert resolve_reply_language("你的名字的圣地", "ja") == "zh"

    def test_simplified_han_marks_chinese(self) -> None:
        assert resolve_reply_language("灌篮高手的取景地", "ja") == "zh"

    def test_pure_latin_query_wins_over_locale(self) -> None:
        assert resolve_reply_language("Your Name pilgrimage", "ja") == "en"

    def test_zh_tail_beats_kana_in_pasted_title(self) -> None:
        assert resolve_reply_language("ぼっち・ざ・ろっく的圣地", "zh") == "zh"

    def test_japanese_query_with_latin_title_defers_to_locale(self) -> None:
        assert resolve_reply_language("THE FIRST SLAM DUNKの聖地巡礼", "ja") == "ja"

    def test_mixed_pasted_title_plus_english_defers_to_locale(self) -> None:
        assert resolve_reply_language("天気の子 anime pilgrimage", "en") == "en"

    def test_ambiguous_single_han_defers_to_locale(self) -> None:
        assert resolve_reply_language("鬼", "ja") == "ja"
        assert resolve_reply_language("花", "zh") == "zh"

    def test_shinjitai_marks_japanese(self) -> None:
        assert resolve_reply_language("天気", "zh") == "ja"

    def test_empty_query_defers_to_locale(self) -> None:
        assert resolve_reply_language("", "ja") == "ja"

    def test_quoted_title_does_not_vote(self) -> None:
        assert resolve_reply_language("《你的名字》の聖地", "en") == "ja"
