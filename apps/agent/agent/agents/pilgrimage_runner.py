"""Runner: execute the pilgrimage agent and return AgentResult.

Separated from the agent definition so that the agent module stays small
and the tool module can import the agent object without circular deps.
"""

from __future__ import annotations

import structlog
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings

import agent.agents.pilgrimage_tools as _tools  # noqa: F401
import agent.agents.web_tools as _web_tools  # noqa: F401
from agent.agents.agent_result import AgentResult

# Importing pilgrimage_tools triggers @tool registrations on the agent.
from agent.agents.pilgrimage_agent import pilgrimage_agent  # noqa: F401
from agent.agents.runtime_deps import (
    OnStep,
    RuntimeDeps,
    TitleTranslator,
    WebSearcher,
)
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort

logger = structlog.get_logger(__name__)


def _seed_geo_coords(tool_state: dict[str, object], context: dict[str, object]) -> None:
    origin_lat = context.get("origin_lat")
    origin_lng = context.get("origin_lng")
    if isinstance(origin_lat, int | float):
        tool_state["origin_lat"] = float(origin_lat)
    if isinstance(origin_lng, int | float):
        tool_state["origin_lng"] = float(origin_lng)


def _seed_search_data(
    tool_state: dict[str, object], context: dict[str, object]
) -> None:
    raw = context.get("last_search_data")
    if not isinstance(raw, dict):
        return
    for key in ("search_bangumi", "search_nearby"):
        value = raw.get(key)
        if isinstance(value, dict):
            tool_state[key] = value
    if "rows" in raw and "search_bangumi" not in tool_state:
        tool_state["search_bangumi"] = raw


def _seed_tool_state(deps: RuntimeDeps, context: dict[str, object] | None) -> None:
    deps.tool_state["locale"] = deps.locale
    if context is None:
        return
    last_location = context.get("last_location")
    if isinstance(last_location, str) and last_location:
        deps.tool_state["last_location"] = last_location
    _seed_geo_coords(deps.tool_state, context)

    raw_candidates = context.get("resolve_candidates")
    if isinstance(raw_candidates, list) and raw_candidates:
        deps.tool_state["resolve_candidates"] = raw_candidates
    if context.get("pending_clarify") is True:
        deps.tool_state["pending_clarify"] = True

    _seed_search_data(deps.tool_state, context)


async def run_pilgrimage_agent(
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

    run_result = await pilgrimage_agent.run(
        text,
        deps=deps,
        model=model,
        model_settings=model_settings,
        message_history=message_history or [],
    )
    raw_output = run_result.output
    if isinstance(raw_output, str):
        raise ValueError(
            f"Agent returned plain string instead of typed output: {raw_output[:200]}"
        )

    result = AgentResult(
        output=raw_output,
        steps=list(deps.steps),
        tool_state=dict(deps.tool_state),
        new_messages=list(run_result.new_messages()),
    )
    logger.info(
        "pilgrimage_agent_complete",
        intent=result.intent,
        steps=len(result.steps),
    )
    return result
