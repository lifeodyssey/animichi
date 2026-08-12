"""Domain port protocols for infrastructure dependencies.

These protocols define the interface that the agent/handler layer requires
from the database. The concrete ``SupabaseClient`` satisfies these protocols
structurally (PEP 544) — no inheritance needed.

Only methods actually *used* by the agent layer are declared here.

Note: Return types use ``dict[str, object]`` to match the asyncpg Record-to-dict
conversion in the concrete repositories. Protocol signatures must mirror
the implementation types for structural subtyping to work.

Iter6 C4: this module used to also carry seven ``get_*_repo``/``has_*_repo``
reflective accessors (``getattr`` + ``iscoroutinefunction`` + ``cast``,
duplicated per repo). They are gone from *this* module — callers
(``persistence.py``, ``usage_metering.py``, ``anon_quota.py``) now take the
narrow Protocol they need directly as a parameter instead of a raw
``db: object``. The extraction itself still needs one ``getattr`` +
``iscoroutinefunction`` + ``cast`` per repo (an isinstance-only, zero-getattr
version was tried and reverted — it silently broke on this codebase's plain
``MagicMock()`` test doubles; see the module docstring in
``animichi.interfaces.db_repos`` for why) — that logic now lives consolidated
in ``agent/interfaces/db_repos.py``, called once per repo from
``RuntimeAPI.__init__`` (``animichi.interfaces.public_api``), not scattered
across call sites. "Repo absent" is expressed by the resolved parameter
being ``None`` everywhere *downstream* of that one resolution point, never
by a second runtime probe deeper in the call chain.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol, runtime_checkable


class BangumiRepo(Protocol):
    """Bangumi-related DB operations used by handlers (read-only, #839).

    Writes to catalog master data were deleted: the agent is a read-only
    consumer and ingestion is the catalog Worker's job. Any write method
    added back here is a review blocker.
    """

    async def find_bangumi_by_title(self, title: str) -> str | None: ...

    async def find_all_by_title(self, title: str) -> list[dict[str, object]]: ...

    async def find_candidate_details_by_titles(
        self, titles: list[str]
    ) -> list[dict[str, object]]: ...

    async def filter_existing_ids(self, bangumi_ids: list[str]) -> list[str]: ...


class PointsRepo(Protocol):
    """Pilgrimage point DB operations used by handlers (read-only, #839)."""

    async def search_points_by_location(
        self,
        latitude: float,
        longitude: float,
        radius_m: int,
        *,
        limit: int = 50,
    ) -> list[dict[str, object]]: ...

    async def get_points_by_ids(
        self, point_ids: list[str]
    ) -> list[dict[str, object]]: ...


@runtime_checkable
class CatalogLookup(Protocol):
    """Structural protocol for the catalog-only DB dependency the agent

    layer (``run_animichi_agent`` / ``RuntimeDeps``) needs. Renamed from
    ``DatabasePort`` (iter6 C4) — the old name suggested a full database
    surface, but this narrow aggregate only ever covered ``bangumi`` +
    ``points``, the two repos catalog tools read from.
    """

    @property
    def bangumi(self) -> BangumiRepo: ...

    @property
    def points(self) -> PointsRepo: ...


class SessionRepo(Protocol):
    """Session-related DB operations used by persistence helpers.

    SESSION-3 (#961): the sole Session aggregate repository. ``create``
    inserts the aggregate row (state, ownership, first_query); ``upsert_session``
    commits state + metadata while recording the owner; ownership checks read
    the aggregate itself.
    """

    async def create(
        self,
        session_id: str,
        user_id: str,
        first_query: str,
        session_state: dict[str, object],
    ) -> None: ...

    async def upsert_session(
        self,
        session_id: str,
        session_state: dict[str, object],
        *,
        metadata: dict[str, object] | None = None,
        user_id: str | None = None,
    ) -> None: ...

    async def check_session_owner(self, session_id: str, user_id: str) -> bool: ...


class UsageMeter(Protocol):
    """Daily model-usage meter operations (issue #274 / S1.8).

    Renamed from ``UsageRepo`` (iter6 C4).
    """

    async def accumulate_usage(
        self,
        *,
        usage_date: date,
        scope: str,
        requests: int,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None: ...

    async def total_cost_usd(self, *, usage_date: date, scope: str) -> float: ...


class AnonQuotaCounter(Protocol):
    """Per-identity anonymous daily message counter (issue #282 / S1.10).

    Renamed from ``AnonQuotaRepo`` (iter6 C4). ``count_for`` is the read the
    admission gate uses; ``increment_and_count`` is the exactly-once settlement
    write owned by :class:`TurnOutcome` (TURN-3 #951).
    """

    async def count_for(self, *, usage_date: date, anon_id: str) -> int: ...

    async def increment_and_count(self, *, usage_date: date, anon_id: str) -> int: ...


class ConversationLog(Protocol):
    """Chat message persistence used by ``persistence.persist_messages``.

    SESSION-3 (#961): implemented by the sole Session aggregate repository
    (``FinalSessionRepository.insert_message``). The fourth positional
    parameter is named ``response_data`` to mirror the real implementation,
    not the ``data`` name a stale prior design draft used.
    """

    async def insert_message(
        self,
        session_id: str,
        role: str,
        content: str,
        response_data: dict[str, object] | None = None,
    ) -> None: ...


class RequestAudit(Protocol):
    """Request-log persistence used by ``RuntimeAPI._log_request``.

    New protocol (iter6 C4 / issue #663).
    """

    async def insert_request_log(
        self,
        *,
        session_id: str | None,
        query_text: str,
        locale: str,
        plan_steps: list[str] | None,
        intent: str | None,
        status: str,
        latency_ms: int | None,
    ) -> str: ...
