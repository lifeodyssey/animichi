"""Scripts-local httpx helpers for seeding (Bangumi metadata + Anitabi points).

The runtime agent is catalog-only and never calls these APIs directly; these
minimal helpers exist solely for manual seed scripts (see ``seed_data.py``).
"""

from __future__ import annotations

import httpx

from agent.config import get_settings
from agent.domain.entities import Coordinates, Point
from agent.utils.logger import get_logger

logger = get_logger(__name__)

BANGUMI_API_BASE = "https://api.bgm.tv"
_USER_AGENT = "Seichijunrei/1.0 (https://github.com/lifeodyssey/Seichijunrei-agent)"
_HEADERS = {"User-Agent": _USER_AGENT, "Accept": "application/json"}


async def fetch_subject(subject_id: int) -> dict[str, object]:
    """GET /v0/subjects/{id} from the Bangumi API and return the raw object."""
    url = f"{BANGUMI_API_BASE}/v0/subjects/{subject_id}"
    async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
        response = await client.get(url)
    response.raise_for_status()
    return _expect_object(response.json(), context=f"subject {subject_id}")


async def fetch_points(bangumi_id: str) -> list[Point]:
    """GET /{id}/points/detail from the Anitabi API, parsed to Point entities."""
    base = get_settings().anitabi_api_url.rstrip("/")
    url = f"{base}/{bangumi_id}/points/detail"
    async with httpx.AsyncClient(timeout=30.0, headers=_HEADERS) as client:
        response = await client.get(url, params={"haveImage": "true"})
    response.raise_for_status()
    return parse_points(response.json(), bangumi_id)


def parse_points(payload: object, bangumi_id: str) -> list[Point]:
    """Parse an Anitabi points payload into sorted Point entities."""
    items = _unwrap_items(payload)
    points: list[Point] = []
    for item in items:
        parsed = _parse_item(item, bangumi_id)
        if parsed is not None:
            points.append(parsed)
    points.sort(key=lambda p: (p.episode, p.time_seconds))
    return points


def _expect_object(value: object, *, context: str) -> dict[str, object]:
    """Narrow a JSON payload to an object at the trust boundary."""
    if not isinstance(value, dict):
        raise ValueError(f"Unexpected subject payload for {context}")
    return {str(key): item for key, item in value.items()}


def _unwrap_items(payload: object) -> list[dict[str, object]]:
    """Normalize the Anitabi response shape (list or {data|points}) to items."""
    raw = payload
    if isinstance(payload, dict):
        raw = payload.get("data") or payload.get("points")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _parse_item(item: dict[str, object], bangumi_id: str) -> Point | None:
    """Parse one point item, returning None (and logging) when invalid."""
    try:
        if "lat" in item and "lng" in item:
            return _parse_legacy_point(item, bangumi_id)
        return _parse_official_point(item, bangumi_id)
    except (KeyError, ValueError, TypeError) as exc:
        logger.warning("skipping_invalid_point", error=str(exc), data=item)
        return None


def _parse_legacy_point(item: dict[str, object], bangumi_id: str) -> Point:
    """Parse a point item that uses the legacy lat/lng schema."""
    return Point(
        id=_str(item["id"]),
        name=_str(item["name"]),
        cn_name=_str(item.get("cn_name") or item["name"]),
        coordinates=Coordinates(
            latitude=_float(item["lat"]),
            longitude=_float(item["lng"]),
        ),
        bangumi_id=_str(item.get("bangumi_id") or bangumi_id),
        bangumi_title=_str(item.get("bangumi_title") or bangumi_id),
        episode=_int_or(item.get("episode", 0)),
        time_seconds=_int_or(item.get("time_seconds", 0)),
        screenshot_url=_str(item["screenshot"]),
        origin=_str_or_none(item.get("origin")),
        origin_url=_str_or_none(item.get("origin_url") or item.get("originURL")),
    )


def _parse_official_point(item: dict[str, object], bangumi_id: str) -> Point:
    """Parse a point item that uses the official geo-array schema."""
    geo_raw = item.get("geo")
    if not isinstance(geo_raw, list) or len(geo_raw) < 2:
        raise ValueError("Missing or invalid 'geo' field")
    cn_name = _str(item.get("cn") or item.get("name") or "")
    return Point(
        id=_str(item["id"]),
        name=_str(item.get("name") or cn_name),
        cn_name=cn_name,
        coordinates=Coordinates(
            latitude=_float(geo_raw[0]), longitude=_float(geo_raw[1])
        ),
        bangumi_id=str(bangumi_id),
        bangumi_title=str(bangumi_id),
        episode=_int_or(item.get("ep", 0)),
        time_seconds=_int_or(item.get("s", 0)),
        screenshot_url=_image_url(item.get("image")),
        origin=_str_or_none(item.get("origin")),
        origin_url=_str_or_none(item.get("originURL")),
    )


def _image_url(value: object) -> str | None:
    """Qualify relative Anitabi image paths against the image host."""
    url = _str_or_none(value)
    if url and url.startswith("/"):
        return f"https://image.anitabi.cn{url}"
    return url


def _str(value: object) -> str:
    """Narrow a JSON value to str at the trust boundary."""
    if isinstance(value, str):
        return value
    return str(value) if value is not None else ""


def _str_or_none(value: object) -> str | None:
    """Narrow a JSON value to str or None."""
    if value is None:
        return None
    return str(value)


def _float(value: object) -> float:
    """Narrow a JSON value to float at the trust boundary."""
    if isinstance(value, (int, float)):
        return float(value)
    return float(str(value))


def _int_or(value: object, default: int = 0) -> int:
    """Narrow a JSON value to int with fallback."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if value is None:
        return default
    try:
        return int(str(value))
    except (ValueError, TypeError):
        return default
