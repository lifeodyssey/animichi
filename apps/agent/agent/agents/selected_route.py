"""Direct selected-point route execution (no ExecutorAgent needed)."""

from __future__ import annotations

import httpx
import structlog

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.catalog_adapter import build_route_payload
from agent.agents.messages import build_message
from agent.agents.runtime_deps import OnStep
from agent.agents.runtime_models import RouteDataModel, RouteModel, RouteResponseModel
from agent.clients.catalog_client import CatalogClientProtocol, Route
from agent.clients.errors import APIError

logger = structlog.get_logger(__name__)

_TRANSIENT_ERRORS = (APIError, httpx.TransportError, httpx.TimeoutException)


async def execute_selected_route(
    *,
    point_ids: list[str],
    origin: str | None,
    locale: str,
    catalog: CatalogClientProtocol,
    on_step: OnStep | None = None,
) -> AgentResult:
    """Route user-selected point IDs directly, returning AgentResult."""
    if not point_ids:
        return _error_result("point_ids is required", locale)

    params = _build_params(point_ids, origin)
    await _emit_step(on_step, "running", {})

    try:
        route = await catalog.route(point_ids, origin=_parse_coordinate_origin(origin))
    except _TRANSIENT_ERRORS as exc:
        logger.warning("selected_route_catalog_error", error=str(exc))
        return _error_result("Catalog route unavailable", locale)

    step, payload = _build_step(route, params)
    await _emit_step(on_step, "done", payload)
    return _build_success_result(payload, step, locale)


def _build_params(point_ids: list[str], origin: str | None) -> dict[str, object]:
    """Build the tool params recorded on the step for observability."""
    params: dict[str, object] = {"point_ids": point_ids}
    if origin:
        params["origin"] = origin
    return params


async def _emit_step(
    on_step: OnStep | None, status: str, payload: dict[str, object]
) -> None:
    """Notify the on_step callback, if any, of plan_selected progress."""
    if on_step is None:
        return
    await on_step("plan_selected", status, payload, "", "")


def _build_step(
    route: Route, params: dict[str, object]
) -> tuple[StepRecord, dict[str, object]]:
    """Shape the catalog route into a StepRecord and its tool_state payload."""
    payload = build_route_payload(route)
    success = route.point_count > 0
    step = StepRecord(
        tool="plan_selected",
        success=success,
        params=params,
        data=payload,
        error=None if success else "No catalog route data",
    )
    return step, payload


def _build_success_result(
    payload: dict[str, object], step: StepRecord, locale: str
) -> AgentResult:
    """Assemble the AgentResult returned on a successful route lookup."""
    route_model = RouteModel.model_validate(payload)
    raw_count = payload.get("point_count", 0)
    count = int(raw_count) if isinstance(raw_count, (int, float)) else 0
    message = build_message("plan_selected", count, locale)
    output = RouteResponseModel(
        intent="plan_selected",
        message=message,
        data=RouteDataModel(route=route_model),
    )
    return AgentResult(
        output=output,
        steps=[step],
        tool_state={"plan_selected": payload},
    )


def _error_result(error: str, locale: str) -> AgentResult:
    output = RouteResponseModel(
        intent="plan_selected",
        message=error,
        data=RouteDataModel(route=RouteModel()),
    )
    return AgentResult(
        output=output,
        steps=[StepRecord(tool="plan_selected", success=False, error=error)],
    )


def _parse_coordinate_origin(origin: str | None) -> tuple[float, float] | None:
    """Parse a coordinate origin encoded as ``lat,lng``."""
    if origin is None:
        return None

    parts = [part.strip() for part in origin.split(",")]
    if len(parts) != 2:
        return None

    try:
        lat = float(parts[0])
        lng = float(parts[1])
    except ValueError:
        return None

    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        return None

    return lat, lng
