"""Build the public wire response exclusively from typed server state."""

from __future__ import annotations

from dataclasses import asdict

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import ClarifyResponseModel, PartialResponseModel
from agent.agents.session_state import (
    RoutePayloadState,
    SearchPayloadState,
)
from agent.application.errors import ApplicationError
from agent.interfaces.schemas import PublicAPIError, PublicAPIResponse

_UI_MAP: dict[str, str] = {
    "search_bangumi": "PilgrimageGrid",
    "search_nearby": "NearbyMap",
    "plan_route": "RoutePlannerWizard",
    "plan_selected": "RoutePlannerWizard",
    "plan_multi": "RoutePlannerWizard",
    "general_qa": "GeneralAnswer",
    "greet_user": "GeneralAnswer",
    "clarify": "Clarification",
    "partial": "GeneralAnswer",
    "blocked": "GeneralAnswer",
}


def _search_wire(payload: SearchPayloadState) -> dict[str, object]:
    data = payload.model_dump(mode="json", exclude_none=True)
    data["status"] = "ok" if payload.row_count else "empty"
    data["strategy"] = "geo" if payload.kind == "nearby" else "bangumi"
    data["summary"] = {
        "count": payload.row_count,
        "source": "catalog",
        "cache": "miss",
    }
    return data


def _route_wire(payload: RoutePayloadState) -> dict[str, object]:
    data = payload.model_dump(mode="json", exclude_none=True)
    data["point_count"] = len(payload.ordered_points)
    data["status"] = "ok" if payload.ordered_points else "empty"
    return data


def _project_search(result: AgentResult) -> dict[str, object] | None:
    produced = result.provenance.search
    payload = (
        result.session_state.search_results.get(produced.result_ref)
        if produced is not None
        else None
    )
    return _search_wire(payload) if payload is not None else None


def _project_route(result: AgentResult) -> dict[str, object] | None:
    produced = result.provenance.route
    payload = (
        result.session_state.routes.get(produced.route_ref)
        if produced is not None
        else None
    )
    return _route_wire(payload) if payload is not None else None


def _clarify_data(result: AgentResult) -> dict[str, object]:
    output = result.output
    pending = result.session_state.pending_clarification
    if not isinstance(output, ClarifyResponseModel) or pending is None:
        return {}
    return {
        "reason": output.reason,
        "candidates": [
            candidate.model_dump(mode="json", exclude_none=True)
            for candidate in pending.ordered_candidates
        ],
        "clarification_id": pending.revision,
    }


def _response_data(result: AgentResult) -> dict[str, object]:
    if result.intent == "clarify":
        return _clarify_data(result)
    if isinstance(result.output, PartialResponseModel):
        return _partial_data(result)
    if result.status == "error":
        return {}
    data: dict[str, object] = {}
    if result.intent in {"search_bangumi", "search_nearby", "plan_multi"}:
        search = _project_search(result)
        if search is not None:
            data["results"] = search
    if result.intent in {"plan_route", "plan_selected", "plan_multi"}:
        route = _project_route(result)
        if route is not None:
            data["route"] = route
    return data


def _partial_data(result: AgentResult) -> dict[str, object]:
    data: dict[str, object] = {}
    search = _project_search(result)
    route = _project_route(result)
    if search is not None:
        data["results"] = search
    if route is not None:
        data["route"] = route
    return data


def _response_status(result: AgentResult, data: dict[str, object]) -> str:
    if result.status is not None:
        return result.status
    if result.intent == "clarify":
        return "needs_clarification"
    payload = data.get("route") or data.get("results")
    if isinstance(payload, dict) and isinstance(payload.get("status"), str):
        return str(payload["status"])
    return "info" if result.intent in {"general_qa", "greet_user"} else "ok"


def agent_result_to_response(
    result: AgentResult, *, include_debug: bool
) -> PublicAPIResponse:
    """Map one server-owned result into the stable public contract."""
    data = _response_data(result)
    component = _UI_MAP.get(result.intent)
    failed = [step for step in result.steps if not step.success and step.error]
    errors = [_step_error(step, include_debug) for step in failed]
    response = PublicAPIResponse(
        success=result.success,
        status=_response_status(result, data),
        intent=result.intent,
        message=result.message,
        data=data,
        errors=errors,
        ui={"component": component} if component else None,
    )
    if include_debug:
        response.debug = {
            "steps": [serialize_step_record(step) for step in result.steps]
        }
    return response


def _step_error(step: StepRecord, include_debug: bool) -> PublicAPIError:
    message = str(step.error) if include_debug else "A processing step failed."
    return PublicAPIError(code="pipeline_error", message=message)


def application_error_response(exc: ApplicationError) -> PublicAPIResponse:
    """Map an application error to a failed public response."""
    return PublicAPIResponse(
        success=False,
        status="error",
        intent="unknown",
        message=exc.message,
        errors=[
            PublicAPIError(
                code=exc.error_code.value,
                message=exc.message,
                details=exc.details,
            )
        ],
    )


def serialize_step_record(step: StepRecord) -> dict[str, object]:
    """Serialize one step for opt-in debug output."""
    serialized: dict[str, object] = {
        "tool": step.tool,
        "success": step.success,
        "error": step.error,
        "data": step.data,
        "model_initiated": step.model_initiated,
    }
    if step.provenance is not None:
        serialized["provenance"] = asdict(step.provenance)
    return serialized
