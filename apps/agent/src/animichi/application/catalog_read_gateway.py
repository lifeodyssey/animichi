"""Read-only gateway protocol for catalog access (application layer).

Layering rule: ``agents/`` is the PydanticAI/FastAPI **framework adapter** —
nothing in ``domain/`` or ``application/`` may import the FastAPI /
pydantic_ai runtime (or the httpx adapter in ``clients/``). This module is
the application-layer seam: it declares the catalog surface the agent
domain needs, read-only, with zero runtime imports beyond the stdlib.

Single production implementation: :class:`animichi.clients.catalog_client.CatalogClient`
(the catalog Worker RPC client). It satisfies this protocol structurally
(PEP 544); ``CatalogClientProtocol`` in ``clients/`` subclasses it so the
adapter layer inherits the same read-only contract.

#839: the agent must never write catalog master data. Writes used to exist
on the direct SQL path (``upsert_bangumi`` / ``upsert_point`` repos) and have
been deleted; this protocol is the enforcement point — a write method added
here is a review blocker.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Protocol, runtime_checkable

if TYPE_CHECKING:
    from animichi.clients.catalog_client import (
        GeocodeCandidate,
        PilgrimagePoint,
        ResolveOutcome,
        Route,
        SearchResult,
    )


@runtime_checkable
class CatalogReadGateway(Protocol):
    """Read-only catalog surface used by the agent domain.

    Mirrors the catalog Worker RPCs the agent consumes today (search, points,
    geocode, route planning). It deliberately declares no write/upsert/ingest
    method: ingestion is the catalog Worker's job and any SQL write path in
    the agent is a regression (see module docstring).
    """

    async def resolve(self, query: str) -> ResolveOutcome: ...

    async def points_by_work_id(self, work_id: str) -> SearchResult: ...

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]: ...

    async def geocode(
        self, query: str, *, limit: int = 5
    ) -> list[GeocodeCandidate]: ...

    async def route(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Route: ...
