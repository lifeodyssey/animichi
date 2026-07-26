"""Typed async client for the Catalog service.

The Catalog service owns the resolved pilgrimage read path. This typed adapter
mirrors ``packages/contract`` for search, spots, nearby, route, and ingest RPCs
over one shared ``httpx.AsyncClient``.

Endpoint convention: ``{base_url}/catalog/<method>`` (POST, JSON body).

Retry policy: 5xx responses, transport errors, and the transient 4xx codes
(408 request timeout, 429 rate limit) are retried with exponential backoff;
all other 4xx responses raise immediately.

Retryable statuses are classified without reading their transport streams.
Non-retryable error responses return to httpx for buffering, then are parsed
as oRPC error envelopes (``catalog_errors``) into typed ``CatalogError``
exceptions. Undefined errors keep the legacy status-based classification.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Annotated, Literal, Protocol, Self, TypeAlias, runtime_checkable

import anyio
import httpx
import structlog
from pydantic import BaseModel, Field, TypeAdapter, model_validator
from pydantic_ai.retries import AsyncTenacityTransport, RetryConfig
from tenacity import (
    RetryCallState,
    retry_if_exception_type,
    retry_if_result,
    stop_after_attempt,
    wait_exponential,
)

from agent.agents.models import TimedItinerary, TimedStop, TransitLeg
from agent.clients.catalog_errors import parse_catalog_error
from agent.clients.errors import APIError, TransientAPIError
from agent.clients.geocode import GeocodeCandidate, GeocodeKind, GeocodeSource

logger = structlog.get_logger(__name__)

CATALOG_REQUEST_TIMEOUT_SECONDS = 25.0
CATALOG_TOTAL_TIMEOUT_SECONDS = 80.0
_TRANSIENT_STATUS_CODES = frozenset({408, 429})
_CATALOG_HTTP_LIMITS = httpx.Limits(
    max_connections=20,
    max_keepalive_connections=10,
    keepalive_expiry=30.0,
)

# Re-exported so callers depend on this client, not on agent internals.
__all__ = [
    "PilgrimagePoint",
    "AnimeCandidate",
    "ResolveOutcome",
    "SearchResult",
    "Route",
    "IngestResult",
    "TimedItinerary",
    "TimedStop",
    "TransitLeg",
    "CatalogClient",
    "CatalogClientProtocol",
    "GeocodeCandidate",
    "GeocodeKind",
    "GeocodeSource",
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
    city: str | None = None


class AnimeCandidate(BaseModel):
    """Trusted resolver candidate mirrored from the catalog contract."""

    bangumi_id: str
    title: str
    title_cn: str = ""
    cover_url: str = ""
    year: int | None = None
    points_count: int = 0


class ResolveResolved(BaseModel):
    outcome: Literal["resolved"]
    match: AnimeCandidate


class ResolveAmbiguous(BaseModel):
    outcome: Literal["needs_disambiguation"]
    reason: Literal["anime_ambiguity"]
    candidates: list[AnimeCandidate] = Field(min_length=2, max_length=6)


class ResolveNotFound(BaseModel):
    outcome: Literal["not_found"]
    reason: Literal["anime_not_found"]


class ResolveUpstreamUnavailable(BaseModel):
    outcome: Literal["upstream_unavailable"]
    provider: Literal["bangumi", "anitabi"]


ResolveOutcome: TypeAlias = Annotated[
    ResolveResolved | ResolveAmbiguous | ResolveNotFound | ResolveUpstreamUnavailable,
    Field(discriminator="outcome"),
]


class SearchResult(BaseModel):
    """Published point result returned by search and pointsByWorkId."""

    rows: list[PilgrimagePoint] = Field(default_factory=list)
    synced_at: str = ""
    partial: bool = False


class Route(BaseModel):
    """An ordered route plus its timed itinerary."""

    ordered_points: list[PilgrimagePoint] = Field(default_factory=list)
    point_count: int = 0
    cover_url: str = ""
    anime_title: str = ""
    anime_title_cn: str = ""
    timed_itinerary: TimedItinerary = Field(default_factory=TimedItinerary)

    @model_validator(mode="after")
    def _match_point_count(self) -> Self:
        if self.point_count != len(self.ordered_points):
            raise ValueError("point_count must match ordered_points")
        return self


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

    async def resolve(self, query: str) -> ResolveOutcome: ...

    async def points_by_work_id(self, work_id: str) -> SearchResult: ...

    async def spots(self, bangumi_id: str) -> PilgrimagePoint: ...

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]: ...

    async def geocode(
        self, query: str, *, limit: int = 5
    ) -> list[GeocodeCandidate]: ...

    async def route(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Route: ...

    async def ingest(self, bangumi_id: str) -> IngestResult: ...


class CatalogClient:
    """Async client for the Catalog RPC methods over a shared httpx client.

    Lifecycle: one ``httpx.AsyncClient`` is built on first use and reused by
    every RPC, so the hot agent path keeps httpx's connection pool and
    keep-alive instead of re-handshaking per call. The owner — the FastAPI
    lifespan in ``fastapi_service._lifespan_build_runtime`` — calls
    :meth:`aclose` at shutdown. A closed client is never rebuilt: resurrecting
    one would leak a pool nobody closes, and rebuilding an injected
    ``http_client`` would silently escape its transport seam onto the network.
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = CATALOG_REQUEST_TIMEOUT_SECONDS,
        max_retries: int = 3,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_retries = max_retries
        self._client = http_client

    async def search(self, query: str) -> list[PilgrimagePoint]:
        """Resolve a free-text query to its pilgrimage points."""
        payload = await self._rpc("search", {"query": query})
        return _parse_rows(payload)

    async def resolve(self, query: str) -> ResolveOutcome:
        """Resolve free text to a deterministic typed anime outcome."""
        payload = await self._rpc("resolve", {"query": query})
        return TypeAdapter(ResolveOutcome).validate_python(payload)

    async def points_by_work_id(self, work_id: str) -> SearchResult:
        """Fetch published points for an already-resolved work id."""
        payload = await self._rpc("points-by-work-id", {"work_id": work_id})
        return SearchResult.model_validate(payload)

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

    async def geocode(self, query: str, *, limit: int = 5) -> list[GeocodeCandidate]:
        """Resolve a place name against the Catalog's local gazetteer."""
        payload = await self._rpc("geocode", {"query": query, "limit": limit})
        candidates = payload.get("candidates")
        if not isinstance(candidates, list):
            raise APIError("Expected 'candidates' to be a JSON array")
        return [GeocodeCandidate.model_validate(item) for item in candidates]

    async def route(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Route:
        """Plan an ordered, timed route across the given points."""
        body: dict[str, object] = {"point_ids": point_ids}
        if origin is not None:
            body["origin"] = {"lat": origin[0], "lng": origin[1]}
        if pacing is not None:
            body["pacing"] = pacing
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
        """Close the shared HTTP client (idempotent; no-op when never used)."""
        if self._client is None or self._client.is_closed:
            return
        await self._client.aclose()

    def _http(self) -> httpx.AsyncClient:
        """Return the shared httpx client, built exactly once on first use.

        A closed client is deliberately never rebuilt — see ``aclose``.
        """
        if self._client is None:
            self._client = self._build_http_client()
        return self._client

    def _build_http_client(self) -> httpx.AsyncClient:
        wrapped = httpx.AsyncHTTPTransport(
            trust_env=True,
            limits=_CATALOG_HTTP_LIMITS,
        )
        transport = AsyncTenacityTransport(
            _retry_config(self._max_retries), wrapped=wrapped
        )
        return httpx.AsyncClient(timeout=self._timeout, transport=transport)

    async def _rpc(self, method: str, body: Mapping[str, object]) -> JSONDict:
        """POST ``body`` to the method endpoint with retry on transient errors."""
        url = f"{self._base_url}/catalog/{method}"
        return await self._post_json(url, body)

    async def _post_json(self, url: str, body: Mapping[str, object]) -> JSONDict:
        """Perform one POST attempt, raising ``APIError`` on failure."""
        try:
            with anyio.fail_after(CATALOG_TOTAL_TIMEOUT_SECONDS):
                response = await self._http().post(url, json=body)
        except TimeoutError as exc:
            message = (
                f"Catalog request exceeded {CATALOG_TOTAL_TIMEOUT_SECONDS}s: {url}"
            )
            raise TransientAPIError(message) from exc
        except httpx.HTTPError as exc:
            raise TransientAPIError(f"Transport failure for {url}: {exc}") from exc
        _raise_for_error(response, url)
        parsed: object = response.json()
        return _expect_object(parsed, context=url)


def _retry_config(max_attempts: int) -> RetryConfig:
    """Map the legacy retry budget and classifier onto tenacity."""
    return RetryConfig(
        retry=(
            retry_if_exception_type(httpx.TransportError)
            | retry_if_result(_is_retryable_response)
        ),
        wait=wait_exponential(multiplier=1, max=30),
        stop=stop_after_attempt(max(max_attempts, 1)),
        reraise=False,
        before_sleep=_log_retry,
        retry_error_callback=_return_last_response,
        sleep=asyncio.sleep,
    )


async def _log_retry(state: RetryCallState) -> None:
    """Preserve the retry warning at the official transport boundary."""
    outcome = state.outcome
    error = outcome.exception() if outcome is not None else None
    response = outcome.result() if outcome is not None and not outcome.failed else None
    request = state.args[0] if state.args else None
    url = str(request.url) if isinstance(request, httpx.Request) else ""
    delay = state.next_action.sleep if state.next_action is not None else 0
    status = response.status_code if isinstance(response, httpx.Response) else None
    logger.warning(
        "catalog_rpc_retry", url=url, error=str(error), status=status, next_delay=delay
    )
    if isinstance(response, httpx.Response):
        await response.aclose()


def _is_retryable_response(response: object) -> bool:
    """Classify retryable statuses without consuming the response stream."""
    if not isinstance(response, httpx.Response):
        return False
    status = response.status_code
    return status >= 500 or status in _TRANSIENT_STATUS_CODES


def _return_last_response(state: RetryCallState) -> httpx.Response:
    """Return a final retryable response; re-raise an exhausted transport error."""
    if state.outcome is None:
        raise RuntimeError("Catalog retry completed without an outcome")
    result: object = state.outcome.result()
    if not isinstance(result, httpx.Response):
        raise RuntimeError("Catalog retry returned a non-response outcome")
    return result


def _raise_for_error(response: httpx.Response, url: str) -> None:
    """Raise a typed error for a >= 400 response (oRPC-envelope-aware).

    The body is parsed by ``catalog_errors.parse_catalog_error``: defined
    codes yield typed ``CatalogError`` exceptions; anything else falls back
    to the legacy status heuristic (5xx/408/429 transient, other 4xx raise
    immediately, mirroring ``public_api._is_provider_error``).
    """
    if response.status_code < 400:
        return
    raise parse_catalog_error(response.status_code, _safe_json(response), url)


def _safe_json(response: httpx.Response) -> object:
    """Best-effort JSON body; ``None`` when the body is not JSON."""
    try:
        return response.json()
    except ValueError:
        return None


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
