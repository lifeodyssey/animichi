"""Deterministic in-memory MockCatalogClient for the agent eval.

The agent's tools will (in the hybrid architecture) call the Catalog service via
:class:`agent.clients.catalog_client.CatalogClient` instead of touching the DB
or Anitabi directly. This mock implements that same interface against a small,
hand-seeded fixture so the eval can run fast, deterministically, and with no real
DB / network.

Contract mirrored from ``CatalogClient`` (search / spots / nearby / route),
returning the shared typed models ``PilgrimagePoint`` and ``Route``:

  - search(query)                  -> list[PilgrimagePoint]
  - spots(bangumi_id)              -> PilgrimagePoint
  - nearby(lat, lng, radius_m=...) -> list[PilgrimagePoint]
  - route(point_ids, origin?)      -> Route

Seeding policy (mirrors the eval's DataCompleteness baseline):
  - Well-known resolvable anime (e.g. 君の名は。/ 響け！ユーフォニアム) and known
    locations (Kyoto, Uji) return seeded points.
  - Unknown titles / coordinates / point ids return empty results (search/nearby)
    or raise ``APIError`` (spots), matching how the real client signals "no data".

NOTE (W2-A1, landed): the production seam now exists. ``RuntimeDeps`` carries an
optional ``catalog`` client and the four data tools route through it, so this mock
can be injected directly into ``run_pilgrimage_agent`` (see
``test_agent_eval_mock_runtime.py``). It satisfies
``agent.clients.catalog_client.CatalogClientProtocol``.
"""

from __future__ import annotations

from agent.agents.geo_utils import haversine_distance
from agent.agents.models import TimedItinerary, TimedStop, TransitLeg
from agent.clients.catalog_client import PilgrimagePoint, Route
from agent.clients.errors import APIError

__all__ = ["MockCatalogClient", "FIXTURE_POINTS"]


def _point(
    *,
    pid: str,
    name: str,
    name_cn: str,
    bangumi_id: str,
    lat: float,
    lng: float,
    title: str,
    title_cn: str,
    episode: int = 1,
) -> PilgrimagePoint:
    """Build a fully-populated seeded pilgrimage point."""
    return PilgrimagePoint(
        id=pid,
        name=name,
        name_cn=name_cn,
        episode=episode,
        bangumi_id=bangumi_id,
        latitude=lat,
        longitude=lng,
        title=title,
        title_cn=title_cn,
        cover_url=f"https://example.test/cover/{bangumi_id}.jpg",
        screenshot_url=f"https://example.test/shot/{pid}.jpg",
    )


# ── Seed fixture ──────────────────────────────────────────────────────
# A handful of well-known works keyed by their bangumi_id. Titles, including
# CN/EN aliases, are matched case-insensitively as substrings of the query so
# the eval's resolvable cases (ja/zh/en) all find data.

_KIMINONAWA = "160209"
_EUPHONIUM = "100403"

FIXTURE_POINTS: dict[str, list[PilgrimagePoint]] = {
    _KIMINONAWA: [
        _point(
            pid="p_kimi_1",
            name="須賀神社の階段",
            name_cn="须贺神社的台阶",
            bangumi_id=_KIMINONAWA,
            lat=35.7126,
            lng=139.7286,
            title="君の名は。",
            title_cn="你的名字",
        ),
        _point(
            pid="p_kimi_2",
            name="四谷",
            name_cn="四谷",
            bangumi_id=_KIMINONAWA,
            lat=35.6862,
            lng=139.7300,
            title="君の名は。",
            title_cn="你的名字",
            episode=2,
        ),
    ],
    _EUPHONIUM: [
        _point(
            pid="p_euph_1",
            name="宇治橋",
            name_cn="宇治桥",
            bangumi_id=_EUPHONIUM,
            lat=34.8915,
            lng=135.8075,
            title="響け！ユーフォニアム",
            title_cn="吹响悠风号",
        ),
        _point(
            pid="p_euph_2",
            name="京阪宇治駅",
            name_cn="京阪宇治站",
            bangumi_id=_EUPHONIUM,
            lat=34.8920,
            lng=135.8110,
            title="響け！ユーフォニアム",
            title_cn="吹响悠风号",
            episode=3,
        ),
    ],
}

# Title aliases (lower-cased substrings) -> bangumi_id, for free-text search().
_TITLE_ALIASES: dict[str, str] = {
    "君の名は": _KIMINONAWA,
    "你的名字": _KIMINONAWA,
    "your name": _KIMINONAWA,
    "響け": _EUPHONIUM,
    "ユーフォニアム": _EUPHONIUM,
    "吹响": _EUPHONIUM,
    "悠风号": _EUPHONIUM,
    "euphonium": _EUPHONIUM,
}

# Location aliases (lower-cased substrings) -> bangumi_id whose points are nearby.
_LOCATION_CENTERS: dict[str, tuple[float, float, str]] = {
    # name substring -> (lat, lng, bangumi_id)
    "uji": (34.8915, 135.8075, _EUPHONIUM),
    "宇治": (34.8915, 135.8075, _EUPHONIUM),
    "kyoto": (34.9858, 135.7588, _EUPHONIUM),
    "京都": (34.9858, 135.7588, _EUPHONIUM),
}

