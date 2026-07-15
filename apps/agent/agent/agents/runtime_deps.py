"""Runtime dependencies for the PydanticAI-native pilgrimage agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from agent.agents.agent_result import StepRecord
from agent.agents.tool_state import ToolState
from agent.agents.translation import TranslationResult
from agent.agents.web_trust import WebResult
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort

OnStep = Callable[[str, str, dict[str, object], str, str], Awaitable[None]]
WebSearcher = Callable[[str], Awaitable[list[WebResult]]]
TitleTranslator = Callable[[str, str], Awaitable[TranslationResult]]


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
    web_searcher: WebSearcher | None = None
    title_translator: TitleTranslator | None = None

    tool_state: ToolState = field(default_factory=ToolState)
    steps: list[StepRecord] = field(default_factory=list)
