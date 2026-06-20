"""Unit tests for _localize_city_names in tool_runtime."""

from backend.agents.tool_runtime import _localize_city_names


class TestLocalizeCityNames:
    def test_localizes_city_in_rows(self) -> None:
        data: dict[str, object] = {
            "rows": [
                {"id": "1", "city": "Uji", "name": "宇治橋"},
                {"id": "2", "city": "Tokyo", "name": "秋葉原"},
            ],
            "row_count": 2,
        }
        _localize_city_names(data, "ja")
        rows = data["rows"]
        assert isinstance(rows, list)
        assert rows[0]["city"] == "宇治"
        assert rows[1]["city"] == "東京"

    def test_english_locale_skips_localization(self) -> None:
        data: dict[str, object] = {
            "rows": [{"id": "1", "city": "Uji"}],
        }
        _localize_city_names(data, "en")
        rows = data["rows"]
        assert isinstance(rows, list)
        assert rows[0]["city"] == "Uji"

    def test_no_rows_is_noop(self) -> None:
        data: dict[str, object] = {"status": "ok"}
        _localize_city_names(data, "ja")
        assert data == {"status": "ok"}

    def test_unknown_city_unchanged(self) -> None:
        data: dict[str, object] = {
            "rows": [{"id": "1", "city": "SomeTown"}],
        }
        _localize_city_names(data, "ja")
        rows = data["rows"]
        assert isinstance(rows, list)
        assert rows[0]["city"] == "SomeTown"