_POINT_INDEX: dict[str, PilgrimagePoint] = {
    p.id: p for points in FIXTURE_POINTS.values() for p in points
}


class MockCatalogClient:
    """In-memory stand-in for :class:`CatalogClient` with seeded fixture data."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def search(self, query: str) -> list[PilgrimagePoint]:
        """Resolve a free-text query to seeded points; empty if unknown."""
        self.calls.append(("search", (query,)))
        bangumi_id = self._match_title(query)
        if bangumi_id is None:
            return []
        return [p.model_copy(deep=True) for p in FIXTURE_POINTS[bangumi_id]]

    async def spots(self, bangumi_id: str) -> PilgrimagePoint:
        """Return the first seeded point for a work; raise if unknown."""
        self.calls.append(("spots", (bangumi_id,)))
        points = FIXTURE_POINTS.get(bangumi_id)
        if not points:
            raise APIError(f"No catalog point for bangumi_id={bangumi_id!r}")
        return points[0].model_copy(deep=True)

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        """Return seeded points within ``radius_m`` of a coordinate, by distance."""
        self.calls.append(("nearby", (lat, lng, radius_m)))
        scored = self._within_radius(lat, lng, radius_m)
        return [p for _, p in sorted(scored, key=lambda sp: sp[0])]

    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route:
        """Plan an ordered, timed route across known seeded points."""
        self.calls.append(("route", (tuple(point_ids), origin)))
        ordered = [
            _POINT_INDEX[pid].model_copy(deep=True)
            for pid in point_ids
            if pid in _POINT_INDEX
        ]
        return _build_route(ordered)

    async def near_location(self, name: str) -> list[PilgrimagePoint]:
        """Test helper: resolve a place name to its seeded nearby points."""
        center = self._match_location(name)
        if center is None:
            return []
        lat, lng, _ = center
        scored = self._within_radius(lat, lng, radius_m=5000)
        return [p for _, p in sorted(scored, key=lambda sp: sp[0])]

    @staticmethod
    def _match_title(query: str) -> str | None:
        q = query.lower()
        for alias, bangumi_id in _TITLE_ALIASES.items():
            if alias.lower() in q:
                return bangumi_id
        return None

    @staticmethod
    def _match_location(name: str) -> tuple[float, float, str] | None:
        q = name.lower()
        for alias, center in _LOCATION_CENTERS.items():
            if alias in q:
                return center
        return None

    @staticmethod
    def _within_radius(
        lat: float, lng: float, radius_m: int
    ) -> list[tuple[float, PilgrimagePoint]]:
        scored: list[tuple[float, PilgrimagePoint]] = []
        for point in _POINT_INDEX.values():
            dist = haversine_distance(lat, lng, point.latitude, point.longitude)
            if dist <= radius_m:
                clone = point.model_copy(deep=True)
                clone.distance_m = round(dist, 1)
                scored.append((dist, clone))
        return scored


def _build_route(ordered: list[PilgrimagePoint]) -> Route:
    """Assemble a deterministic timed itinerary over ordered points."""
    if not ordered:
        return Route()
    return Route(
        ordered_points=ordered,
        point_count=len(ordered),
        cover_url=ordered[0].cover_url,
        anime_title=ordered[0].title,
        anime_title_cn=ordered[0].title_cn,
        timed_itinerary=_build_itinerary(ordered),
    )


def _build_itinerary(ordered: list[PilgrimagePoint]) -> TimedItinerary:
    """Build a simple deterministic itinerary: 30-min dwell, walking legs."""
    stops = [_stop(point, index) for index, point in enumerate(ordered)]
    legs = [_leg(ordered[i], ordered[i + 1]) for i in range(len(ordered) - 1)]
    total_distance = sum(leg.distance_m for leg in legs)
    total_minutes = sum(leg.duration_minutes for leg in legs) + 30 * len(stops)
    return TimedItinerary(
        stops=stops,
        legs=legs,
        total_minutes=total_minutes,
        total_distance_m=round(total_distance, 1),
        spot_count=len(stops),
    )


def _stop(point: PilgrimagePoint, index: int) -> TimedStop:
    arrive_hour = 9 + index
    return TimedStop(
        cluster_id=point.id,
        name=point.name,
        arrive=f"{arrive_hour:02d}:00",
        depart=f"{arrive_hour:02d}:30",
        dwell_minutes=30,
        lat=point.latitude,
        lng=point.longitude,
        photo_count=1,
    )


def _leg(src: PilgrimagePoint, dst: PilgrimagePoint) -> TransitLeg:
    distance = haversine_distance(
        src.latitude, src.longitude, dst.latitude, dst.longitude
    )
    return TransitLeg(
        from_id=src.id,
        to_id=dst.id,
        mode="walk",
        duration_minutes=max(1, round(distance / 80)),
        distance_m=round(distance, 1),
    )
