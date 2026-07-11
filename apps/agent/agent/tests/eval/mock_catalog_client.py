"""Deterministic in-memory MockCatalogClient for offline agent evals."""

from __future__ import annotations

from agent.agents.geo_utils import haversine_distance
from agent.agents.models import TimedItinerary, TimedStop, TransitLeg
from agent.clients.catalog_client import IngestResult, PilgrimagePoint, Route
from agent.clients.errors import APIError
from agent.tests.eval.mock_catalog_fixtures import (
    FIXTURE_POINTS,
    LOCATION_CENTERS,
    TITLE_ALIASES,
    TITLE_NAMES,
)

__all__ = [
    "FIXTURE_POINTS",
    "LOCATION_CENTERS",
    "MockCatalogClient",
    "TITLE_ALIASES",
    "TITLE_NAMES",
    "_LOCATION_CENTERS",
    "_TITLE_ALIASES",
]

_TITLE_ALIASES = TITLE_ALIASES
_LOCATION_CENTERS = LOCATION_CENTERS
_POINT_INDEX: dict[str, PilgrimagePoint] = {
    point.id: point for points in FIXTURE_POINTS.values() for point in points
}


class MockCatalogClient:
    """In-memory stand-in for :class:`CatalogClient` with fixture data."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def search(self, query: str) -> list[PilgrimagePoint]:
        self.calls.append(("search", (query,)))
        bangumi_id = self._match_title(query)
        if bangumi_id is None or bangumi_id not in FIXTURE_POINTS:
            return []
        return [point.model_copy(deep=True) for point in FIXTURE_POINTS[bangumi_id]]

    async def spots(self, bangumi_id: str) -> PilgrimagePoint:
        self.calls.append(("spots", (bangumi_id,)))
        points = FIXTURE_POINTS.get(bangumi_id)
        if not points:
            raise APIError(f"No catalog point for bangumi_id={bangumi_id!r}")
        return points[0].model_copy(deep=True)

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        self.calls.append(("nearby", (lat, lng, radius_m)))
        scored = self._within_radius(lat, lng, radius_m)
        return [point for _, point in sorted(scored, key=lambda item: item[0])]

    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route:
        self.calls.append(("route", (tuple(point_ids), origin)))
        ordered = [
            _POINT_INDEX[pid].model_copy(deep=True)
            for pid in point_ids
            if pid in _POINT_INDEX
        ]
        return _build_route(ordered)

    async def ingest(self, bangumi_id: str) -> IngestResult:
        self.calls.append(("ingest", (bangumi_id,)))
        status = "ingested" if bangumi_id in FIXTURE_POINTS else "empty"
        return IngestResult(
            status=status, point_count=len(FIXTURE_POINTS.get(bangumi_id, []))
        )

    async def near_location(self, name: str) -> list[PilgrimagePoint]:
        center = self._match_location(name)
        if center is None:
            return []
        lat, lng, _ = center
        scored = self._within_radius(lat, lng, radius_m=5000)
        return [point for _, point in sorted(scored, key=lambda item: item[0])]

    @staticmethod
    def _match_title(query: str) -> str | None:
        q = query.lower()
        for alias, bangumi_id in _TITLE_ALIASES.items():
            if alias in q:
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
    stops = [_stop(point, index) for index, point in enumerate(ordered)]
    legs = [_leg(ordered[i], ordered[i + 1]) for i in range(len(ordered) - 1)]
    return TimedItinerary(
        stops=stops,
        legs=legs,
        total_minutes=sum(leg.duration_minutes for leg in legs) + 30 * len(stops),
        total_distance_m=round(sum(leg.distance_m for leg in legs), 1),
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
