"""AgentResult — output of the PydanticAI pilgrimage agent run.

Replaces PipelineResult as the contract between agents and interfaces.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic_ai.messages import ModelMessage
from pydantic_ai.usage import RunUsage

from agent.agents.runtime_models import RuntimeStageOutput
from agent.agents.session_state import SessionState
from agent.agents.tool_state import LegacyPayload


@dataclass
class StepRecord:
    """One tool execution record."""

    tool: str
    success: bool
    params: dict[str, object] = field(default_factory=dict)
    data: dict[str, object] | None = None
    error: str | None = None


@dataclass
class AgentResult:
    """Output of pilgrimage agent run."""

    output: RuntimeStageOutput
    steps: list[StepRecord] = field(default_factory=list)
    tool_state: LegacyPayload = field(default_factory=dict)
    new_messages: list[ModelMessage] = field(default_factory=list)
    usage: RunUsage | None = None
    intent: str = ""
    session_state: SessionState = field(default_factory=SessionState)
    status: str | None = None
    success_override: bool | None = None

    def __post_init__(self) -> None:
        """Read the legacy output intent only for unmigrated constructors."""
        if self.intent:
            return
        self.intent = str(self.output.intent)

    @property
    def success(self) -> bool:
        if self.success_override is not None:
            return self.success_override
        return all(s.success for s in self.steps) if self.steps else True

    @property
    def message(self) -> str:
        return str(self.output.message)
