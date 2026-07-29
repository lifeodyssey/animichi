"""Record the server-internal geocode substep outside model tool events."""

from __future__ import annotations

from agent.agents.agent_result import StepRecord
from agent.agents.runtime_deps import RuntimeDeps


def record_server_step(
    deps: RuntimeDeps,
    tool: str,
    params: dict[str, object],
    data: dict[str, object],
) -> None:
    deps.steps.append(
        StepRecord(
            tool=tool,
            success=True,
            params=params,
            data=data,
            model_initiated=False,
        )
    )
