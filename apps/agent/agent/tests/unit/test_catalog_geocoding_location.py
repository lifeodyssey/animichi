"""Location-flow coverage split from the core geocoding agent tests."""

from agent.interfaces.response_builder import agent_result_to_response
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.unit.test_catalog_geocoding_agent import EmptyNearbyCatalog, _run


async def test_a5_prime_honest_empty_is_successful_search_response() -> None:
    result = await _run("西宮", EmptyNearbyCatalog())
    response = agent_result_to_response(result, include_debug=True)
    assert result.tool_state["search_nearby"]["row_count"] == 0
    assert result.steps[0].success is True
    assert response.success is True
    assert response.errors == []


async def test_a6_ambiguous_place_clarifies_without_pipeline_error() -> None:
    result = await _run("府中", MockCatalogClient())
    response = agent_result_to_response(result, include_debug=True)
    assert [step.tool for step in result.steps] == ["geocode", "clarify"]
    assert all(step.success for step in result.steps)
    assert result.output.data.options
    assert response.success is True
    assert response.errors == []


async def test_a7_unknown_place_clarifies_without_gps_fallback() -> None:
    catalog = MockCatalogClient()
    result = await _run(
        "unknown place", catalog, context={"origin_lat": 34.7, "origin_lng": 135.3}
    )
    assert result.intent == "clarify"
    assert [name for name, _ in catalog.calls] == ["geocode"]
    assert result.steps[0].tool == "geocode"


async def test_a8_explicit_place_wins_over_gps() -> None:
    catalog = MockCatalogClient()
    await _run("西宮", catalog, context={"origin_lat": 0.0, "origin_lng": 0.0})
    assert catalog.calls[0] == ("geocode", ("西宮", 5))
    assert catalog.calls[1][0] == "nearby"
    assert catalog.calls[1][1][:2] == (34.7386, 135.3485)


async def test_a8_empty_location_uses_gps_without_geocoding() -> None:
    catalog = EmptyNearbyCatalog()
    await _run("", catalog, context={"origin_lat": 35.0, "origin_lng": 139.0})
    assert catalog.calls == [("nearby", (35.0, 139.0, 5000))]


async def test_a8_empty_location_without_gps_clarifies() -> None:
    result = await _run("", MockCatalogClient())
    assert result.intent == "clarify"
    assert [step.tool for step in result.steps] == ["clarify"]


async def test_a8_prime_prefecture_clarifies_without_nearby() -> None:
    catalog = MockCatalogClient()
    result = await _run("山梨県", catalog)
    calls = [name for name, _ in catalog.calls if name in {"geocode", "nearby"}]
    assert calls == ["geocode"]
    assert result.success is True
    assert result.steps[0].tool == "geocode"
