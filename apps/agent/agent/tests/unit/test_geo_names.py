"""Unit tests for city name localization (geo_names module)."""

from agent.agents.geo_names import localized_city_name


class TestLocalizedCityName:
    def test_japanese_locale_returns_kanji(self) -> None:
        assert localized_city_name("Uji", "ja") == "宇治"

    def test_chinese_locale_returns_chinese(self) -> None:
        assert localized_city_name("Tokyo", "zh") == "东京"

    def test_english_locale_returns_original(self) -> None:
        assert localized_city_name("Uji", "en") == "Uji"

    def test_unknown_city_returns_original(self) -> None:
        assert localized_city_name("NonexistentCity", "ja") == "NonexistentCity"

    def test_major_anime_cities_covered(self) -> None:
        cities = {
            "Osaka-shi": "大阪",
            "Hiroshima-shi": "広島",
            "Sapporo": "札幌",
            "Kamakura": "鎌倉",
        }
        for english, expected_ja in cities.items():
            assert localized_city_name(english, "ja") == expected_ja, (
                f"{english} should be {expected_ja}"
            )
