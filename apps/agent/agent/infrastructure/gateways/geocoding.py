"""Google Geocoding API gateway for resolving addresses to coordinates."""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import httpx
import structlog

logger = structlog.get_logger(__name__)

_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


@dataclass(frozen=True, slots=True)
class GeocodingCandidate:
    """A single geocoding result with display label and coordinates."""

    label: str  # e.g. "藤沢駅, 神奈川県藤沢市"
    lat: float
    lng: float


def _parse_candidate(item: object) -> GeocodingCandidate | None:
    """Extract a candidate from a single API result object."""
    if not isinstance(item, Mapping):
        return None
    label = item.get("formatted_address")
    if not isinstance(label, str):
        return None
    geometry = item.get("geometry")
    if not isinstance(geometry, Mapping):
        return None
    location = geometry.get("location")
    if not isinstance(location, Mapping):
        return None
    lat = location.get("lat")
    lng = location.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    return GeocodingCandidate(label=label, lat=float(lat), lng=float(lng))


def _parse_results(body: object, max_results: int) -> list[GeocodingCandidate]:
    """Parse up to *max_results* candidates from a geocode response body."""
    if not isinstance(body, Mapping):
        return []
    results = body.get("results")
    if not isinstance(results, list):
        return []
    parsed = (_parse_candidate(item) for item in results[:max_results])
    return [candidate for candidate in parsed if candidate is not None]


def _build_params(address: str) -> dict[str, str] | None:
    """Build request params, or None when the API key is missing."""
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not api_key:
        logger.warning("google_geocoding_skipped", reason="GOOGLE_MAPS_API_KEY not set")
        return None
    return {"address": address, "key": api_key, "region": "jp", "language": "ja"}


async def _fetch_geocode_body(params: Mapping[str, str]) -> object | None:
    """GET the geocode endpoint and return the parsed body, or None on error.

    Proxy configuration (HTTPS_PROXY) is honored via httpx ``trust_env``.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(_GEOCODE_URL, params=params)
    if response.status_code != 200:
        logger.warning("google_geocoding_http_error", status=response.status_code)
        return None
    body: object = response.json()
    return body


def _log_outcome(
    address: str, candidates: list[GeocodingCandidate]
) -> Sequence[GeocodingCandidate]:
    """Log the lookup outcome and normalize the empty case to ``()``."""
    if not candidates:
        logger.info("google_geocoding_no_results", address=address)
        return ()
    logger.info(
        "google_geocoding_resolved",
        address=address,
        count=len(candidates),
        first=candidates[0].label,
    )
    return candidates


class GoogleGeocodingGateway:
    """Resolve an address string to coordinates via Google Geocoding API."""

    async def geocode(self, address: str) -> tuple[float, float] | None:
        """Geocode *address* and return the first match as ``(lat, lng)``.

        Convenience wrapper over :meth:`geocode_candidates` for the common
        single-result case.
        """
        candidates = await self.geocode_candidates(address)
        if not candidates:
            return None
        return (candidates[0].lat, candidates[0].lng)

    async def geocode_candidates(
        self, address: str, *, max_results: int = 5
    ) -> Sequence[GeocodingCandidate]:
        """Return up to *max_results* geocoding candidates for *address*.

        Returns an empty sequence when the key is missing, the API returns
        zero results, or any error occurs.
        """
        params = _build_params(address)
        if params is None:
            return ()
        try:
            body = await _fetch_geocode_body(params)
        except (httpx.HTTPError, OSError, RuntimeError, ValueError) as exc:
            logger.warning("google_geocoding_error", address=address, error=str(exc))
            return ()
        return _log_outcome(address, _parse_results(body, max_results))
