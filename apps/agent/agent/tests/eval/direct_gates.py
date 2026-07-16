"""Typed deterministic red-line gates for model-initiated eval activity."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from agent.agents.agent_result import AgentResult

REQUEST_LIMIT = 12
TOOL_CALL_LIMIT = 6
REQUEST_P95_LIMIT = 6


@dataclass(frozen=True)
class RecordedToolCall:
    """Canonical identity for one model-initiated tool call."""

    tool: str
    arguments: str

    @classmethod
    def from_arguments(
        cls, tool: str, arguments: Mapping[str, object]
    ) -> RecordedToolCall:
        encoded = json.dumps(
            arguments, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        return cls(tool=tool, arguments=encoded)


@dataclass(frozen=True)
class TrajectoryCase:
    """Model request usage and model-initiated calls for one eval case."""

    case_id: str
    requests: int
    tool_calls: tuple[RecordedToolCall, ...] = field(default_factory=tuple)

    @classmethod
    def from_result(cls, case_id: str, result: AgentResult) -> TrajectoryCase:
        requests = result.usage.requests if result.usage is not None else 0
        calls = tuple(
            RecordedToolCall.from_arguments(step.tool, step.params)
            for step in result.steps
            if step.model_initiated
        )
        return cls(case_id=case_id, requests=requests, tool_calls=calls)


def direct_thrash_gate(cases: Sequence[TrajectoryCase]) -> list[str]:
    """Return merge-blocking failures for the direct loop limits."""
    failures = [failure for case in cases for failure in _case_failures(case)]
    request_p95 = _request_p95(cases)
    if request_p95 > REQUEST_P95_LIMIT:
        failures.append(f"request_p95={request_p95} exceeds limit={REQUEST_P95_LIMIT}")
    return failures


def print_direct_thrash_metrics(
    cases: Sequence[TrajectoryCase], *, include_p95: bool, enforced: bool
) -> None:
    """Print direct activity metrics even when they are report-only."""
    mode = "enforced" if enforced else "report-only"
    print(f"\nDirect thrash metrics ({mode}):")
    for case in cases:
        print(
            f"{case.case_id}: requests={case.requests} "
            f"tool_calls={len(case.tool_calls)} repeats={_repeat_count(case)}"
        )
    if include_p95:
        print(f"request_p95={_request_p95(cases)}")


def _case_failures(case: TrajectoryCase) -> list[str]:
    failures: list[str] = []
    if case.requests > REQUEST_LIMIT:
        failures.append(
            f"{case.case_id}: requests={case.requests} exceeds limit={REQUEST_LIMIT}"
        )
    if len(case.tool_calls) > TOOL_CALL_LIMIT:
        failures.append(
            f"{case.case_id}: tool_calls={len(case.tool_calls)} "
            f"exceeds limit={TOOL_CALL_LIMIT}"
        )
    failures.extend(_repeat_failures(case))
    return failures


def _repeat_failures(case: TrajectoryCase) -> list[str]:
    seen: set[RecordedToolCall] = set()
    repeated: set[str] = set()
    for call in case.tool_calls:
        if call in seen:
            repeated.add(call.tool)
        seen.add(call)
    return [
        f"{case.case_id}: repeated identical tool call: {tool}"
        for tool in sorted(repeated)
    ]


def _repeat_count(case: TrajectoryCase) -> int:
    return len(case.tool_calls) - len(set(case.tool_calls))


def _request_p95(cases: Sequence[TrajectoryCase]) -> int:
    requests = sorted(case.requests for case in cases if case.requests > 0)
    if not requests:
        return 0
    rank = math.ceil(0.95 * len(requests)) - 1
    return requests[rank]
