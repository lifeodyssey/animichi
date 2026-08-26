"""SD-19: catalog-tool upstream failures log server-side, never to the user.

Failure-signal audit (docs/specs/2026-08-26-system-health-audit.md §5.1, item C7):
each of the four `except CATALOG_FAILURES` branches in `catalog_tools.py`
previously swallowed the upstream exception silently. These tests assert a
structured warning is emitted before the typed `UpstreamDown` outcome returns,
carrying the tool name and a truncated error string — never surfaced to the
model or the user.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

import animichi.agents.catalog_tools as catalog_tools
from animichi.agents.catalog_tools import (
    run_nearby_search,
    run_resolve,
    run_work_search,
)
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.agents.tool_outcomes import (
    NearbyUpstreamDown,
    ResolveUpstreamDown,
    SearchUpstreamDown,
)
from animichi.clients.catalog_client import (
    GeocodeCandidate,
    Point,
    ResolveNotFound,
    ResolveResolved,
    SearchResult,
)
from animichi.clients.errors import APIError
from animichi.clients.geocode import GeocodeKind, GeocodeSource
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.tool_event_helpers import tool_context

_STATION = GeocodeCandidate(
    id="station-1",
    label="Uji Station",
    name="Uji",
    lat=34.89,
    lng=135.8,
    kind=GeocodeKind.STATION,
    source=GeocodeSource.SEED,
)


class _ResolveDownCatalog(MockCatalogClient):
    async def resolve(self, query: str) -> ResolveResolved | ResolveNotFound:
        raise APIError("bangumi resolve exploded")


class _PointsDownCatalog(MockCatalogClient):
    async def points_by_bangumi_id(self, bangumi_id: str) -> SearchResult:
        raise APIError("catalog points fetch exploded")


class _GeocodeDownCatalog(MockCatalogClient):
    async def geocode(self, query: str, *, limit: int = 5) -> list[GeocodeCandidate]:
        raise APIError("gazetteer geocode exploded")


class _NearbyPointsDownCatalog(MockCatalogClient):
    async def geocode(self, query: str, *, limit: int = 5) -> list[GeocodeCandidate]:
        return [_STATION]

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[Point]:
        raise APIError("nearby points exploded")


def _deps(catalog: MockCatalogClient) -> RuntimeDeps:
    return RuntimeDeps(MagicMock(), "en", "test", catalog)


async def test_resolve_upstream_failure_logs_tool_and_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = _ResolveDownCatalog()
    deps = _deps(catalog)

    fake_logger = MagicMock()
    monkeypatch.setattr(catalog_tools, "logger", fake_logger)
    outcome = await run_resolve(tool_context(deps), catalog, "Uji")

    assert isinstance(outcome, ResolveUpstreamDown)
    fake_logger.warning.assert_called_once_with(
        "catalog_tool_upstream_down",
        tool="resolve_anime",
        error="bangumi resolve exploded",
    )


async def test_work_search_upstream_failure_logs_tool_and_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = _PointsDownCatalog()
    deps = _deps(catalog)

    fake_logger = MagicMock()
    monkeypatch.setattr(catalog_tools, "logger", fake_logger)
    outcome = await run_work_search(tool_context(deps), catalog, "115908")

    assert isinstance(outcome, SearchUpstreamDown)
    fake_logger.warning.assert_called_once_with(
        "catalog_tool_upstream_down",
        tool="search_bangumi",
        error="catalog points fetch exploded",
    )


async def test_nearby_geocode_upstream_failure_logs_geocode_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = _GeocodeDownCatalog()
    deps = _deps(catalog)

    fake_logger = MagicMock()
    monkeypatch.setattr(catalog_tools, "logger", fake_logger)
    outcome = await run_nearby_search(tool_context(deps), catalog, "Uji", None)

    assert isinstance(outcome, NearbyUpstreamDown)
    fake_logger.warning.assert_called_once_with(
        "catalog_tool_upstream_down", tool="geocode", error="gazetteer geocode exploded"
    )


async def test_nearby_points_upstream_failure_logs_nearby_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = _NearbyPointsDownCatalog()
    deps = _deps(catalog)

    fake_logger = MagicMock()
    monkeypatch.setattr(catalog_tools, "logger", fake_logger)
    outcome = await run_nearby_search(tool_context(deps), catalog, "Uji", None)

    assert isinstance(outcome, NearbyUpstreamDown)
    fake_logger.warning.assert_called_once_with(
        "catalog_tool_upstream_down",
        tool="search_nearby",
        error="nearby points exploded",
    )


async def test_truncates_long_upstream_error_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _LongErrorCatalog(MockCatalogClient):
        async def resolve(self, query: str) -> ResolveResolved | ResolveNotFound:
            raise APIError("x" * 500)

    catalog = _LongErrorCatalog()
    deps = _deps(catalog)

    fake_logger = MagicMock()
    monkeypatch.setattr(catalog_tools, "logger", fake_logger)
    await run_resolve(tool_context(deps), catalog, "Uji")

    assert len(fake_logger.warning.call_args.kwargs["error"]) == 200
