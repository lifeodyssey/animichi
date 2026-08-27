"""Merge semantics of build_nearby_groups: titles, covers, distances."""

from __future__ import annotations

import pytest

from animichi.agents.handlers.nearby_groups import build_nearby_groups


def test_aggregates_same_bangumi_id() -> None:
    rows = [
        {"bangumi_id": "1", "title": "A", "cover_url": "c.jpg", "distance_m": 300},
        {"bangumi_id": "1", "title_cn": "甲", "distance_m": 100},
    ]
    groups = build_nearby_groups(rows)
    assert len(groups) == 1
    assert groups[0].points_count == 2
    assert groups[0].closest_distance_m == pytest.approx(100.0)
    assert groups[0].cover_url == "c.jpg"


def test_uses_title_cn_fallback() -> None:
    rows = [{"bangumi_id": "1", "title_cn": "甲"}]
    assert build_nearby_groups(rows)[0].title == "甲"


def test_title_is_empty_when_both_titles_missing() -> None:
    rows = [{"bangumi_id": "1", "title": 7, "title_cn": None}]
    assert build_nearby_groups(rows)[0].title == ""


def test_later_row_supplies_missing_cover() -> None:
    rows = [
        {"bangumi_id": "1", "title": "A"},
        {"bangumi_id": "1", "cover_url": "late.jpg"},
    ]
    assert build_nearby_groups(rows)[0].cover_url == "late.jpg"


def test_first_cover_wins_over_later_rows() -> None:
    rows = [
        {"bangumi_id": "1", "cover_url": "first.jpg"},
        {"bangumi_id": "1", "cover_url": "second.jpg"},
    ]
    assert build_nearby_groups(rows)[0].cover_url == "first.jpg"


def test_keeps_known_distance_when_later_row_lacks_one() -> None:
    rows = [
        {"bangumi_id": "1", "distance_m": 250},
        {"bangumi_id": "1"},
    ]
    assert build_nearby_groups(rows)[0].closest_distance_m == pytest.approx(250.0)


def test_later_row_supplies_missing_distance() -> None:
    rows = [
        {"bangumi_id": "1"},
        {"bangumi_id": "1", "distance_m": 80},
    ]
    assert build_nearby_groups(rows)[0].closest_distance_m == pytest.approx(80.0)


def test_skips_rows_without_bangumi_id() -> None:
    rows = [{"title": "no id"}, {"bangumi_id": ""}]
    assert build_nearby_groups(rows) == []
