from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from pydantic_evals.evaluators import EvaluatorContext
from pydantic_evals.otel.span_tree import SpanNode, SpanTree

from agent.agents.agent_result import (
    AgentResult,
    ProducedRoute,
    ProducedSearch,
    StepRecord,
    TurnProvenance,
)
from agent.agents.runtime_models import QAResponseModel, RuntimeStageOutput
from agent.agents.session_state import SessionState
from agent.tests.eval.evaluators import AgentExpected, AgentInput


def steps(*tools: str) -> list[StepRecord]:
    return [StepRecord(tool=tool, success=True) for tool in tools]


def result(
    records: list[StepRecord],
    output: RuntimeStageOutput | None = None,
    *,
    intent: str = "general_qa",
    state: SessionState | None = None,
) -> AgentResult:
    out = output or QAResponseModel(message="テスト")
    return AgentResult(
        output=out,
        intent=intent,
        session_state=state or SessionState(),
        steps=records,
        provenance=_provenance(intent, state or SessionState()),
    )


def _provenance(intent: str, state: SessionState) -> TurnProvenance:
    search = None
    route = None
    if intent in {"search_bangumi", "search_nearby", "plan_multi"}:
        ref = state.last_result_ref
        if ref is not None:
            outcome = "ok" if state.search_results[ref].row_count else "empty"
            search = ProducedSearch(outcome=outcome, result_ref=ref)
    if intent in {"plan_route", "plan_selected", "plan_multi"} and state.route_lru:
        route = ProducedRoute(status="ok", route_ref=state.route_lru[-1])
    return TurnProvenance(search=search, route=route)


def ctx(
    inputs: AgentInput,
    output: AgentResult,
    meta: AgentExpected,
    span_tree: SpanTree | None = None,
) -> EvaluatorContext[AgentInput, AgentResult, AgentExpected]:
    return EvaluatorContext(
        name="t",
        inputs=inputs,
        metadata=meta,
        expected_output=None,
        output=output,
        duration=0.0,
        _span_tree=span_tree or SpanTree(),
        attributes={},
        metrics={},
    )


def tool_span(tool: str, arguments: dict[str, object], index: int) -> SpanNode:
    start = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=index)
    return SpanNode(
        name=f"execute_tool {tool}",
        trace_id=1,
        span_id=index + 1,
        parent_span_id=None,
        start_timestamp=start,
        end_timestamp=start + timedelta(milliseconds=1),
        attributes={
            "gen_ai.tool.name": tool,
            "gen_ai.tool.call.arguments": json.dumps(arguments),
        },
        status="ok",
    )


def span_tree(*spans: SpanNode) -> SpanTree:
    return SpanTree(nodes_by_id={span.node_key: span for span in spans})


JA = AgentInput(query="q", locale="ja")
