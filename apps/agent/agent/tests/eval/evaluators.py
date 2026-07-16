"""Four-layer diagnostic evaluators for the pilgrimage agent eval.

Replaces the flat 6-metric set (IntentMatch / MessageQuality / ToolExecution /
DataCompleteness / StepEfficiency / ResponseLocale — see git history) with a
diagnostic pyramid:

- L1 component:  DataKeysPresent, LocaleMatch (+ tool precision)
- L2 trajectory: ToolCallRecall, RouteOrderCorrect, StepEfficiency
- L3 outcome:    TaskCompletion, HallucinationCheck (LLMJudge, opt-in EVAL_L3)

The deterministic L1/L2 layers are free and run every PR. L3 uses an LLM judge
(DeepSeek, temperature 0) and is gated behind ``EVAL_L3=1``.

Expected tool sets are derived from each case's ``acceptable_stages`` field via
the documented agent workflow (see ``animichi_agent`` instructions and the
prior StepEfficiency step-count table) — no new dataset labels are introduced.

``acceptable_stages`` is a *disjunction*: the agent is correct if it follows any
one acceptable stage. All trajectory metrics therefore score against the
best-matching acceptable stage. Chat stages accept both the recorded ephemeral
tool form and the legal zero-step ``general_qa`` form:
zero-step trajectories pass via the empty chain, recorded ephemeral one-tool
chains pass in-order, and wrong-tool trajectories fail route order while also
being punished by ``tool_f1``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_evals.evaluators import Evaluator, EvaluatorContext, LLMJudge

from agent.agents.agent_result import AgentResult
from agent.agents.session_state import RoutePayloadState, SearchPayloadState
from agent.interfaces.public_api import detect_language

EVALUATOR_VERSION = "phase1c-v1"

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

# ── Stage → acceptable ordered tool chains, from the agent workflow ──
# Data stages carry their full resolve->search[->plan] chain. Chat stages accept
# both recorded ephemeral-tool trajectories and legal zero-step trajectories.
_STAGE_TOOL_CHAINS: dict[str, tuple[tuple[str, ...], ...]] = {
    "search_bangumi": (("resolve_anime", "search_bangumi"),),
    "search_nearby": (("search_nearby",),),
    "plan_route": (("resolve_anime", "search_bangumi", "plan_route"),),
    "plan_selected": (("plan_selected",),),
    "plan_multi": (("plan_multi",),),
    "clarify": (("resolve_anime", "clarify"), ("geocode", "clarify")),
    "clarify_after_nearby": (
        ("search_nearby", "clarify"),
        ("geocode", "search_nearby", "clarify"),
    ),
    "greet_user": ((),),
    "general_qa": ((),),
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


def _chains(ctx: _Ctx) -> list[tuple[str, ...]]:
    stages = ctx.metadata.acceptable_stages if ctx.metadata else []
    if "plan_multi" in stages and ctx.inputs.selected_candidate_ids is not None:
        count = len(dict.fromkeys(ctx.inputs.selected_candidate_ids))
        return [("search_bangumi",) * count + ("plan_multi",)]
    if _seeded_reason(ctx.inputs) == "place_ambiguity":
        return [("search_nearby",)]
    return _chains_for_stages(stages)


def _seeded_reason(inputs: AgentInput) -> object:
    return inputs.seeded_pending.get("reason") if inputs.seeded_pending else None


def _chains_for_stages(stages: Sequence[str]) -> list[tuple[str, ...]]:
    return [chain for stage in stages for chain in _STAGE_TOOL_CHAINS.get(stage, ((),))]


def _f1(recall: float, precision: float) -> float:
    total = recall + precision
    return 2 * recall * precision / total if total else 0.0


def _prf(expected: tuple[str, ...], actual: list[str]) -> tuple[float, float, float]:
    """Return (recall, precision, f1) of an expected tool set vs actual tools."""
    actual_set = set(actual)
    if not expected:
        precision = 1.0 if not actual_set else 0.0
        return 1.0, precision, _f1(1.0, precision)
    hit = set(expected) & actual_set
    recall = len(hit) / len(expected)
    precision = len(hit) / len(actual_set) if actual_set else 0.0
    return recall, precision, _f1(recall, precision)


def _is_subsequence(chain: tuple[str, ...], actual: Sequence[str]) -> bool:
    """True when ``chain`` appears in ``actual`` in order (gaps allowed).

    The zero-step chain matches only a zero-step trajectory.
    """
    if not chain:
        return not actual
    remaining = iter(actual)
    return all(tool in remaining for tool in chain)


def route_order_score(
    acceptable_stages: Sequence[str], actual_tools: Sequence[str]
) -> float:
    chains = _chains_for_stages(acceptable_stages)
    if not chains:
        return 1.0
    return 1.0 if any(_is_subsequence(chain, actual_tools) for chain in chains) else 0.0


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
class ToolCallRecall(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """L2: tool-set recall/precision/F1 vs the best-matching acceptable stage."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        chains = _chains(ctx)
        if not chains:
            return {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0}
        actual = _actual_tools(ctx.output)
        recall, precision, f1 = max(
            (_prf(chain, actual) for chain in chains), key=lambda triple: triple[2]
        )
        return {"tool_recall": recall, "tool_precision": precision, "tool_f1": f1}


@dataclass
class RouteOrderCorrect(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """L2: 1.0 if any acceptable tool chain appears in-order in the trajectory."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        actual = _actual_tools(ctx.output)
        chains = _chains(ctx)
        correct = not chains or any(_is_subsequence(chain, actual) for chain in chains)
        return {"route_order_correct": 1.0 if correct else 0.0}


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
    """L1: 1.0 if the reply language matches the requested locale."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        message = ctx.output.message
        if not message:
            return {"locale_match": 0.0}
        matched = detect_language(message) == ctx.inputs.locale
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
