"""Runner: execute the pilgrimage agent and return AgentResult."""

from __future__ import annotations

import structlog
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits

from agent.agents.agent_result import AgentResult
from agent.agents.animichi_agent import animichi_agent
from agent.agents.runtime_deps import (
    OnStep,
    RuntimeDeps,
    TitleTranslator,
    WebSearcher,
)
from agent.agents.tool_state import SearchState, ToolState
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort

logger = structlog.get_logger(__name__)

REQUEST_LIMIT = 15
TOOL_CALLS_LIMIT = 10
RUN_USAGE_LIMITS = UsageLimits(
    request_limit=REQUEST_LIMIT,
    tool_calls_limit=TOOL_CALLS_LIMIT,
)


def _seed_geo_coords(tool_state: ToolState, context: dict[str, object]) -> None:
    origin_lat = context.get("origin_lat")
    origin_lng = context.get("origin_lng")
    if isinstance(origin_lat, int | float):
        tool_state.origin_lat = float(origin_lat)
    if isinstance(origin_lng, int | float):
        tool_state.origin_lng = float(origin_lng)


def _seed_search_data(tool_state: ToolState, context: dict[str, object]) -> None:
    raw = context.get("last_search_data")
    if not isinstance(raw, dict):
        return
    bangumi = raw.get("search_bangumi")
    nearby = raw.get("search_nearby")
    if isinstance(bangumi, dict):
        tool_state.search_bangumi = SearchState.model_validate(bangumi)
    if isinstance(nearby, dict):
        tool_state.search_nearby = SearchState.model_validate(nearby)
    if "rows" in raw and tool_state.search_bangumi is None:
        tool_state.search_bangumi = SearchState.model_validate(raw)


def _seed_tool_state(deps: RuntimeDeps, context: dict[str, object] | None) -> None:
    deps.tool_state.locale = deps.locale
    if context is None:
        return
    last_location = context.get("last_location")
    if isinstance(last_location, str) and last_location:
        deps.tool_state.last_location = last_location
    _seed_geo_coords(deps.tool_state, context)

    raw_candidates = context.get("resolve_candidates")
    if isinstance(raw_candidates, list) and raw_candidates:
        deps.tool_state.resolve_candidates = raw_candidates
    if context.get("pending_clarify") is True:
        deps.tool_state.pending_clarify = True

    _seed_search_data(deps.tool_state, context)


async def run_animichi_agent(
    *,
    text: str,
    db: DatabasePort,
    locale: str,
    catalog: CatalogClientProtocol,
    model: Model | str | None = None,
    context: dict[str, object] | None = None,
    message_history: list[ModelMessage] | None = None,
    on_step: OnStep | None = None,
    model_settings: ModelSettings | None = None,
    web_searcher: WebSearcher | None = None,
    title_translator: TitleTranslator | None = None,
) -> AgentResult:
    """Run the main agent and return AgentResult.

    The data tools route exclusively through the injected ``catalog`` client;
    the agent makes no upstream calls (no DB Retriever, no Anitabi/Bangumi).
    """
    deps = RuntimeDeps(
        db=db,
        locale=locale,
        query=text,
        on_step=on_step,
        catalog=catalog,
        web_searcher=web_searcher,
        title_translator=title_translator,
    )
    _seed_tool_state(deps, context)

    run_result = await animichi_agent.run(
        text,
        deps=deps,
        model=model,
        model_settings=model_settings,
        message_history=message_history or [],
        usage_limits=RUN_USAGE_LIMITS,
    )
    raw_output = run_result.output
    if isinstance(raw_output, str):
        raise ValueError(
            f"Agent returned plain string instead of typed output: {raw_output[:200]}"
        )

    result = AgentResult(
        output=raw_output,
        steps=list(deps.steps),
        tool_state=deps.tool_state.to_legacy_dict(),
        new_messages=list(run_result.new_messages()),
        usage=run_result.usage,
    )
    logger.info(
        "animichi_agent_complete",
        intent=result.intent,
        steps=len(result.steps),
    )
    return result
