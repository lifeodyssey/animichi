"""Persistence helpers for the runtime API.

Extracted from ``public_api`` to keep orchestration and persistence separated.
Each function is stateless — the ``db`` and ``session_store`` are passed in.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import asyncpg
import structlog
from pydantic_core import to_jsonable_python

from agent.agents.agent_result import AgentResult
from agent.agents.session_state import PointState, RoutePayloadState, SearchPayloadState
from agent.domain.ports import (
    get_bangumi_repo,
    get_routes_repo,
    get_session_repo,
)
from agent.infrastructure.session import SessionStore
from agent.interfaces.schemas import (
    GRACEFUL_TERMINAL_STATUSES,
    PublicAPIRequest,
    PublicAPIResponse,
)
from agent.interfaces.session_facade import (
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
# asyncpg raises asyncpg.PostgresError (subclass of Exception) for SQL errors
# and OSError for connection issues. We also catch RuntimeError (pool closed)
# and ValueError (malformed data).
_PERSIST_ERRORS = (OSError, RuntimeError, ValueError, TypeError)


async def persist_result(
    *,
    db: object,
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
        route_record = await maybe_persist_route(
            db=db,
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

    await persist_session(db, session_store, session_id, session_state, response)
    await persist_conversation(
        db=db,
        session_id=session_id,
        user_id=user_id,
        request=request,
    )
    await persist_messages(
        db=db,
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
    # docs/superpowers/plans/2026-07-07-refactor-backlog.md; re-evaluate when
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
    db: object,
    session_id: str,
    user_text: str,
    result: AgentResult | None,
    response: PublicAPIResponse,
    persist_user_only: bool = False,
) -> None:
    """Persist user and bot messages to conversation_messages (best-effort)."""
    insert_message = getattr(db, "insert_message", None)
    if insert_message is None:
        return

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
    db: object,
    session_store: SessionStore,
    session_id: str,
    session_state: dict[str, object],
    response: PublicAPIResponse,
) -> None:
    await session_store.set(session_id, session_state)

    session_repo = get_session_repo(db)
    if session_repo is not None:
        metadata = {
            "intent": response.intent,
            "status": response.status,
            "updated_at": session_state["updated_at"],
        }
        await session_repo.upsert_session(session_id, session_state, metadata=metadata)


async def persist_conversation(
    *,
    db: object,
    session_id: str,
    user_id: str | None,
    request: PublicAPIRequest,
) -> None:
    """Persist the authenticated user's conversation index entry."""
    if not user_id:
        return

    session_repo = get_session_repo(db)
    if session_repo is not None:
        await session_repo.upsert_conversation(session_id, user_id, request.text)
        # DECISION(2026-07-07): auto-generated conversation titles stay
        # disabled pending the conversation-history feature landing —
        # tracked in docs/superpowers/plans/2026-07-07-refactor-backlog.md.


async def create_owned_session(
    db: object,
    session_id: str,
    user_id: str,
    first_query: str,
    session_state: dict[str, object],
) -> None:
    """Create one authenticated session and ownership row atomically."""
    session_repo = get_session_repo(db)
    if session_repo is None:
        raise RuntimeError("authenticated sessions require a session repository")
    await session_repo.create_owned_session(
        session_id, user_id, first_query, session_state
    )


async def load_session_state(
    session_store: SessionStore, session_id: str
) -> dict[str, object]:
    state = await session_store.get(session_id)
    return normalize_session_state(state)


async def maybe_persist_route(
    *,
    db: object,
    session_id: str,
    request: PublicAPIRequest,
    result: AgentResult,
    response: PublicAPIResponse,
) -> dict[str, object] | None:
    if result.provenance.route is None:
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

    route_state = _current_route(result)
    if route_state is None:
        return None
    anime_ids = await _existing_anime_ids(
        db, _route_anime_ids(result, route_state), session_id
    )
    origin_station = request.origin
    if (
        origin_station is None
        and request.origin_lat is not None
        and request.origin_lng is not None
    ):
        origin_station = f"{request.origin_lat},{request.origin_lng}"

    route_record: dict[str, object] = {
        "route_id": None,
        "anime_ids": anime_ids,
        "origin_station": origin_station,
        "point_count": len(point_ids),
        "status": response.status,
        "created_at": datetime.now(UTC).isoformat(),
    }

    routes_repo = get_routes_repo(db)
    if routes_repo is not None:
        try:
            route_id = await routes_repo.save_route(
                session_id,
                anime_ids,
                point_ids,
                {
                    "message": response.message,
                    "results": response.data.get("results"),
                    "route": route_data,
                },
                origin_station=origin_station,
                origin_lat=request.origin_lat,
                origin_lon=request.origin_lng,
            )
        except asyncpg.PostgresError:
            logger.warning("save_route_failed", session_id=session_id)
            return None
        route_record["route_id"] = route_id

    return route_record


def _current_route(result: AgentResult) -> RoutePayloadState | None:
    produced = result.provenance.route
    if produced is None:
        return None
    return result.session_state.routes.get(produced.route_ref)


async def _existing_anime_ids(
    db: object, anime_ids: list[str], session_id: str
) -> list[str]:
    bangumi = get_bangumi_repo(db)
    if bangumi is None:
        return anime_ids
    try:
        return await bangumi.filter_existing_ids(anime_ids)
    except asyncpg.PostgresError:
        logger.warning("filter_route_anime_failed", session_id=session_id)
        return []


def _route_anime_ids(result: AgentResult, route: RoutePayloadState) -> list[str]:
    source = (
        result.session_state.search_results.get(route.source_ref)
        if route.source_ref is not None
        else None
    )
    if source is None:
        return _distinct_work_ids(route.ordered_points)
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
