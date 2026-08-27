"""Aggregate nearby-search catalog rows into per-anime NearbyGroup summaries."""

from __future__ import annotations

from dataclasses import dataclass, replace


@dataclass(slots=True)
class NearbyGroup:
    """One anime's aggregated summary across its nearby-search points."""

    bangumi_id: str
    title: str
    cover_url: str | None
    points_count: int
    closest_distance_m: float | None


def _row_title(row: dict[str, object]) -> str:
    title = row.get("title")
    if isinstance(title, str) and title:
        return title
    title_cn = row.get("title_cn")
    if isinstance(title_cn, str):
        return title_cn
    return ""


def _normalize_distance(row: dict[str, object]) -> float | None:
    """Extract and normalize a distance_m value from a row dict."""
    distance_m = row.get("distance_m")
    return float(distance_m) if isinstance(distance_m, int | float) else None


def _new_group(
    row: dict[str, object], bangumi_id: str, distance: float | None
) -> NearbyGroup:
    """Create a new group from the first matching row."""
    cover = row.get("cover_url")
    return NearbyGroup(
        bangumi_id=bangumi_id,
        title=_row_title(row),
        cover_url=cover if isinstance(cover, str) else None,
        points_count=1,
        closest_distance_m=distance,
    )


def _merged_cover(group: NearbyGroup, row: dict[str, object]) -> str | None:
    if group.cover_url is not None:
        return group.cover_url
    row_cover = row.get("cover_url")
    return row_cover if isinstance(row_cover, str) else None


def _merged_distance(group: NearbyGroup, distance: float | None) -> float | None:
    if distance is None:
        return group.closest_distance_m
    if group.closest_distance_m is None:
        return distance
    return min(group.closest_distance_m, distance)


def _merged_group(
    group: NearbyGroup, row: dict[str, object], distance: float | None
) -> NearbyGroup:
    """Return a copy of `group` updated with data from a subsequent matching row."""
    return replace(
        group,
        title=group.title or _row_title(row),
        cover_url=_merged_cover(group, row),
        points_count=group.points_count + 1,
        closest_distance_m=_merged_distance(group, distance),
    )


def build_nearby_groups(rows: list[dict[str, object]]) -> list[NearbyGroup]:
    """Aggregate nearby-search rows into one NearbyGroup per bangumi_id.

    Groups are returned in first-seen order.
    """
    groups: dict[str, NearbyGroup] = {}
    for row in rows:
        bangumi_id = row.get("bangumi_id")
        if not isinstance(bangumi_id, str) or not bangumi_id:
            continue
        distance = _normalize_distance(row)
        existing = groups.get(bangumi_id)
        groups[bangumi_id] = (
            _new_group(row, bangumi_id, distance)
            if existing is None
            else _merged_group(existing, row, distance)
        )
    return list(groups.values())
