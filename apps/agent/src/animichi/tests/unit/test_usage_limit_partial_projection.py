"""UsageLimits partial projection over the REAL agent pipeline (#1222 split).

Three usage-limit scenarios drive genuine tool calls through FunctionModel and
let pydantic_ai's own before-request check raise UsageLimitExceeded — the
mock-free replacement for the retired Agent.run monkeypatches. Response
payloads are validated through typed envelopes, not cast dicts.
"""

from __future__ import annotations

import pytest

from animichi.agents.runtime_models import PartialResponseModel
from animichi.agents.session_state import (
    ItineraryPayloadState,
    ItineraryRef,
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from animichi.tests.unit.usage_limit_doubles import (
    ResultsEnvelope as _ResultsEnvelope,
)
from animichi.tests.unit.usage_limit_doubles import (
    RouteEnvelope as _RouteEnvelope,
)
from animichi.tests.unit.usage_limit_doubles import (
    plan_route_model as _plan_route_model,
)
from animichi.tests.unit.usage_limit_doubles import (
    search_bangumi_model as _search_bangumi_model,
)
from animichi.tests.unit.usage_limit_doubles import (
    search_payload as _search_payload,
)
from animichi.tests.unit.usage_limit_doubles import (
    usage_limited_turn as _usage_limited_turn,
)


async def test_usage_limit_returns_partial_with_current_turn_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, response = await _usage_limited_turn(
        monkeypatch, text="find it", locale="zh", model=_search_bangumi_model("160209")
    )
    assert isinstance(result.output, PartialResponseModel)
    assert (result.intent, result.success, result.status) == (
        "partial",
        False,
        "partial",
    )
    # The real request/tool-call count from the one tool call that actually
    # ran (was 12: an arbitrary fixture value the old Agent.run replacement
    # invented — real usage now comes from pydantic_ai's own accounting).
    assert result.usage is not None and result.usage.requests == 1
    assert (response.success, response.status) == (False, "partial")
    envelope = _ResultsEnvelope.model_validate(response.data)
    assert envelope.results.rows[0].id == "p001"
    assert envelope.results.rows[0].bangumi_id == "160209"
    assert response.ui == {"component": "GeneralAnswer"}
    assert "部分" in response.message


async def test_usage_limit_never_projects_stale_registry_ref(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SessionState()
    state.store_search_result(ResultRef("search:old"), _search_payload("old"))
    result, response = await _usage_limited_turn(
        monkeypatch,
        text="new turn",
        locale="en",
        model=_search_bangumi_model("160209"),
        context={"session_state_v2": state.model_dump(mode="json")},
    )
    assert result.provenance.search is not None
    # The fresh, real, current-turn ref (not the pre-seeded stale literal)
    # is what session_state now points at.
    fresh_ref = result.provenance.search.result_ref
    assert fresh_ref != ResultRef("search:old")
    assert result.session_state.last_result_ref == fresh_ref
    envelope = _ResultsEnvelope.model_validate(response.data)
    assert [row.id for row in envelope.results.rows] == ["p001", "p002", "p003"]


async def test_usage_limit_projects_current_route_over_stale_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SessionState()
    # A search from an EARLIER turn, real fixture points — plan_route (like
    # production) only accepts point ids the catalog actually knows.
    state.store_search_result(
        ResultRef("search:seed"),
        SearchPayloadState(
            kind="bangumi",
            rows=[
                PointState(id="p001", bangumi_id="160209"),
                PointState(id="p002", bangumi_id="160209"),
            ],
            row_count=2,
            anime_id="160209",
        ),
    )
    state.store_itinerary(
        ItineraryRef("route:old"),
        ItineraryPayloadState(ordered_points=[PointState(id="old", bangumi_id="1")]),
    )
    _, response = await _usage_limited_turn(
        monkeypatch,
        text="new turn",
        locale="en",
        model=_plan_route_model("search:seed"),
        context={"session_state_v2": state.model_dump(mode="json")},
    )
    envelope = _RouteEnvelope.model_validate(response.data)
    assert [point.id for point in envelope.route.ordered_points] == ["p001", "p002"]
    assert envelope.route.status == "ok"
    assert envelope.route.point_count == 2
    # The route was built from THIS turn's plan_route call over the real
    # search ref, not the pre-seeded stale itinerary ("route:old"/"old").
    assert envelope.route.source_ref == "search:seed"
    wire = response.model_dump(mode="json")
    assert (wire["session_id"], wire["generated_title"], wire["debug"]) == (
        None,
        None,
        None,
    )
