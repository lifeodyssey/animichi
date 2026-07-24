"""Runner: execute the pilgrimage agent and return AgentResult."""

from __future__ import annotations

import structlog
from pydantic import ValidationError
from pydantic_ai.exceptions import (
    ContentFilterError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage, UsageLimits
from pydantic_ai_harness.memory import MemoryStore

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.animichi_agent import (
    _input_guard_enabled,
    animichi_agent,
    build_animichi_agent,
    build_user_memory_capability,
    trusted_session_context,
)
from agent.agents.base import resolve_model_alias
from agent.agents.runtime_deps import (
    OnStep,
    RuntimeDeps,
    StepEvent,
    TitleTranslator,
    WebSearcher,
    new_step_call_id,
)
from agent.agents.runtime_models import (
    AgentResultOutput,
    BlockedResponseModel,
    ClarifyResponseModel,
    ErrorResponseModel,
    GreetingResponseModel,
    PartialResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.agents.session_state import CurrentAnime, SessionState
from agent.agents.tool_state import ToolState
from agent.agents.web_trust import detect_prompt_injection
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort

logger = structlog.get_logger(__name__)

# Preserve the pre-Phase 1d safety net; recalibration belongs in the follow-up.
REQUEST_LIMIT = 27
TOOL_CALLS_LIMIT = 40
RUN_USAGE_LIMITS = UsageLimits(
    request_limit=REQUEST_LIMIT,
    tool_calls_limit=TOOL_CALLS_LIMIT,
)

_STAGE_BY_OUTPUT: dict[type[AgentResultOutput], str] = {
    SearchResponseModel: "search",
    RouteResponseModel: "route",
    ClarifyResponseModel: "clarify",
    GreetingResponseModel: "greet_user",
    QAResponseModel: "general_qa",
    PartialResponseModel: "partial",
    BlockedResponseModel: "blocked",
    ErrorResponseModel: "error",
}

_PARTIAL_MESSAGES = {
    "en": "The processing limit was reached. Any results shown are partial; narrow the request to continue.",
    "ja": "処理上限に達しました。表示されているのは部分的な結果です。条件を絞って続けてください。",
    "zh": "已达到本次处理上限。当前显示的是部分结果，请缩小范围后继续。",
}

_BLOCKED_MESSAGES = {
    "en": "Request blocked. Please rephrase your anime pilgrimage request without instruction overrides.",
    "ja": "リクエストをブロックしました。指示の上書きを含めず、聖地巡礼の依頼を言い換えてください。",
    "zh": "请求已被拦截。请不要加入覆盖系统指令的内容，并重新描述你的圣地巡礼需求。",
}


def runtime_stage(output: AgentResultOutput, steps: list[StepRecord]) -> str:
    """Derive the stable stage from output type and server-recorded steps."""
    stage = _STAGE_BY_OUTPUT[type(output)]
    if stage == "search":
        return _last_tool(steps, {"search_bangumi", "search_nearby"})
    if stage == "route":
        return _last_tool(steps, {"plan_route", "plan_selected"})
    return stage


def _last_tool(steps: list[StepRecord], names: set[str]) -> str:
    for step in reversed(steps):
        if step.success and step.tool in names:
            return step.tool
    raise ValueError(f"No successful step for runtime stage: {sorted(names)}")


def _seed_geo_coords(tool_state: ToolState, context: dict[str, object]) -> None:
    origin_lat = context.get("origin_lat")
    origin_lng = context.get("origin_lng")
    if isinstance(origin_lat, int | float):
        tool_state.origin_lat = float(origin_lat)
    if isinstance(origin_lng, int | float):
        tool_state.origin_lng = float(origin_lng)


def _seed_session_state(tool_state: ToolState, context: dict[str, object]) -> None:
    raw = context.get("session_state_v2")
    if not isinstance(raw, dict):
        return
    try:
        tool_state.session = SessionState.model_validate(raw)
    except ValidationError:
        logger.warning("invalid_session_state_v2")


def _seed_current_anime(tool_state: ToolState, context: dict[str, object]) -> None:
    if tool_state.session.current_anime is not None:
        return
    bangumi_id = context.get("current_bangumi_id")
    title = context.get("current_anime_title")
    if isinstance(bangumi_id, str) and isinstance(title, str):
        tool_state.session.current_anime = CurrentAnime(
            bangumi_id=bangumi_id, title=title
        )


def _seed_tool_state(deps: RuntimeDeps, context: dict[str, object] | None) -> None:
    deps.tool_state.locale = deps.locale
    if context is None:
        return
    last_location = context.get("last_location")
    if isinstance(last_location, str) and last_location:
        deps.tool_state.last_location = last_location
    _seed_geo_coords(deps.tool_state, context)

    _seed_session_state(deps.tool_state, context)
    _seed_current_anime(deps.tool_state, context)
    session = deps.tool_state.session
    deps.ref_factory.reserve(
        [*map(str, session.search_results), *map(str, session.routes)]
    )


def _terminal_status(raw_output: AgentResultOutput) -> tuple[str | None, bool | None]:
    """SD-18: the error-boundary hook's recovered output is a terminal failure."""
    if isinstance(raw_output, ErrorResponseModel):
        return "error", False
    return None, None


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
    memory_store: MemoryStore | None = None,
    user_id: str | None = None,
) -> AgentResult:
    """Run the main agent and return AgentResult.

    The data tools route exclusively through the injected ``catalog`` client;
    the agent makes no upstream calls (no DB Retriever, no Anitabi/Bangumi).
    """
    deps = RuntimeDeps(
        db=db,
        locale=locale,
        query=text,
        user_id=user_id,
        on_step=on_step,
        catalog=catalog,
        web_searcher=web_searcher,
        title_translator=title_translator,
    )
    _seed_tool_state(deps, context)
    blocked = _injection_preflight(text, deps)
    if blocked is not None:
        return blocked
    resolved_model = resolve_model_alias(model)
    memory = build_user_memory_capability(memory_store, user_id)
    run_agent = build_animichi_agent(memory=memory) if memory else animichi_agent

    run_usage = RunUsage()
    try:
        run_result = await run_agent.run(
            [trusted_session_context(deps), text],
            deps=deps,
            model=resolved_model,
            model_settings=model_settings,
            message_history=message_history or [],
            usage_limits=RUN_USAGE_LIMITS,
            usage=run_usage,
        )
    except (UsageLimitExceeded, UnexpectedModelBehavior) as error:
        return _capped_partial_result(deps, run_usage, error)
    raw_output = run_result.output
    if isinstance(raw_output, ClarifyResponseModel):
        await _record_terminal_clarify(deps, raw_output)
    elif not isinstance(raw_output, ErrorResponseModel):
        # SD-18 P2-2: a recovered error is transient — a retry needs the same
        # pending clarification/geocode staging the failed attempt saw, not a
        # wiped one that turns the retry into a cold, un-contextualized query.
        deps.tool_state.session.pending_clarification = None
        deps.tool_state.session.geocode_staging = None
    status, success_override = _terminal_status(raw_output)
    result = AgentResult(
        output=raw_output,
        intent=runtime_stage(raw_output, deps.steps),
        session_state=deps.tool_state.session,
        steps=list(deps.steps),
        tool_state=deps.tool_state.to_legacy_dict(),
        new_messages=list(run_result.new_messages()),
        usage=run_usage,
        status=status,
        success_override=success_override,
    )
    logger.info(
        "animichi_agent_complete",
        intent=result.intent,
        steps=len(result.steps),
    )
    return result


def _partial_result(
    deps: RuntimeDeps,
    usage: RunUsage,
    *,
    new_messages: list[ModelMessage] | None = None,
) -> AgentResult:
    output = PartialResponseModel(message=_partial_message(deps.locale))
    return AgentResult(
        output=output,
        intent=runtime_stage(output, deps.steps),
        session_state=deps.tool_state.session,
        steps=list(deps.steps),
        tool_state=deps.tool_state.to_legacy_dict(),
        new_messages=new_messages or [],
        usage=usage,
        status="partial",
        success_override=False,
    )


def _capped_partial_result(
    deps: RuntimeDeps, run_usage: RunUsage, error: Exception
) -> AgentResult:
    """Honest partial for capped runs; content-filter refusals stay loud."""
    if isinstance(error, ContentFilterError):
        raise error
    event = (
        "animichi_agent_usage_limit"
        if isinstance(error, UsageLimitExceeded)
        else "animichi_agent_model_behavior_exhausted"
    )
    logger.warning(
        event,
        error_type=type(error).__name__,
        requests=run_usage.requests,
        tool_calls=run_usage.tool_calls,
    )
    return _partial_result(deps, run_usage)


def _partial_message(locale: str) -> str:
    return _PARTIAL_MESSAGES.get(locale, _PARTIAL_MESSAGES["ja"])


def _injection_preflight(text: str, deps: RuntimeDeps) -> AgentResult | None:
    if not detect_prompt_injection(text):
        return None
    logger.warning("input_guardrail_injection_detected", text=text[:100])
    if not _input_guard_enabled():
        return None
    return _blocked_result(deps)


def _blocked_result(deps: RuntimeDeps) -> AgentResult:
    output = BlockedResponseModel(message=_blocked_message(deps.locale))
    return AgentResult(
        output=output,
        intent=runtime_stage(output, deps.steps),
        session_state=deps.tool_state.session,
        steps=list(deps.steps),
        tool_state=deps.tool_state.to_legacy_dict(),
        usage=RunUsage(),
        status="blocked",
        success_override=False,
    )


def _blocked_message(locale: str) -> str:
    return _BLOCKED_MESSAGES.get(locale, _BLOCKED_MESSAGES["ja"])


async def _record_terminal_clarify(
    deps: RuntimeDeps, output: ClarifyResponseModel
) -> None:
    data = _clarify_step_data(output)
    deps.steps.append(_clarify_step_record(data))
    if deps.on_step is None:
        return
    await _emit_clarify_lifecycle(deps.on_step, data)


def _clarify_step_data(output: ClarifyResponseModel) -> dict[str, object]:
    return {"reason": output.reason, "candidate_ids": output.candidate_ids}


def _clarify_step_record(data: dict[str, object]) -> StepRecord:
    return StepRecord(tool="clarify", success=True, data=data, model_initiated=False)


async def _emit_clarify_lifecycle(on_step: OnStep, data: dict[str, object]) -> None:
    call_id = new_step_call_id("clarify")
    await on_step(StepEvent("clarify", call_id, "running", data))
    await on_step(StepEvent("clarify", call_id, "done", data))
