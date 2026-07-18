"""Project-specific evaluators and expectations for the pilgrimage agent eval.

The official pydantic-evals adapters own argument, tool, trajectory, and hard
call-budget metrics. This module keeps the four project-specific metrics with no
official counterpart: data keys, locale, nonempty results, and visible-step
efficiency. Optional L3 outcome judges remain behind ``EVAL_L3=1``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_evals.evaluators import Evaluator, EvaluatorContext, LLMJudge

from agent.agents.agent_result import AgentResult
from agent.agents.session_state import RoutePayloadState, SearchPayloadState
from agent.utils.language import resolve_reply_language

EVALUATOR_VERSION = "official-v1"

# ── Case types (shared with the dataset builder) ─────────────────────


@dataclass
class AgentInput:
    """SUT input for one eval case."""

    query: str
    locale: str
    context: Mapping[str, object] | None = None
    selected_point_ids: list[str] | None = None
    selected_candidate_ids: list[str] | None = None
    clarification_id: int | None = None
    seeded_pending: Mapping[str, object] | None = None


@dataclass
class AgentExpected:
    """Per-case expectations, carried in the pydantic-evals ``metadata`` slot."""

    acceptable_stages: list[str]
    data_keys: list[str] = field(default_factory=list)
    expect_nonempty: bool = False


_Ctx = EvaluatorContext[AgentInput, AgentResult, AgentExpected]

# ── Stage → locally executed model-call span chains ──────────────────
# Synthetic terminal steps, internal helpers, and deterministic bypasses never
# produce PydanticAI tool spans and therefore do not belong in this vocabulary.
_GENERAL_QA_CHAINS = (
    (),
    ("web_search",),
    ("translate_anime_title",),
    ("web_search", "translate_anime_title"),
    ("translate_anime_title", "web_search"),
)
_STAGE_MODEL_CALL_CHAINS: dict[str, tuple[tuple[str, ...], ...]] = {
    "search_bangumi": (("resolve_anime", "search_bangumi"),),
    "search_nearby": (("search_nearby",),),
    "plan_route": (("resolve_anime", "search_bangumi", "plan_route"),),
    "plan_selected": ((),),
    "plan_multi": ((),),
    "clarify": (("resolve_anime",), ()),
    "clarify_after_nearby": (("search_nearby",),),
    "greet_user": ((),),
    "general_qa": _GENERAL_QA_CHAINS,
}

# Ideal step counts (carried over verbatim from the prior StepEfficiency table).
_STAGE_MIN_STEPS: dict[str, int] = {
    "search_bangumi": 2,
    "search_nearby": 1,
    "plan_route": 3,
    "plan_selected": 1,
    "plan_multi": 1,
    "clarify": 1,
    "clarify_after_nearby": 2,
    "greet_user": 0,
    "general_qa": 0,
}


def _actual_tools(output: AgentResult) -> list[str]:
    return [step.tool for step in output.steps]


def _model_call_chains(ctx: _Ctx) -> list[tuple[str, ...]]:
    stages = ctx.metadata.acceptable_stages if ctx.metadata else []
    if ctx.inputs.selected_point_ids is not None:
        return [()]
    if ctx.inputs.selected_candidate_ids is not None:
        return [()]
    return _model_call_chains_for_stages(stages)


def _seeded_reason(inputs: AgentInput) -> object:
    return inputs.seeded_pending.get("reason") if inputs.seeded_pending else None


def _model_call_chains_for_stages(stages: Sequence[str]) -> list[tuple[str, ...]]:
    chains = (
        chain
        for stage in stages
        for chain in _STAGE_MODEL_CALL_CHAINS.get(stage, ((),))
    )
    return list(dict.fromkeys(chains))


def _available_data_keys(result: AgentResult) -> set[str]:
    if result.intent == "clarify":
        pending = result.session_state.pending_clarification
        return {"reason", "candidates"} if pending is not None else set()
    search = _latest_search(result)
    route = _latest_route(result)
    keys: set[str] = set()
    if result.intent in {"search_bangumi", "search_nearby", "plan_multi"}:
        keys.update({"results"} if search is not None else set())
    if result.intent in {"plan_route", "plan_selected", "plan_multi"}:
        keys.update({"route"} if route is not None else set())
    return keys


def _latest_search(result: AgentResult) -> SearchPayloadState | None:
    produced = result.provenance.search
    if produced is None:
        return None
    return result.session_state.search_results.get(produced.result_ref)


def _latest_route(result: AgentResult) -> RoutePayloadState | None:
    produced = result.provenance.route
    if produced is None:
        return None
    return result.session_state.routes.get(produced.route_ref)


def _acceptable_min_steps(ctx: _Ctx) -> list[int]:
    stages = ctx.metadata.acceptable_stages if ctx.metadata else []
    if "plan_multi" in stages and ctx.inputs.selected_candidate_ids is not None:
        return [len(dict.fromkeys(ctx.inputs.selected_candidate_ids)) + 1]
    if _seeded_reason(ctx.inputs) == "place_ambiguity":
        return [1]
    if "clarify_after_nearby" in stages and "geocode" in _actual_tools(ctx.output):
        return [3]
    return [_STAGE_MIN_STEPS.get(stage, 2) for stage in stages] or [1]


# ── L1/L2 deterministic evaluators (free) ────────────────────────────


@dataclass
class DataKeysPresent(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """L1: 1.0 if all expected data keys are present in the response payload."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        expected = set(ctx.metadata.data_keys) if ctx.metadata else set()
        if not expected:
            return {"data_keys_present": 1.0}
        present = expected <= _available_data_keys(ctx.output)
        return {"data_keys_present": 1.0 if present else 0.0}


