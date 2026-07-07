"""Typed async client for the Catalog service.

The Catalog service owns the read path for resolved pilgrimage data. This
client is the agent-side adapter the runtime calls instead of touching catalog
tables directly. It exposes the RPC methods (search / spots / nearby / route /
ingest) over a shared ``httpx.AsyncClient`` with status-based retry, and
parses each response into the shared typed models.

Field names, paths, and response envelopes mirror the single source of truth in
``packages/contract`` (see contract.ts / models.ts):
  - search(query, origin?)        -> {"rows": [...], "synced_at": str}
  - spots(bangumi_id, origin?)    -> {"point": {...}, "distance_m"?: float}
  - nearby(lat, lng, radius_m)    -> {"rows": [...]}
  - route(point_ids, origin?, pacing?) -> Route
  - ingest(bangumi_id)            -> IngestResult

Endpoint convention: ``{base_url}/catalog/<method>`` (POST, JSON body).

Retry policy: 5xx responses, transport errors, and the transient 4xx codes
(408 request timeout, 429 rate limit) are retried with exponential backoff;
all other 4xx responses raise immediately.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Literal, Protocol, runtime_checkable

import httpx
import structlog
from pydantic import BaseModel, Field

from agent.agents.models import TimedItinerary, TimedStop, TransitLeg
from agent.clients.errors import APIError, TransientAPIError

logger = structlog.get_logger(__name__)

# Re-exported so callers depend on this client, not on agent internals.
__all__ = [
    "PilgrimagePoint",
    "Route",
    "IngestResult",
    "TimedItinerary",
    "TimedStop",
    "TransitLeg",
    "CatalogClient",
    "CatalogClientProtocol",
]

JSONDict = dict[str, object]


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


class IngestResult(BaseModel):
    """Outcome of an on-demand ingest, mirroring the contract IngestResult.

    Discriminated by ``status``: ``version`` + ``point_count`` are set only for
    ``ingested``; ``reason`` carries the cause for ``empty`` / ``failed``.
    """

    status: Literal["ingested", "in_progress", "empty", "failed"]
    version: int = -1
    point_count: int = -1
    reason: str = ""


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

    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route: ...

    async def ingest(self, bangumi_id: str) -> IngestResult: ...


class CatalogClient:
    """Async client for the Catalog RPC methods over a shared httpx client."""

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
        self._client: httpx.AsyncClient | None = None

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

    async def route(
        self, point_ids: list[str], *, origin: tuple[float, float] | None = None
    ) -> Route:
        """Plan an ordered, timed route across the given points."""
        body: dict[str, object] = {"point_ids": point_ids}
        if origin is not None:
            body["origin"] = {"lat": origin[0], "lng": origin[1]}
        payload = await self._rpc("route", body)
        return Route.model_validate(payload)

    async def ingest(self, bangumi_id: str) -> IngestResult:
        """Ingest a not-yet-cataloged work on demand by its bangumi id.

        Retried transient failures (5xx, 408/429, transport errors) may
        re-send this write; safe to retry because it relies on the catalog
        side performing an idempotent upsert keyed by ``bangumi_id``.
        """
        payload = await self._rpc("ingest", {"bangumi_id": bangumi_id})
        return IngestResult.model_validate(payload)

    async def aclose(self) -> None:
        """Close the shared HTTP client (no-op when never used)."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    def _http(self) -> httpx.AsyncClient:
        """Return the shared httpx client, creating it lazily."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def _rpc(self, method: str, body: Mapping[str, object]) -> JSONDict:
        """POST ``body`` to the method endpoint with retry on transient errors."""
        url = f"{self._base_url}/catalog/{method}"
        return await _with_retry(
            lambda: self._post_json(url, body),
            max_retries=self._max_retries,
            url=url,
        )

    async def _post_json(self, url: str, body: Mapping[str, object]) -> JSONDict:
        """Perform one POST attempt, raising ``APIError`` on failure."""
        try:
            response = await self._http().post(url, json=body)
        except httpx.HTTPError as exc:
            raise TransientAPIError(f"Transport failure for {url}: {exc}") from exc
        _raise_for_status(response.status_code, url)
        parsed: object = response.json()
        return _expect_object(parsed, context=url)


async def _with_retry(
    make_request: Callable[[], Awaitable[JSONDict]],
    *,
    max_retries: int,
    url: str,
) -> JSONDict:
    """Run ``make_request`` retrying transient failures with backoff."""
    for attempt in range(max_retries - 1):
        try:
            return await make_request()
        except TransientAPIError as exc:
            delay = min(2**attempt, 30)
            logger.warning(
                "catalog_rpc_retry", url=url, error=str(exc), next_delay=delay
            )
            await asyncio.sleep(delay)
    return await make_request()


_TRANSIENT_4XX_STATUS_CODES = frozenset({408, 429})


def _raise_for_status(status_code: int, url: str) -> None:
    """Map HTTP status to error class.

    5xx and the transient 4xx codes (408 request timeout, 429 rate limit) are
    retried; all other 4xx responses raise immediately. This mirrors
    ``public_api._is_provider_error``, which treats 429/502/503 as transient.
    """
    if status_code >= 500 or status_code in _TRANSIENT_4XX_STATUS_CODES:
        raise TransientAPIError(f"HTTP {status_code} from {url}")
    if status_code >= 400:
        raise APIError(f"HTTP {status_code} from {url}")


def _expect_object(value: object, *, context: str) -> JSONDict:
    """Narrow an opaque JSON payload to an object (all RPCs return objects)."""
    if not isinstance(value, dict):
        raise APIError(f"Expected a JSON object response from {context}")
    return {str(key): item for key, item in value.items()}


def _parse_rows(payload: JSONDict) -> list[PilgrimagePoint]:
    """Validate a ``{"rows": [...]}`` envelope into typed pilgrimage points."""
    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise APIError("Expected 'rows' to be a JSON array of points")
    return [PilgrimagePoint.model_validate(row) for row in rows]


def _parse_point(payload: JSONDict) -> PilgrimagePoint:
    """Validate a ``{"point": {...}, "distance_m"?: float}`` envelope."""
    point = payload.get("point")
    if not isinstance(point, dict):
        raise APIError("Expected 'point' to be a JSON object")
    return PilgrimagePoint.model_validate(point)
