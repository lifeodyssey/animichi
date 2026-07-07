"""Unit tests for the pure geometric helpers in ``geo_utils``."""

from __future__ import annotations

from agent.agents.geo_utils import haversine_distance, validate_coordinates


def test_haversine_distance_zero_for_identical_points() -> None:
    assert haversine_distance(35.0, 139.0, 35.0, 139.0) == 0.0


def test_haversine_distance_known_pair_kyoto_to_uji() -> None:
    dist = haversine_distance(34.9858, 135.7588, 34.8915, 135.8075)
    assert 11_000 < dist < 12_000


def test_validate_coordinates_accepts_valid_row() -> None:
    valid, invalid = validate_coordinates([{"latitude": 35.0, "longitude": 139.0}])
    assert valid == [{"latitude": 35.0, "longitude": 139.0}]
    assert invalid == []


def test_validate_coordinates_rejects_missing_and_nonnumeric() -> None:
    rows: list[dict[str, object]] = [
        {"latitude": 35.0},
        {"latitude": "x", "longitude": 1},
    ]
    valid, invalid = validate_coordinates(rows)
    assert valid == []
    assert invalid == rows


def test_validate_coordinates_rejects_bool_values() -> None:
    valid, invalid = validate_coordinates([{"latitude": True, "longitude": 139.0}])
    assert valid == []
    assert len(invalid) == 1


def test_validate_coordinates_rejects_null_island() -> None:
    valid, invalid = validate_coordinates([{"latitude": 0.0, "longitude": 0.0}])
    assert valid == []
    assert len(invalid) == 1


def test_validate_coordinates_rejects_out_of_range() -> None:
    valid, invalid = validate_coordinates([{"latitude": 91.0, "longitude": 200.0}])
    assert valid == []
    assert len(invalid) == 1
