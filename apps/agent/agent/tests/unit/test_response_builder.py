"""Public wire projection from the typed SessionState registry."""

from __future__ import annotations

from agent.agents.agent_result import (
    AgentResult,
    ProducedRoute,
    ProducedSearch,
    StepRecord,
    TurnProvenance,
)
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    PointState,
    ResultRef,
    RoutePayloadState,
    RouteRef,
    SearchPayloadState,
    SessionState,
)
from agent.application.errors import InvalidInputError
from agent.interfaces.response_builder import (
    _UI_MAP,
    agent_result_to_response,
    application_error_response,
    serialize_step_record,
)


def _search_state(*, empty: bool = False, kind: str = "bangumi") -> SessionState:
    rows = [] if empty else [PointState(id="p1", name="Bridge", bangumi_id="1")]
    state = SessionState()
    state.store_search_result(
        ResultRef("search:1"),
        SearchPayloadState.model_validate(
            {"kind": kind, "rows": rows, "row_count": len(rows), "anime_id": "1"}
        ),
    )
    return state


def _route_state(*, multi: bool = False) -> SessionState:
    state = _search_state(kind="multi" if multi else "bangumi")
    state.store_route(
        RouteRef("route:1"),
        RoutePayloadState(
            ordered_points=[PointState(id="p1", bangumi_id="1")],
            source_ref=state.last_result_ref,
        ),
    )
    return state


def _result(
    intent: str,
    state: SessionState,
    *,
    steps: list[StepRecord] | None = None,
) -> AgentResult:
    output = (
        RouteResponseModel(message="Route ready.")
        if intent.startswith("plan_")
        else SearchResponseModel(message="Search complete.")
    )
    return AgentResult(
        output=output,
        intent=intent,
        session_state=state,
        steps=steps or [],
        provenance=_provenance(intent, state),
    )


def _provenance(intent: str, state: SessionState) -> TurnProvenance:
    search = None
    route = None
    if intent in {"search_bangumi", "search_nearby", "plan_multi"}:
        ref = state.last_result_ref
        if ref is not None:
            outcome = "ok" if state.search_results[ref].row_count else "empty"
            search = ProducedSearch(outcome=outcome, result_ref=ref)
    if intent.startswith("plan_") and state.route_lru:
        route = ProducedRoute(status="ok", route_ref=state.route_lru[-1])
    return TurnProvenance(search=search, route=route)


def test_search_projection_uses_registry_rows() -> None:
    response = agent_result_to_response(
        _result("search_bangumi", _search_state()), include_debug=False
    )
    assert response.status == "ok"
    assert response.data["results"]["rows"][0]["name"] == "Bridge"
    assert response.ui == {"component": "PilgrimageGrid"}


def test_empty_search_is_a_successful_empty_payload() -> None:
    response = agent_result_to_response(
        _result("search_nearby", _search_state(empty=True, kind="nearby")),
        include_debug=False,
    )
    assert (response.success, response.status) == (True, "empty")
    assert response.data["results"]["rows"] == []


def test_route_and_multi_projection_are_registry_backed() -> None:
    route = agent_result_to_response(
        _result("plan_route", _route_state()), include_debug=False
    )
    multi = agent_result_to_response(
        _result("plan_multi", _route_state(multi=True)), include_debug=False
    )
    assert set(route.data) == {"route"}
    assert set(multi.data) == {"results", "route"}
    assert multi.data["route"]["ordered_points"][0]["id"] == "p1"


def test_clarify_projection_uses_trusted_ordered_candidates() -> None:
    pending = PendingClarification(
        reason="anime_ambiguity",
        candidate_ids=["1", "2"],
        ordered_candidates=[
            OrderedCandidate(id="1", title="Trusted One"),
            OrderedCandidate(id="2", title="Trusted Two"),
        ],
        revision=4,
    )
    output = ClarifyResponseModel(
        reason="anime_ambiguity", message="Choose works.", candidate_ids=["1", "2"]
    )
    result = AgentResult(
        output=output,
        intent="clarify",
        session_state=SessionState(
            pending_clarification=pending, clarification_revision=4
        ),
    )
    response = agent_result_to_response(result, include_debug=False)

    # stable-key contract: every candidate key is present, null when unknown.
    def _candidate(cid: str, title: str) -> dict[str, object]:
        return {
            "id": cid,
            "title": title,
            "cover_url": None,
            "city": None,
            "points_count": None,
            "lat": None,
            "lng": None,
            "effective_radius_m": None,
        }

    assert response.data == {
        "reason": "anime_ambiguity",
        "candidates": [_candidate("1", "Trusted One"), _candidate("2", "Trusted Two")],
        "clarification_id": 4,
    }


def test_failed_steps_and_debug_keep_step_provenance() -> None:
    steps = [StepRecord("search_bangumi", False, error="catalog down")]
    response = agent_result_to_response(
        _result("search_bangumi", _search_state(), steps=steps), include_debug=True
    )
    assert response.success is False
    assert response.errors[0].message == "catalog down"
    assert response.debug["steps"][0]["model_initiated"] is True


def test_ui_map_contains_only_live_runtime_stages() -> None:
    assert _UI_MAP["plan_selected"] == "RoutePlannerWizard"
    assert _UI_MAP["general_qa"] == "GeneralAnswer"
    assert _UI_MAP["greet_user"] == "GeneralAnswer"
    assert {"answer_question", "unclear"}.isdisjoint(_UI_MAP)


def test_unknown_intent_has_no_compatibility_fallback() -> None:
    result = AgentResult(
        output=QAResponseModel(message="Info"),
        intent="unknown_new_stage",
        session_state=SessionState(),
    )
    response = agent_result_to_response(result, include_debug=False)
    assert response.intent == "unknown_new_stage"
    assert response.ui is None


def test_application_error_response_and_step_serialization() -> None:
    response = application_error_response(InvalidInputError("bad", field="text"))
    assert response.errors[0].details == {"field": "text"}
    step = StepRecord(
        "clarify", True, data={"reason": "anime_not_found"}, model_initiated=False
    )
    assert serialize_step_record(step)["model_initiated"] is False
