"""Additive adapters for pydantic-evals' official agentic evaluators.

The official classes accept one fixed expectation, while this dataset stores a
disjunction of acceptable stage chains in each case's metadata. The tool and
trajectory adapters therefore run one official evaluator per chain and retain
the best score. This preserves the dataset's ``ANY of N`` contract without
changing the official evaluator implementations or the canonical cases.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from pydantic_evals.evaluators import (
    ArgumentCorrectness,
    EvaluationReason,
    Evaluator,
    MaxToolCalls,
    ToolCorrectness,
    TrajectoryMatch,
)

from agent.agents.agent_result import AgentResult
from agent.tests.eval.evaluators import AgentExpected, AgentInput, _chains, _Ctx


def _value(result: EvaluationReason) -> float:
    return float(result.value)


def _best(results: list[EvaluationReason], *, empty: float = 1.0) -> float:
    return max((_value(result) for result in results), default=empty)


def _max_tool_calls(ctx: _Ctx) -> int:
    chains = _chains(ctx)
    return max((len(chain) for chain in chains), default=0)


@dataclass
class OfficialToolCorrectness(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """Official multiset match, scored against the best accepted chain."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        results = [ToolCorrectness(list(chain)).evaluate(ctx) for chain in _chains(ctx)]
        return {"tool_correctness_official": _best(results)}


@dataclass
class OfficialTrajectoryMatch(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """Official in-order F1, scored against the best accepted chain."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        results = [
            TrajectoryMatch(list(chain), order="in_order").evaluate(ctx)
            for chain in _chains(ctx)
        ]
        return {"trajectory_match_official": _best(results)}


@dataclass
class OfficialArgumentCorrectness(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """Compare raw span arguments with each successful step's normalized params."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        occurrences: dict[str, int] = {}
        results: list[EvaluationReason] = []
        for step in (item for item in ctx.output.steps if item.success):
            occurrence = occurrences.get(step.tool, 0)
            occurrences[step.tool] = occurrence + 1
            results.append(self._evaluate_step(ctx, step.tool, step.params, occurrence))
        return {"argument_correctness_official": min(map(_value, results), default=1.0)}

    @staticmethod
    def _evaluate_step(
        ctx: _Ctx, tool: str, params: dict[str, object], occurrence: int
    ) -> EvaluationReason:
        evaluator = ArgumentCorrectness(
            tool, params, match_mode="exact", occurrence=occurrence
        )
        return evaluator.evaluate(ctx)


@dataclass
class OfficialMaxToolCalls(Evaluator[AgentInput, AgentResult, AgentExpected]):
    """Official hard call budget derived from the longest accepted chain."""

    def evaluate(self, ctx: _Ctx) -> Mapping[str, float]:
        result = MaxToolCalls(_max_tool_calls(ctx)).evaluate(ctx)
        return {"max_tool_calls_official": _value(result)}
