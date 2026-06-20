"""Runtime dependencies for the PydanticAI-native pilgrimage agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from backend.agents.agent_result import StepRecord
from backend.agents.retriever import Retriever
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

    # Catalog read path. When set, the data tools route through this client
    # instead of the DB Retriever / upstream APIs (hybrid architecture seam).
    catalog: CatalogClientProtocol | None = None
    gateway: BangumiClientGateway = field(default_factory=BangumiClientGateway)
    retriever: Retriever | None = None
    on_step: OnStep | None = None

    # Mutable per-run state accumulated during the agent run.
    tool_state: dict[str, object] = field(default_factory=dict)
    steps: list[StepRecord] = field(default_factory=list)
