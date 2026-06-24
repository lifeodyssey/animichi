"""Runtime dependencies for the PydanticAI-native pilgrimage agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from agent.agents.agent_result import StepRecord
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort

OnStep = Callable[[str, str, dict[str, object], str, str], Awaitable[None]]


@dataclass
class RuntimeDeps:
    """Deps container injected into pilgrimage agent runs."""

    db: DatabasePort
    locale: str
    query: str

    # Catalog read path. Every tool — the four data tools AND clarify candidate
    # enrichment — routes exclusively through this client; the agent is
    # catalog-only and makes no upstream calls. Required so a missing client
    # fails loudly instead of silently bypassing the catalog.
    catalog: CatalogClientProtocol

    on_step: OnStep | None = None

    # Mutable per-run state accumulated during the agent run.
    # ponytail: mixes two concerns — fixed session fields (origin_lat/lng, locale,
    # last_location, resolve_candidates, pending_clarify) that should be typed
    # dataclass fields, plus ToolName-keyed tool results (genuinely dynamic, legit).
    # Reads are all literal-key. Cleanup (split into typed session state + a
    # dict[ToolName, ...] results map, ~8 files) deferred to the Wave 3 agent→Worker
    # runtime rewrite — see memory project_tool_state_followup.
    tool_state: dict[str, object] = field(default_factory=dict)
    steps: list[StepRecord] = field(default_factory=list)
