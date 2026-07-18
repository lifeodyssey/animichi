"""The four compact, catalog-only tools exposed to the runtime model."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field
from pydantic_ai import RunContext, Tool
from pydantic_ai.tools import ToolFuncEither

from agent.agents.catalog_route_tools import run_route
from agent.agents.catalog_tools import (
    run_nearby_search,
    run_resolve,
    run_work_search,
)
from agent.agents.runtime_deps import RuntimeDeps, StepEvent
from agent.agents.tool_outcomes import (
    NearbyToolResult,
    ResolveResult,
    RouteToolResult,
    SearchToolResult,
)

CATALOG_TOOL_TIMEOUT_SECONDS = 85.0


async def resolve_anime(
    ctx: RunContext[RuntimeDeps],
    title: Annotated[str, Field(min_length=1)],
) -> ResolveResult:
    """Resolve an anime title to a deterministic outcome.

    `resolved` means call `search_bangumi` with its ID. For
    `needs_disambiguation`, emit `clarify_response` with the supplied reason and
    candidate IDs. For `not_found`, emit `clarify_response` asking for a corrected
    title. For `upstream_unavailable`, emit `qa_response` asking the user to retry.
    Never infer ambiguity from query length.
    """
    await _emit(ctx, "resolve_anime", "running", {})
    result = await run_resolve(ctx, ctx.deps.catalog, title)
    await _emit(ctx, "resolve_anime", "done", result.model_dump())
    return result


async def search_bangumi(
    ctx: RunContext[RuntimeDeps],
    bangumi_id: Annotated[str, Field(pattern=r"^\d+$")],
) -> SearchToolResult:
    """Fetch points by work ID; upstream_unavailable means ask the user to retry."""
    await _emit(ctx, "search_bangumi", "running", {})
    result = await run_work_search(ctx, ctx.deps.catalog, bangumi_id)
    await _emit(ctx, "search_bangumi", "done", result.model_dump())
    return result


async def search_nearby(
    ctx: RunContext[RuntimeDeps],
    location: str | None = None,
    radius_m: Annotated[int | None, Field(gt=0)] = None,
) -> NearbyToolResult:
    """Search near a place or GPS; upstream_unavailable means retry later."""
    await _emit(ctx, "search_nearby", "running", {})
    result = await run_nearby_search(
        ctx, ctx.deps.catalog, location=location, radius_m=radius_m
    )
    await _emit(ctx, "search_nearby", "done", result.model_dump())
    return result


async def plan_route(
    ctx: RunContext[RuntimeDeps],
    search_result_ref: Annotated[str, Field(min_length=1)],
    pacing: Literal["chill", "normal", "packed"] | None = None,
) -> RouteToolResult:
    """Plan one stored result; upstream_unavailable means retry later."""
    await _emit(ctx, "plan_route", "running", {})
    result = await run_route(ctx, ctx.deps.catalog, search_result_ref, pacing)
    await _emit(ctx, "plan_route", "done", result.model_dump())
    return result


async def _emit(
    ctx: RunContext[RuntimeDeps], tool: str, status: str, data: dict[str, object]
) -> None:
    if ctx.deps.on_step is not None:
        await ctx.deps.on_step(StepEvent(tool=tool, status=status, data=data))


TOOLS: list[Tool[RuntimeDeps] | ToolFuncEither[RuntimeDeps]] = [
    Tool(resolve_anime, timeout=CATALOG_TOOL_TIMEOUT_SECONDS),
    Tool(search_bangumi, timeout=CATALOG_TOOL_TIMEOUT_SECONDS),
    Tool(search_nearby, timeout=CATALOG_TOOL_TIMEOUT_SECONDS),
    Tool(
        plan_route,
        description=(
            "Plan a walking route over the exact registry result named by "
            "search_result_ref. The ref is required and has no session default. "
            "Optional pacing is chill, normal, or packed."
        ),
        docstring_format="google",
        timeout=CATALOG_TOOL_TIMEOUT_SECONDS,
    ),
]
