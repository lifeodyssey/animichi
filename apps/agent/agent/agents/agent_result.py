"""AgentResult — output of the PydanticAI pilgrimage agent run.

Replaces PipelineResult as the contract between agents and interfaces.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, TypeAlias

from pydantic_ai.messages import ModelMessage
from pydantic_ai.usage import RunUsage

from agent.agents.runtime_models import AgentResultOutput
from agent.agents.session_state import ResultRef, RouteRef, SessionState
from agent.agents.tool_state import LegacyPayload


@dataclass(frozen=True)
class ProducedSearch:
    """A search registry entry produced by the current transition."""

    outcome: Literal["ok", "empty"]
    result_ref: ResultRef


@dataclass(frozen=True)
class RejectedSearch:
    """A current search outcome that did not produce a registry entry."""

    outcome: Literal[
        "place_ambiguity",
        "place_unresolved",
        "missing_location",
        "upstream_unavailable",
    ]


@dataclass(frozen=True)
class ProducedRoute:
    """A route registry entry produced by the current transition."""

    status: Literal["ok"]
    route_ref: RouteRef


@dataclass(frozen=True)
class RejectedRoute:
    """A current route outcome that did not produce a registry entry."""

    status: Literal["empty", "stale_ref", "pending_sync", "upstream_unavailable"]


StepProvenance: TypeAlias = (
    ProducedSearch | RejectedSearch | ProducedRoute | RejectedRoute
)
StepData: TypeAlias = dict[str, object]


@dataclass(frozen=True)
class TurnProvenance:
    """Exact producing refs owned by one completed agent transition."""

    search: ProducedSearch | None = None
    route: ProducedRoute | None = None


@dataclass
class StepRecord:
    """One tool execution record."""

    tool: str
    success: bool
    params: StepData = field(default_factory=dict)
    data: StepData | None = None
    provenance: StepProvenance | None = None
    error: str | None = None
    model_initiated: bool = True
    # False when the call's arguments could not be projected (#443). Empty
    # `params` then means "unknown", not "called with no arguments" — consumers
    # that compare calls by arguments must not equate two unknowns.
    params_recorded: bool = True


@dataclass
class AgentResult:
    """Output of pilgrimage agent run."""

    output: AgentResultOutput
    intent: str
    session_state: SessionState
    steps: list[StepRecord] = field(default_factory=list)
    tool_state: LegacyPayload = field(default_factory=dict)
    new_messages: list[ModelMessage] = field(default_factory=list)
    usage: RunUsage | None = None
    status: str | None = None
    success_override: bool | None = None
    provenance: TurnProvenance = field(default_factory=TurnProvenance)

    def __post_init__(self) -> None:
        if self.provenance == TurnProvenance():
            self.provenance = _turn_provenance(self.steps)

    @property
    def success(self) -> bool:
        if self.success_override is not None:
            return self.success_override
        return all(s.success for s in self.steps) if self.steps else True

    @property
    def message(self) -> str:
        return str(self.output.message)


def _turn_provenance(steps: list[StepRecord]) -> TurnProvenance:
    return TurnProvenance(
        search=_last_search_provenance(steps), route=_last_route_provenance(steps)
    )


def _last_search_provenance(steps: list[StepRecord]) -> ProducedSearch | None:
    for step in reversed(steps):
        if isinstance(step.provenance, ProducedSearch):
            return step.provenance
        if isinstance(step.provenance, RejectedSearch):
            return None
    return None


def _last_route_provenance(steps: list[StepRecord]) -> ProducedRoute | None:
    for step in reversed(steps):
        if isinstance(step.provenance, ProducedRoute):
            return step.provenance
        if isinstance(step.provenance, RejectedRoute):
            return None
    return None
