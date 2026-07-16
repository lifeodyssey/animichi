"""Direct selected-point route execution (no ExecutorAgent needed)."""

from __future__ import annotations

import httpx
import structlog

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.catalog_adapter import build_route_payload, build_route_state
from agent.agents.error_messages import build_error_message
from agent.agents.runtime_deps import OnStep, StepEvent
from agent.agents.runtime_models import RouteResponseModel
from agent.agents.selection_messages import selected_route_message
from agent.agents.session_state import SessionState
from agent.clients.catalog_client import CatalogClientProtocol, Route
from agent.clients.errors import APIError

logger = structlog.get_logger(__name__)

_TRANSIENT_ERRORS = (APIError, httpx.TransportError, httpx.TimeoutException)


async def execute_selected_route(
    *,
    point_ids: list[str],
    state: SessionState,
    origin: str | None,
    locale: str,
    catalog: CatalogClientProtocol,
    on_step: OnStep | None = None,
) -> AgentResult:
    """Route user-selected point IDs directly, returning AgentResult."""
    if not point_ids:
        return _error_result("point_ids is required", locale, state)

    params = _build_params(point_ids, origin)
    await _emit_step(on_step, "running", {})

    try:
        route = await catalog.route(point_ids, origin=_parse_coordinate_origin(origin))
    except _TRANSIENT_ERRORS as exc:
        logger.warning("selected_route_catalog_error", error=str(exc))
        # Typed CatalogError -> localized, actionable text from OUR mapping
        # table (SD-19); anything else keeps the legacy generic fallback.
        return _error_result(
            build_error_message(exc, locale, fallback="Catalog route unavailable"),
            locale,
            state,
        )

    step, payload = _build_step(route, params)
    if not step.success:
        return _error_result("No catalog route data", locale, state)
    await _emit_step(on_step, "done", payload)
    return _build_success_result(route, step, locale, state)


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
    await on_step(StepEvent(tool="plan_selected", status=status, data=payload))


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
        model_initiated=False,
    )
    return step, payload


def _build_success_result(
    route: Route,
    step: StepRecord,
    locale: str,
    state: SessionState,
) -> AgentResult:
    """Assemble the AgentResult returned on a successful route lookup."""
    route_ref = state.next_route_ref("selected", 1)
    state.store_route(route_ref, build_route_state(route, source_ref=None))
    state.pending_clarification = None
    state.geocode_staging = None
    output = RouteResponseModel(
        message=selected_route_message(locale, route.point_count)
    )
    return AgentResult(
        output=output,
        intent="plan_selected",
        session_state=state,
        steps=[step],
    )


def _error_result(error: str, locale: str, state: SessionState) -> AgentResult:
    output = RouteResponseModel(message=error)
    return AgentResult(
        output=output,
        intent="plan_selected",
        session_state=state,
        steps=[
            StepRecord(
                tool="plan_selected",
                success=False,
                error=error,
                model_initiated=False,
            )
        ],
        status="error",
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
