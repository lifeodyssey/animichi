"""Shared StepRecord appender for the catalog tool modules."""

from __future__ import annotations

from agent.agents.agent_result import StepProvenance, StepRecord
from agent.agents.runtime_deps import RuntimeDeps


def _record(
    deps: RuntimeDeps,
    tool: str,
    params: dict[str, object],
    data: dict[str, object],
    *,
    success: bool = True,
    provenance: StepProvenance | None = None,
    model_initiated: bool = True,
) -> None:
    deps.steps.append(
        StepRecord(
            tool=tool,
            success=success,
            params=params,
            data=data,
            provenance=provenance,
            model_initiated=model_initiated,
        )
    )
