"""Shared helpers for executor handlers."""

from __future__ import annotations


def _rewrite_url(url: str) -> str:
    """Rewrite a single Anitabi image URL to go through our CF proxy."""
    if "image.anitabi.cn/" in url:
        return url.replace("https://image.anitabi.cn/", "/img/")
    if url.startswith("screenshot/"):
        return f"/img/{url}"
    return url


def rewrite_image_urls(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Rewrite Anitabi image URLs to go through our CF proxy.

    In development mode (no CF Worker), keep the original Anitabi URLs
    so images load directly from the CDN.
    """
    import os

    if os.environ.get("APP_ENV", "development") == "development":
        return rows

    out = list(rows)
    for row in out:
        url = row.get("screenshot_url")
        if isinstance(url, str) and url:
            row["screenshot_url"] = _rewrite_url(url)
    return out


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


def _init_group(
    row: dict[str, object], bangumi_id: str, normalized_distance: float | None
) -> dict[str, object]:
    """Create a new group dict from the first matching row."""
    cover = row.get("cover_url")
    return {
        "bangumi_id": bangumi_id,
        "title": _row_title(row),
        "cover_url": cover if isinstance(cover, str) else None,
        "points_count": 1,
        "closest_distance_m": normalized_distance,
    }


def _update_group(
    group: dict[str, object],
    row: dict[str, object],
    normalized_distance: float | None,
) -> None:
    """Update an existing group with data from a subsequent matching row."""
    raw_count = group["points_count"]
    group["points_count"] = (
        int(raw_count) if isinstance(raw_count, (int, float)) else 0
    ) + 1
    if not group.get("title"):
        group["title"] = _row_title(row)
    if group.get("cover_url") is None and isinstance(row.get("cover_url"), str):
        group["cover_url"] = row["cover_url"]
    if normalized_distance is None:
        return
    current = group.get("closest_distance_m")
    group["closest_distance_m"] = (
        min(float(current), normalized_distance)
        if isinstance(current, int | float)
        else normalized_distance
    )


def _build_nearby_groups(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    groups: dict[str, dict[str, object]] = {}
    for row in rows:
        bangumi_id = row.get("bangumi_id")
        if not isinstance(bangumi_id, str) or not bangumi_id:
            continue
        dist = _normalize_distance(row)
        group = groups.get(bangumi_id)
        if group is None:
            groups[bangumi_id] = _init_group(row, bangumi_id, dist)
        else:
            _update_group(group, row, dist)
    return list(groups.values())
