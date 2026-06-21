"""Runtime dependencies for the PydanticAI-native pilgrimage agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from backend.agents.agent_result import StepRecord
from backend.clients.catalog_client import CatalogClientProtocol
from backend.domain.ports import DatabasePort
from backend.infrastructure.gateways.bangumi import BangumiClientGateway

OnStep = Callable[[str, str, dict[str, object], str, str], Awaitable[None]]


@dataclass
class RuntimeDeps:
    """Deps container injected into pilgrimage agent runs."""

    db: DatabasePort
    locale: str
    query: str

    # Catalog read path. The four data tools route exclusively through this
    # client; the agent is catalog-only and makes no upstream calls. Required so
    # a missing client fails loudly instead of silently bypassing the catalog.
    catalog: CatalogClientProtocol

    # Bangumi gateway is used only by the clarify enrichment path to fetch cover
    # art / candidate metadata — never by the data read tools.
    gateway: BangumiClientGateway = field(default_factory=BangumiClientGateway)
    on_step: OnStep | None = None

    # Mutable per-run state accumulated during the agent run.
    tool_state: dict[str, object] = field(default_factory=dict)
    steps: list[StepRecord] = field(default_factory=list)
