"""Persistence helpers for the runtime API.

Extracted from ``public_api`` to keep orchestration and persistence separated.
Each function is stateless — the ``db`` and ``session_store`` are passed in.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import structlog
from pydantic_core import to_jsonable_python

from agent.agents.agent_result import AgentResult
from agent.domain.ports import (
    get_routes_repo,
    get_session_repo,
)
from agent.infrastructure.session import SessionStore
from agent.interfaces.schemas import (
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
        response=response,
        result=result,
    )
    await persist_messages(
        db=db,
        session_id=session_id,
        user_text=request.text,
        result=result,
        response=response,
        persist_user_only=not response.success,
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
    response: PublicAPIResponse,
    result: AgentResult | None,
) -> None:
    """Persist the authenticated user's conversation index entry."""
    if not user_id or result is None or not response.success:
        return

    session_repo = get_session_repo(db)
    if session_repo is not None:
        try:
            await session_repo.upsert_conversation(session_id, user_id, request.text)
        except _PERSIST_ERRORS:
            logger.warning("upsert_conversation_failed", session_id=session_id)
        # DECISION(2026-07-07): auto-generated conversation titles stay
        # disabled pending the conversation-history feature landing —
        # tracked in docs/superpowers/plans/2026-07-07-refactor-backlog.md.


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
    if not response.success or result.intent != "plan_route":
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

    plan_params = get_plan_params(result)
    bangumi_id_raw = plan_params.get("bangumi") or infer_bangumi_id(
        response.data.get("results")
    )
    if not isinstance(bangumi_id_raw, str):
        return None
    bangumi_id = bangumi_id_raw

    origin_station = plan_params.get("origin")
    if not isinstance(origin_station, str):
        origin_station = None
    if (
        origin_station is None
        and request.origin_lat is not None
        and request.origin_lng is not None
    ):
        origin_station = f"{request.origin_lat},{request.origin_lng}"

    route_record: dict[str, object] = {
        "route_id": None,
        "bangumi_id": bangumi_id,
        "origin_station": origin_station,
        "point_count": len(point_ids),
        "status": response.status,
        "created_at": datetime.now(UTC).isoformat(),
    }

    routes_repo = get_routes_repo(db)
    if routes_repo is not None:
        route_id = await routes_repo.save_route(
            session_id,
            bangumi_id,
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
        route_record["route_id"] = route_id

    return route_record


def build_response_session(
    session_state: dict[str, object],
) -> tuple[dict[str, object], list[object]]:
    """Build session summary and route history for response."""
    session = build_session_summary(session_state)
    raw_rh = session_state["route_history"]
    route_history = list(raw_rh) if isinstance(raw_rh, list) else []
    return session, route_history


def get_plan_params(result: AgentResult) -> dict[str, object]:
    for step in result.steps:
        if step.params:
            return dict(step.params)
    return {}


def infer_bangumi_id(results: object) -> str | None:
    if not isinstance(results, dict):
        return None
    rows = results.get("rows")
    if not isinstance(rows, list) or not rows:
        return None
    first_row = rows[0]
    if not isinstance(first_row, dict):
        return None
    bangumi_id = first_row.get("bangumi_id")
    return str(bangumi_id) if bangumi_id is not None else None


def extract_plan_steps(result: AgentResult | None) -> list[str] | None:
    if result is None:
        return None
    return [step.tool for step in result.steps]
