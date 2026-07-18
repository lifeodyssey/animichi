"""Typed degradation shared by catalog-backed model tools."""

from __future__ import annotations

from agent.agents.agent_result import RejectedSearch
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.step_recording import _record
from agent.agents.tool_outcomes import NearbyUpstreamDown
from agent.clients.errors import APIError

CATALOG_FAILURES = (APIError, OSError, RuntimeError)


def nearby_params(location: str | None, radius_m: int | None) -> dict[str, object]:
    params: dict[str, object] = {"location": location}
    if radius_m is not None:
        params["radius_m"] = radius_m
    return params


def nearby_upstream_down(
    deps: RuntimeDeps, location: str | None, radius_m: int | None
) -> NearbyUpstreamDown:
    outcome = NearbyUpstreamDown()
    _record(
        deps,
        ToolName.SEARCH_NEARBY.value,
        nearby_params(location, radius_m),
        outcome.model_dump(),
        provenance=RejectedSearch(outcome=outcome.outcome),
    )
    return outcome
