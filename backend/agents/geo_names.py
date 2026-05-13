"""City name localization using GeoNames data.

Maps reverse-geocoder English city names to Japanese/Chinese equivalents.
The mapping file (data/city_names_jp.json) was generated from GeoNames JP.txt
+ alternateNames, covering 662/747 Japanese cities in the reverse_geocoder
dataset.
"""

from __future__ import annotations

import json
from pathlib import Path

_DATA_PATH = Path(__file__).parent / "data" / "city_names_jp.json"

_CITY_NAMES: dict[str, dict[str, str]] = {}


def _load() -> dict[str, dict[str, str]]:
    global _CITY_NAMES  # noqa: PLW0603
    if not _CITY_NAMES:
        _CITY_NAMES = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    return _CITY_NAMES


def localized_city_name(english_name: str, locale: str) -> str:
    """Return the localized city name, falling back to the English name."""
    names = _load().get(english_name, {})
    return names.get(locale) or english_name