@dataclass
class NonemptyResults(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """L1: tagged nearby cases must return at least one catalog row."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        if not ctx.metadata or not ctx.metadata.expect_nonempty:
            return {}
        passed = _nonempty(ctx.output)
        return {"nonempty_results": 1.0 if passed else 0.0}


def _nonempty(result: AgentResult) -> bool:
    route = _latest_route(result)
    if route is None:
        search = _latest_search(result)
        return search is not None and search.row_count > 0
    if route.source_ref is None:
        return False
    source = result.session_state.search_results.get(route.source_ref)
    return bool(route.ordered_points) and source is not None and source.row_count > 0


@dataclass
class LocaleMatch(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """L1: match current-turn language, using the requested locale as fallback."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        message = ctx.output.message
        if not message:
            return {"locale_match": 0.0}
        expected = resolve_reply_language(ctx.inputs.query, ctx.inputs.locale)
        matched = resolve_reply_language(message, expected) == expected
        return {"locale_match": 1.0 if matched else 0.0}


@dataclass
class StepEfficiency(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """L2: ideal-steps / actual-steps, capped at 1.0 — measures wasted steps."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        actual = len(ctx.output.steps)
        if actual == 0:
            return {"step_efficiency": 1.0}
        best = max(min(m / actual, 1.0) for m in _acceptable_min_steps(ctx))
        return {"step_efficiency": best}


# ── L3 outcome judges (LLM, opt-in via EVAL_L3) ──────────────────────

_TASK_COMPLETION_RUBRIC = """\
You are grading a Japanese-anime pilgrimage assistant's response. It PASSES
(pass=true) only when EVERY applicable point holds:
1. Any locations returned belong to the anime the user asked about.
2. The reply language matches the user's query language (ja / zh / en).
3. It fabricates no bangumi_id, coordinates, or place names.
4. If the user asked for a route / itinerary / walking plan, an ordered route
   is present.
When a point does not apply to the query, ignore it. Return pass=false with a
short reason if any applicable point fails."""

_HALLUCINATION_RUBRIC = """\
You are checking a Japanese-anime pilgrimage assistant's response for
fabrication. It PASSES (pass=true) when it invents NO concrete facts — no
made-up bangumi_id, no invented latitude/longitude, and no real-world place
names presented as pilgrimage spots without grounding. General etiquette or
planning advice with no concrete invented locations passes. If any concrete
location, ID, or coordinate looks fabricated, return pass=false with the
offending detail."""


def build_l3_evaluators(
    model: Model,
) -> list[Evaluator[AgentInput, AgentResult, AgentExpected]]:
    """L3 outcome judges. Judge model runs at temperature 0 for determinism.

    Each judge emits a numeric score (1.0 pass / 0.0 fail) under a distinct name
    so both flow through the existing baseline + gate machinery independently.
    """
    settings = ModelSettings(temperature=0.0)
    return [
        LLMJudge(
            rubric=_TASK_COMPLETION_RUBRIC,
            model=model,
            include_input=True,
            model_settings=settings,
            assertion=False,
            score={"evaluation_name": "task_completion", "include_reason": True},
        ),
        LLMJudge(
            rubric=_HALLUCINATION_RUBRIC,
            model=model,
            include_input=True,
            model_settings=settings,
            assertion=False,
            score={"evaluation_name": "hallucination_check", "include_reason": True},
        ),
    ]
