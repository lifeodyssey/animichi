"""Unit tests for the httpx-backed Google Geocoding gateway."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

import agent.infrastructure.gateways.geocoding as geocoding
from agent.infrastructure.gateways.geocoding import (
    GeocodingCandidate,
    GoogleGeocodingGateway,
)

_RESULT = {
    "formatted_address": "藤沢駅, 神奈川県藤沢市",
    "geometry": {"location": {"lat": 35.338, "lng": 139.487}},
}


def _install_httpx(
    monkeypatch: pytest.MonkeyPatch,
    *,
    status_code: int = 200,
    payload: object = None,
    error: Exception | None = None,
) -> tuple[AsyncMock, MagicMock, MagicMock]:
    monkeypatch.setattr(geocoding, "_client", None, raising=False)
    response = httpx.Response(status_code, json=payload)
    get = AsyncMock(return_value=response, side_effect=error)
    client = MagicMock()
    client.get = get
    client.aclose = AsyncMock()
    constructor = MagicMock(return_value=client)
    monkeypatch.setattr(
        "agent.infrastructure.gateways.geocoding.httpx.AsyncClient", constructor
    )
    return get, client, constructor


@pytest.fixture(autouse=True)
def _api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")


async def test_geocode_returns_first_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, payload={"results": [_RESULT]})

    result = await GoogleGeocodingGateway().geocode("藤沢駅")

    assert result == (35.338, 139.487)


async def test_geocode_candidates_parses_labels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, payload={"results": [_RESULT]})

    candidates = await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    assert candidates == [
        GeocodingCandidate(label="藤沢駅, 神奈川県藤沢市", lat=35.338, lng=139.487)
    ]


async def test_returns_empty_without_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY")

    candidates = await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    assert candidates == ()


async def test_returns_empty_on_http_error_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, status_code=500, payload={})

    candidates = await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    assert candidates == ()


async def test_returns_empty_on_transport_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, error=httpx.ConnectError("boom"))

    candidates = await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    assert candidates == ()


async def test_returns_empty_on_zero_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, payload={"results": []})

    candidates = await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    assert candidates == ()


async def test_skips_malformed_results(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {"results": [{"formatted_address": 42}, _RESULT]}
    _install_httpx(monkeypatch, payload=payload)

    candidates = await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    assert len(candidates) == 1


async def test_caps_results_at_max_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_httpx(monkeypatch, payload={"results": [_RESULT] * 7})

    candidates = await GoogleGeocodingGateway().geocode_candidates(
        "藤沢駅", max_results=2
    )

    assert len(candidates) == 2


async def test_sends_address_and_key_params(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get, _, _ = _install_httpx(monkeypatch, payload={"results": [_RESULT]})

    await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    params = get.call_args.kwargs["params"]
    assert params["address"] == "藤沢駅"
    assert params["key"] == "test-key"
    assert params["region"] == "jp"


async def test_sequential_fetches_reuse_the_same_httpx_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, client, constructor = _install_httpx(monkeypatch, payload={"results": [_RESULT]})
    gateway = GoogleGeocodingGateway()

    await gateway.geocode_candidates("藤沢駅")
    first_client = geocoding._client
    await gateway.geocode_candidates("鎌倉駅")

    assert first_client is client
    assert geocoding._client is first_client
    constructor.assert_called_once_with(timeout=10.0)


async def test_aclose_geocoding_client_closes_and_resets_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, client, _ = _install_httpx(monkeypatch, payload={"results": [_RESULT]})
    await GoogleGeocodingGateway().geocode_candidates("藤沢駅")

    await geocoding.aclose_geocoding_client()
    await geocoding.aclose_geocoding_client()

    client.aclose.assert_awaited_once()
    assert geocoding._client is None


async def test_aclose_geocoding_client_ignores_close_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = MagicMock()
    client.aclose = AsyncMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(geocoding, "_client", client)

    await geocoding.aclose_geocoding_client()

    assert geocoding._client is None
