"""Step/plumbing helpers shared by the pilgrimage agent tool registrations.

These wrap the cross-cutting concerns every tool needs: emitting SSE steps,
recording :class:`StepRecord` entries, locale-aware city renaming, and
compacting tool results for the LLM. ``_run_ephemeral`` runs the upstream-free
greet/qa handlers; the catalog read path lives in ``catalog_tools``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar

from pydantic import BaseModel
from pydantic_ai import RunContext

from agent.agents.agent_result import StepRecord
from agent.agents.geo_names import localized_city_name
from agent.agents.handlers import HandlerResult
from agent.agents.models import PlanStep, ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tool_results import (
    ClarifyToolResult,
    MessageToolResult,
    SearchPreviewRow,
    SearchToolPreview,
    SearchToolResult,
)
from agent.agents.tool_state import ToolState
from agent.agents.tools import enrich_clarify_candidates

T = TypeVar("T", bound=BaseModel)


async def _emit_step(
    deps: RuntimeDeps,
    tool: str,
    status: str,
    data: dict[str, object],
    *,
    thought: str = "",
    observation: str = "",
) -> None:
    if deps.on_step is None:
        return
    await deps.on_step(tool, status, data, thought, observation)


def _record_step(
    deps: RuntimeDeps,
    *,
    tool: str,
    success: bool,
    params: dict[str, object],
    data: dict[str, object] | None,
    error: str | None,
) -> None:
    deps.steps.append(
        StepRecord(tool=tool, success=success, params=params, data=data, error=error)
    )


def _localize_city_names(data: dict[str, object], locale: str) -> None:
    """Translate English city names in rows to the user's locale in-place."""
    if locale == "en":
        return
    rows = data.get("rows")
    if not isinstance(rows, list):
        return
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("city"), str):
            row["city"] = localized_city_name(row["city"], locale)


def _build_preview(data: SearchToolResult) -> SearchToolPreview:
    """Shrink a large SearchToolResult into a compact LLM-facing preview."""
    title = data.metadata.anime_title
    preview_rows = [
        SearchPreviewRow(name=r.name, episode=r.episode) for r in data.rows[:5]
    ]
    return SearchToolPreview(
        row_count=data.row_count,
        status=data.status,
        metadata=data.metadata,
        preview=preview_rows,
        note=f"Found {data.row_count} pilgrimage spots{' for ' + title if title else ''}. "
        "Full data is available — proceed to return a search_response.",
    )


def _summarize_for_llm(tool: ToolName, data: T) -> T | SearchToolPreview:
    """Return a compact summary of tool results for the LLM.

    Full data is kept in tool_state and SSE events for the frontend.
    The LLM only needs enough context to decide its next action.
    """
    is_search_tool = tool in (ToolName.SEARCH_BANGUMI, ToolName.SEARCH_NEARBY)
    if is_search_tool and isinstance(data, SearchToolResult) and len(data.rows) > 5:
        return _build_preview(data)
    return data


async def _run_ephemeral(
    ctx: RunContext[RuntimeDeps],
    *,
    tool: ToolName,
    params: dict[str, object],
    handler: Callable[[PlanStep, ToolState, object, object], Awaitable[HandlerResult]],
) -> MessageToolResult | None:
    """Run an upstream-free handler (greet/qa) and record/emit its result.

    Ephemeral handlers echo their LLM-supplied payload and never touch the DB,
    Retriever, or upstream gateways, so ``None`` is passed for both data deps.
    """
    deps = ctx.deps
    await _emit_step(deps, tool.value, "running", {})

    result = await handler(
        PlanStep(tool=tool, params=params),
        deps.tool_state,
        None,
        None,
    )

    _record_step(
        deps,
        tool=tool.value,
        success=result.success,
        params=params,
        data=result.data if result.data else None,
        error=result.error,
    )

    if result.success and result.data:
        _localize_city_names(result.data, deps.locale)
        deps.tool_state[tool.value] = result.data
        await _emit_step(deps, tool.value, "done", result.data)
    else:
        error_data: dict[str, object] = {"error": result.error or "Unknown error"}
        if result.data:
            error_data.update(result.data)
        await _emit_step(
            deps,
            tool.value,
            "failed",
            error_data,
            observation=result.error or "",
        )

    return MessageToolResult.model_validate(result.data) if result.data else None


async def run_clarify(
    deps: RuntimeDeps, *, question: str, options: list[str] | None
) -> ClarifyToolResult:
    """Enrich candidates and record/emit a clarification request."""
    normalized_options = list(options) if options else []
    await _emit_step(deps, ToolName.CLARIFY.value, "running", {})
    candidates = await enrich_clarify_candidates(deps, normalized_options)
    result = ClarifyToolResult(
        question=question, options=normalized_options, candidates=candidates
    )
    payload = result.model_dump(mode="json")
    deps.tool_state[ToolName.CLARIFY.value] = payload
    deps.tool_state["pending_clarify"] = True
    _record_step(
        deps,
        tool=ToolName.CLARIFY.value,
        success=True,
        params={"question": question, "options": normalized_options},
        data=payload,
        error=None,
    )
    await _emit_step(deps, ToolName.CLARIFY.value, "done", payload)
    return result
