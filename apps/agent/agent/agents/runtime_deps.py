"""Runtime dependencies for the PydanticAI-native pilgrimage agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field

from agent.agents.agent_result import StepRecord
from agent.agents.tool_state import ToolState
from agent.agents.translation import TranslationResult
from agent.agents.web_trust import WebResult
from agent.clients.catalog_client import CatalogClientProtocol
from agent.domain.ports import DatabasePort


@dataclass(frozen=True)
class StepEvent:
    """One immutable progress event delivered to runtime adapters."""

    tool: str
    status: str
    data: dict[str, object]
    thought: str = ""
    observation: str = ""


OnStep = Callable[[StepEvent], Awaitable[None]]
WebSearcher = Callable[[str], Awaitable[list[WebResult]]]
TitleTranslator = Callable[[str, str], Awaitable[TranslationResult]]


@dataclass
class RefFactory:
    """Generate deterministic, session-local opaque registry refs."""

    sequence: int = 0
    reserved: set[str] = field(default_factory=set)

    def reserve(self, refs: Iterable[str]) -> None:
        """Prevent a hydrated session ref from being minted again."""
        self.reserved.update(refs)

    def __call__(self, kind: str, revision: int) -> str:
        while True:
            self.sequence += 1
            candidate = f"{kind}:{revision}:{self.sequence}"
            if candidate not in self.reserved:
                self.reserved.add(candidate)
                return candidate


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
    ref_factory: RefFactory = field(default_factory=RefFactory)

    tool_state: ToolState = field(default_factory=ToolState)
    steps: list[StepRecord] = field(default_factory=list)
