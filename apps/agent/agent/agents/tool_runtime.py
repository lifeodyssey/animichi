"""Step/plumbing helpers shared by the pilgrimage agent tool registrations.

These wrap the cross-cutting concerns every tool needs: emitting SSE steps,
recording :class:`StepRecord` entries, locale-aware city renaming, and
compacting tool results for the LLM. ``_run_ephemeral`` runs the upstream-free
greet/qa handlers; the catalog read path lives in ``catalog_tools``.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Mapping

from pydantic_ai import RunContext, ToolReturn

from agent.agents.agent_result import StepRecord
from agent.agents.geo_names import localized_city_name
from agent.agents.handlers import HandlerResult
from agent.agents.models import PlanStep, ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.tools import enrich_clarify_candidates


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


def _model_summary(tool: ToolName, data: dict[str, object]) -> dict[str, object]:
    """Return a compact summary of tool results for the LLM.

    Full data is kept in tool_state and SSE events for the frontend.
    The LLM only needs enough context to decide its next action.
    """
    if tool not in (ToolName.SEARCH_BANGUMI, ToolName.SEARCH_NEARBY):
        return data

    rows = data.get("rows")
    if not isinstance(rows, list) or len(rows) <= 5:
        return data

    row_count = data.get("row_count", len(rows))
    metadata = data.get("metadata")
    title = ""
    if isinstance(metadata, dict):
        title = str(metadata.get("anime_title", "") or "")

    preview_rows = [
        {k: row[k] for k in ("name", "episode") if k in row}
        for row in rows[:5]
        if isinstance(row, dict)
    ]
    return {
        "row_count": row_count,
        "status": data.get("status", "ok"),
        "metadata": metadata,
        "preview": preview_rows,
        "note": f"Found {row_count} pilgrimage spots{' for ' + title if title else ''}. "
        "Full data is available — proceed to return a search_response.",
    }


def _catalog_tool_return(
    tool: ToolName, payload: dict[str, object]
) -> ToolReturn[dict[str, object]]:
    summary = _model_summary(tool, payload)
    return ToolReturn(payload, content=json.dumps(summary, ensure_ascii=False))


async def _run_ephemeral(
    ctx: RunContext[RuntimeDeps],
    *,
    tool: ToolName,
    params: dict[str, object],
    handler: Callable[
        [PlanStep, Mapping[str, object], object, object], Awaitable[HandlerResult]
    ],
) -> dict[str, object]:
    """Run an upstream-free handler (greet/qa) and record/emit its result.

    Ephemeral handlers echo their LLM-supplied payload and never touch the DB,
    Retriever, or upstream gateways, so ``None`` is passed for both data deps.
    """
    deps = ctx.deps
    await _emit_step(deps, tool.value, "running", {})

    result = await handler(
        PlanStep(tool=tool, params=params),
        deps.tool_state.to_legacy_dict(),
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
        deps.tool_state.set_payload(tool, result.data)
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

    return _model_summary(tool, result.data) if result.data else {}


async def run_clarify(
    deps: RuntimeDeps, *, question: str, options: list[str] | None
) -> dict[str, object]:
    """Enrich candidates and record/emit a clarification request payload."""
    normalized_options = list(options) if options else []
    await _emit_step(deps, ToolName.CLARIFY.value, "running", {})
    candidates = await enrich_clarify_candidates(deps, normalized_options)
    payload: dict[str, object] = {
        "question": question,
        "options": normalized_options,
        "candidates": candidates,
        "status": "needs_clarification",
    }
    deps.tool_state.set_payload(ToolName.CLARIFY, payload)
    deps.tool_state.pending_clarify = True
    _record_step(
        deps,
        tool=ToolName.CLARIFY.value,
        success=True,
        params={"question": question, "options": normalized_options},
        data=payload,
        error=None,
    )
    await _emit_step(deps, ToolName.CLARIFY.value, "done", payload)
    # Signal to the LLM that it must stop and return clarify_response now.
    # Without this, some models (e.g. DeepSeek V4 Flash) continue calling
    # search_bangumi instead of waiting for user input.
    payload["action_required"] = "return clarify_response"
    clarify_state = deps.tool_state.clarify
    if clarify_state is not None:
        clarify_state.action_required = "return clarify_response"
    return payload
