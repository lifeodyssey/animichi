"""Persistence helpers for the runtime API.

Extracted from ``public_api`` to keep orchestration and persistence separated.
Each function is stateless — the ``db`` and ``session_store`` are passed in.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import cast

import structlog
from pydantic_core import to_jsonable_python

from animichi.agents.agent_result import AgentResult
from animichi.agents.session_state import (
    ItineraryPayloadState,
    PointState,
    SearchPayloadState,
)
from animichi.domain.ports import (
    BangumiRepo,
    ConversationLog,
    SessionRepo,
)
from animichi.domain.repo_types import SessionMetadata, SessionStateData
from animichi.infrastructure.session import SessionStore
from animichi.interfaces.schemas import (
    GRACEFUL_TERMINAL_STATUSES,
    PublicAPIRequest,
    PublicAPIResponse,
)
from animichi.interfaces.session_facade import (
    MAX_ROUTE_HISTORY,
    SessionUpdate,
    build_session_summary,
    build_updated_session_state,
    normalize_session_state,
)

logger = structlog.get_logger(__name__)

# Background tasks must be saved to prevent premature GC (python:S7502).
_background_tasks: set[asyncio.Task[object]] = set()


def _spawn_background(coro: object) -> None:
    """Create a background task and prevent premature garbage collection."""
    task: asyncio.Task[object] = asyncio.create_task(coro)  # type: ignore[arg-type]
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


# Common exception base for best-effort DB/IO persistence calls.
# SQLAlchemy surfaces connection failures as OSError subclasses (asyncpg
# wraps them) and deadlocks/statement errors as its own exceptions; we also
# catch RuntimeError (engine disposed) and ValueError (malformed data).
_PERSIST_ERRORS = (
    OSError,
    RuntimeError,
    ValueError,
    TypeError,
)


async def persist_result(
    *,
    session_repo: SessionRepo | None,
    bangumi_repo: BangumiRepo | None,
    messages_repo: ConversationLog | None,
    session_store: SessionStore,
    session_id: str,
    request: PublicAPIRequest,
    result: AgentResult | None,
    response: PublicAPIResponse,
    context_delta: dict[str, object],
    previous_state: dict[str, object],
    user_id: str | None,
) -> tuple[dict[str, object], bool, str | None]:
    """Persist session state, route, user state, and messages.

    Returns (session_state, user_message_persisted, generated_title).
    """
    new_messages_serialized: list[object] = (
        list(to_jsonable_python(result.new_messages))
        if result and result.new_messages
        else []
    )
    session_state = build_updated_session_state(
        previous_state,
        SessionUpdate(
            request=request,
            response_intent=response.intent,
            response_status=response.status,
            response_success=response.success,
            response_message=response.message,
            context_delta=context_delta,
            new_messages_serialized=new_messages_serialized,
        ),
    )

    route_record = None
    if result is not None:
        route_record = await maybe_persist_itinerary(
            bangumi_repo=bangumi_repo,
            session_id=session_id,
            request=request,
            result=result,
            response=response,
        )

    if route_record is not None:
        raw_rh = session_state["route_history"]
        route_history: list[object] = list(raw_rh) if isinstance(raw_rh, list) else []
        route_history.append(route_record)
        session_state["route_history"] = route_history[-MAX_ROUTE_HISTORY:]

    await persist_session(
        session_repo, session_store, session_id, session_state, response, user_id
    )
    await persist_messages(
        messages_repo=messages_repo,
        session_id=session_id,
        user_text=request.text,
        result=result,
        response=response,
        persist_user_only=(
            not response.success and response.status not in GRACEFUL_TERMINAL_STATUSES
        ),
    )

    # DECISION(2026-07-07): session compaction stays disabled pending proper
    # async task management — tracked in
    # docs/archive/plans/2026-07-07-refactor-backlog.md; re-evaluate when
    # conversation-history work lands.

    return session_state, True, None


async def _safe_insert_message(
    insert_fn: object,
    session_id: str,
    *args: object,
    label: str,
) -> None:
    """Best-effort message insert with structured logging on failure."""
    if not callable(insert_fn):
        return
    try:
        await insert_fn(session_id, *args)
    except _PERSIST_ERRORS:
        logger.warning(f"{label}_failed", session_id=session_id)


async def persist_messages(
    *,
    messages_repo: ConversationLog | None,
    session_id: str,
    user_text: str,
    result: AgentResult | None,
    response: PublicAPIResponse,
    persist_user_only: bool = False,
) -> None:
    """Persist user and bot messages to the ordered transcript (best-effort).

    Issue #663: this used to reflect ``getattr(db, "insert_message", None)``,
    which only matched a ``SupabaseClient`` that exposed a flat top-level
    ``insert_message`` method. The real implementation lives on the nested
    session repo (``FinalSessionRepository.insert_message``, SESSION-3 #961),
    so the probe always missed in production and every turn's messages
    silently went unwritten. ``messages_repo`` is now the exact typed repo,
    resolved once by the caller
    (``animichi.interfaces.db_repos.messages_repo``).
    """
    if messages_repo is None:
        return
    insert_message = messages_repo.insert_message

    # #273 T1: a selected_point_ids recompute carries no new utterance (the
    # client sends a part-less marker; ``_last_user_text`` derives ""). Never
    # persist an empty user row — history would render it as an empty bubble.
    if user_text != "":
        await _safe_insert_message(
            insert_message, session_id, "user", user_text, label="insert_user_message"
        )

    if persist_user_only:
        return

    response_data: dict[str, object] | None = None
    if result is not None:
        response_data = {
            "intent": result.intent,
            "success": result.success,
        }
    await _safe_insert_message(
        insert_message,
        session_id,
        "assistant",
        response.message,
        response_data,
        label="insert_bot_message",
    )


async def persist_session(
    session_repo: SessionRepo | None,
    session_store: SessionStore,
    session_id: str,
    session_state: dict[str, object],
    response: PublicAPIResponse,
    user_id: str | None,
) -> None:
    await session_store.set(session_id, session_state)

    if session_repo is not None:
        metadata: SessionMetadata = {
            "intent": response.intent,
            "status": response.status,
            "updated_at": session_state["updated_at"],
        }
        await session_repo.upsert_session(
            session_id,
            cast(SessionStateData, session_state),
            metadata=metadata,
            user_id=user_id,
        )


async def create_owned_session(
    session_repo: SessionRepo | None,
    session_id: str,
    user_id: str,
    first_query: str,
    session_state: dict[str, object],
) -> None:
    """Create one authenticated Session aggregate row atomically."""
    if session_repo is None:
        raise RuntimeError("authenticated sessions require a session repository")
    await session_repo.create(
        session_id, user_id, first_query, cast(SessionStateData, session_state)
    )


async def load_session_state(
    session_store: SessionStore, session_id: str
) -> dict[str, object]:
    state = await session_store.get(session_id)
    return normalize_session_state(state)


async def maybe_persist_itinerary(
    *,
    bangumi_repo: BangumiRepo | None,
    session_id: str,
    request: PublicAPIRequest,
    result: AgentResult,
    response: PublicAPIResponse,
) -> dict[str, object] | None:
    if result.provenance.itinerary is None:
        return None
    if not response.success and response.status != "partial":
        return None

    route_data = response.data.get("route")
    if not isinstance(route_data, dict):
        return None

    ordered_points = route_data.get("ordered_points")
    if not isinstance(ordered_points, list) or not ordered_points:
        return None

    point_ids = [
        str(point["id"])
        for point in ordered_points
        if isinstance(point, dict) and point.get("id") is not None
    ]
    if not point_ids:
        return None

    itinerary_state = _current_itinerary(result)
    if itinerary_state is None:
        return None
    anime_ids = await _existing_anime_ids(
        bangumi_repo, _itinerary_anime_ids(result, itinerary_state), session_id
    )
    origin_station = request.origin
    if (
        origin_station is None
        and request.origin_lat is not None
        and request.origin_lng is not None
    ):
        origin_station = f"{request.origin_lat},{request.origin_lng}"

    itinerary_record: dict[str, object] = {
        "route_id": None,
        "anime_ids": anime_ids,
        "origin_station": origin_station,
        "point_count": len(point_ids),
        "status": response.status,
        "created_at": datetime.now(UTC).isoformat(),
    }

    return itinerary_record


def _current_itinerary(result: AgentResult) -> ItineraryPayloadState | None:
    produced = result.provenance.itinerary
    if produced is None:
        return None
    return result.session_state.itineraries.get(produced.itinerary_ref)


async def _existing_anime_ids(
    bangumi_repo: BangumiRepo | None, anime_ids: list[str], session_id: str
) -> list[str]:
    if bangumi_repo is None:
        return anime_ids
    try:
        return await bangumi_repo.filter_existing_ids(anime_ids)
    except _PERSIST_ERRORS:
        logger.warning("filter_route_anime_failed", session_id=session_id)
        return []


def _itinerary_anime_ids(
    result: AgentResult, itinerary: ItineraryPayloadState
) -> list[str]:
    source = (
        result.session_state.search_results.get(itinerary.source_ref)
        if itinerary.source_ref is not None
        else None
    )
    if source is None:
        return _distinct_work_ids(itinerary.ordered_points)
    return _search_anime_ids(source)


def _search_anime_ids(source: SearchPayloadState) -> list[str]:
    if source.kind == "bangumi":
        return [source.anime_id] if source.anime_id else []
    if source.kind == "multi":
        omitted = set(source.omitted_work_ids or [])
        return [item for item in source.anime_ids or [] if item not in omitted]
    return _distinct_work_ids(source.rows)


def _distinct_work_ids(rows: list[PointState]) -> list[str]:
    values = (row.bangumi_id for row in rows)
    return list(dict.fromkeys(value for value in values if value))


def build_response_session(
    session_state: dict[str, object],
) -> tuple[dict[str, object], list[object]]:
    """Build session summary and route history for response."""
    session = build_session_summary(session_state)
    raw_rh = session_state["route_history"]
    route_history = list(raw_rh) if isinstance(raw_rh, list) else []
    return session, route_history


def extract_plan_steps(result: AgentResult | None) -> list[str] | None:
    if result is None:
        return None
    return [step.tool for step in result.steps]
