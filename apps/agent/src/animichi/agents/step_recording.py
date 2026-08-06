"""Record the server-internal geocode substep outside model tool events."""

from __future__ import annotations

from animichi.agents.agent_result import StepRecord
from animichi.agents.runtime_deps import RuntimeDeps


def record_server_step(
    deps: RuntimeDeps,
    tool: str,
    params: dict[str, object],
    data: dict[str, object],
) -> None:
    deps.steps.append(
        StepRecord(
            tool=tool,
            is_success=True,
            params=params,
            data=data,
            model_initiated=False,
        )
    )
