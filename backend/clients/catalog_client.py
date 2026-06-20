"""Typed async client for the Catalog service (skeleton).

The Catalog service owns the read path for resolved pilgrimage data. This client
is the agent-side stub the runtime will call instead of touching catalog tables
directly; the real Catalog server is built in a later wave. It exposes the four
RPC methods (search / spots / nearby / route) over httpx with basic retry, and
parses each response into the shared typed models.

Field names, paths, and response envelopes mirror the single source of truth in
``packages/contract`` (see contract.ts / models.ts):
  - search(query, origin?)        -> {"rows": [...], "synced_at": str}
  - spots(bangumi_id, origin?)    -> {"point": {...}, "distance_m"?: float}
  - nearby(lat, lng, radius_m)    -> {"rows": [...]}
  - route(point_ids, origin?, pacing?) -> Route

Endpoint convention: ``{base_url}/catalog/<method>`` (POST, JSON body).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol, runtime_checkable

import httpx
from pydantic import BaseModel, Field

from backend.agents.models import TimedItinerary, TimedStop, TransitLeg
from backend.clients.base import JSONDict, JSONValue, expect_json_object
from backend.clients.errors import APIError
from backend.clients.retry import request_with_retry

# Re-exported so callers depend on this client, not on agent internals.
__all__ = [
    "PilgrimagePoint",
    "Route",
    "TimedItinerary",
    "TimedStop",
    "TransitLeg",
    "CatalogClient",
    "CatalogClientProtocol",
]


class PilgrimagePoint(BaseModel):
    """A single pilgrimage point returned by the Catalog service."""

    id: str
    name: str
    name_cn: str = ""
    episode: int = -1
    time_seconds: int = -1
    screenshot_url: str = ""
    bangumi_id: str = ""
    latitude: float
    longitude: float
    title: str = ""
    title_cn: str = ""
    distance_m: float = -1.0
    origin: str = ""
    cover_url: str = ""


class Route(BaseModel):
    """An ordered route plus its timed itinerary."""

    ordered_points: list[PilgrimagePoint] = Field(default_factory=list)
    point_count: int = 0
    cover_url: str = ""
    anime_title: str = ""
    anime_title_cn: str = ""
    timed_itinerary: TimedItinerary = Field(default_factory=TimedItinerary)


@runtime_checkable
class CatalogClientProtocol(Protocol):
    """Structural contract for the Catalog read path (search/spots/nearby/route).

    Both the live :class:`CatalogClient` and the test ``MockCatalogClient``
    satisfy this Protocol, so the agent depends on the abstraction — never on a
    concrete client, the DB, or upstream Anitabi/Bangumi clients.
    """

    async def search(self, query: str) -> list[PilgrimagePoint]: ...

    async def spots(self, bangumi_id: str) -> PilgrimagePoint: ...

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]: ...

    async def route(self, point_ids: list[str]) -> Route: ...


class CatalogClient:
    """Async client for the four Catalog RPC methods."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 30.0,
        max_retries: int = 3,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries

    async def search(self, query: str) -> list[PilgrimagePoint]:
        """Resolve a free-text query to its pilgrimage points."""
        payload = await self._rpc("search", {"query": query})
        return _parse_rows(payload)

    async def spots(self, bangumi_id: str) -> PilgrimagePoint:
        """Return a single pilgrimage point for the given work id."""
        payload = await self._rpc("spots", {"bangumi_id": bangumi_id})
        return _parse_point(payload)

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        """Return pilgrimage points near a coordinate within ``radius_m``."""
        body = {"lat": lat, "lng": lng, "radius_m": radius_m}
        payload = await self._rpc("nearby", body)
        return _parse_rows(payload)

    async def route(self, point_ids: list[str]) -> Route:
        """Plan an ordered, timed route across the given points."""
        payload = await self._rpc("route", {"point_ids": point_ids})
        return Route.model_validate(payload)

    async def _rpc(self, method: str, body: Mapping[str, object]) -> JSONValue:
        """POST ``body`` to the method endpoint and return the parsed JSON."""
        url = f"{self._base_url}/catalog/{method}"
        return await request_with_retry(
            max_retries=self._max_retries,
            make_request=lambda: self._post_json(url, body),
            url=url,
            method_label="POST",
        )

    async def _post_json(self, url: str, body: Mapping[str, object]) -> JSONValue:
        """Perform one POST attempt, raising ``APIError`` on HTTP failure."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(url, json=body)
        if response.status_code >= 400:
            raise APIError(f"HTTP {response.status_code} from {url}")
        parsed: object = response.json()
        return _as_json_object(parsed)


def _as_json_object(value: object) -> JSONDict:
    """Narrow an opaque JSON payload to an object (all 4 RPCs return objects)."""
    if not isinstance(value, dict):
        raise APIError("Expected a JSON object response")
    return {str(key): item for key, item in value.items()}


def _parse_rows(payload: JSONValue) -> list[PilgrimagePoint]:
    """Validate a ``{"rows": [...]}`` envelope into typed pilgrimage points."""
    envelope = expect_json_object(payload, context="rows")
    rows = envelope.get("rows")
    if not isinstance(rows, list):
        raise APIError("Expected 'rows' to be a JSON array of points")
    return [PilgrimagePoint.model_validate(row) for row in rows]


def _parse_point(payload: JSONValue) -> PilgrimagePoint:
    """Validate a ``{"point": {...}, "distance_m"?: float}`` envelope."""
    envelope = expect_json_object(payload, context="point")
    point = envelope.get("point")
    if not isinstance(point, dict):
        raise APIError("Expected 'point' to be a JSON object")
    return PilgrimagePoint.model_validate(point)
