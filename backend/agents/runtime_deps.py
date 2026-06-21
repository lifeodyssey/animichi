"""Runtime dependencies for the PydanticAI-native pilgrimage agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from backend.agents.agent_result import StepRecord
from backend.clients.catalog_client import CatalogClientProtocol
from backend.domain.ports import DatabasePort

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
    tool_state: dict[str, object] = field(default_factory=dict)
    steps: list[StepRecord] = field(default_factory=list)
