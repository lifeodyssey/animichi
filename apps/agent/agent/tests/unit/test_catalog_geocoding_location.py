"""Location precedence and honest-empty catalog outcomes."""

from unittest.mock import MagicMock

from agent.agents.catalog_tools import run_nearby_search
from agent.agents.runtime_deps import RuntimeDeps
from agent.clients.catalog_client import PilgrimagePoint
from agent.tests.eval.mock_catalog_client import MockCatalogClient


class _EmptyNearby(MockCatalogClient):
    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        self.calls.append(("nearby", (lat, lng, radius_m)))
        return []


def _deps(catalog: MockCatalogClient) -> RuntimeDeps:
    return RuntimeDeps(db=MagicMock(), locale="en", query="nearby", catalog=catalog)


async def test_gps_is_used_only_when_location_is_omitted() -> None:
    catalog = _EmptyNearby()
    deps = _deps(catalog)
    deps.tool_state.origin_lat = 35.0
    deps.tool_state.origin_lng = 139.0
    outcome = await run_nearby_search(MagicMock(deps=deps), catalog, None, None)
    assert outcome.outcome == "empty"
    assert catalog.calls == [("nearby", (35.0, 139.0, 5000))]


async def test_explicit_place_wins_over_shared_gps() -> None:
    catalog = MockCatalogClient()
    deps = _deps(catalog)
    deps.tool_state.origin_lat = 0.0
    deps.tool_state.origin_lng = 0.0
    await run_nearby_search(MagicMock(deps=deps), catalog, "西宮", None)
    assert catalog.calls[0] == ("geocode", ("西宮", 5))
    assert catalog.calls[1][0] == "nearby"


async def test_honest_empty_search_is_stored_as_empty_registry_payload() -> None:
    catalog = _EmptyNearby()
    deps = _deps(catalog)
    outcome = await run_nearby_search(MagicMock(deps=deps), catalog, "西宮", None)
    assert outcome.outcome == "empty"
    ref = deps.tool_state.session.last_result_ref
    assert ref is not None
    assert deps.tool_state.session.search_results[ref].rows == []
