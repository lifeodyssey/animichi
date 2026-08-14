"""Conversation history routes."""

from __future__ import annotations

import time
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from animichi.application.get_session_history import (
    ConversationRow,
    SessionRow,
    get_session_history,
)
from animichi.infrastructure.observability.runtime import record_history_request
from animichi.infrastructure.persistence.repositories.session import (
    SQLModelSessionRepository,
)
from animichi.interfaces.boundary.agent_models import GetSessionHistoryResponse
from animichi.interfaces.routes._deps import (
    ConversationPatchRequest,
    TrustedAuthContext,
    _error_response,
    _get_db_from_request,
    _json_response,
    _require_db,
    _require_trusted_user,
)

router = APIRouter(prefix="/v1", tags=["conversations"])


def _unauthorized() -> JSONResponse:
    return _error_response("unauthorized", "Missing user identity.", status_code=401)


def _session_repo(request: Request) -> SQLModelSessionRepository:
    """The lifespan-owned SQLModel session repository (#994), falling back to
    the persistence aggregate's repo for test doubles."""
    repo = getattr(request.app.state, "session_repo", None)
    if repo is not None:
        return cast(SQLModelSessionRepository, repo)
    return _require_db(_get_db_from_request(request)).session


class SessionHistoryAdapter:
    """Concrete Session/Message adapter over the sole Session repository
    (SESSION-1 #959, SQLModel implementation by #994)."""

    def __init__(self, session: SQLModelSessionRepository) -> None:
        self._session = session

    async def get_conversation(self, session_id: str) -> ConversationRow | None:
        row = await self._session.load(session_id)
        if row is None:
            return None
        return ConversationRow(
            user_id=row.user_id,
            session_id=row.session_id,
        )

    async def get_messages(
        self, session_id: str, *, limit: int, offset: int
    ) -> list[SessionRow]:
        rows = await self._session.get_messages(session_id, limit=limit, offset=offset)
        return [
            SessionRow(
                role=row.role,
                content=row.content,
                response_data=row.response_data,
                created_at=row.created_at,
            )
            for row in rows
        ]

    async def current_revision(self, session_id: str) -> int:
        return await self._session.current_revision(session_id)


@router.get("/conversations")
async def handle_get_conversations(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    if auth.user_id is None:
        return _unauthorized()
    repo = _session_repo(request)
    sessions_obj: object = await repo.list_sessions(auth.user_id)
    return _json_response(sessions_obj)


@router.patch("/conversations/{session_id}")
async def handle_patch_conversation(
    session_id: str,
    payload: ConversationPatchRequest,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    if auth.user_id is None:
        return _unauthorized()
    repo = _session_repo(request)
    record = await repo.load(session_id)
    if record is None or record.user_id != auth.user_id:
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )
    await repo.update_title(session_id, payload.title, user_id=auth.user_id)
    return _json_response({"ok": True})


@router.get(
    "/conversations/{session_id}/messages",
    response_model=GetSessionHistoryResponse,
)
async def handle_get_messages(
    session_id: str,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0, le=1_000)] = 0,
) -> JSONResponse | GetSessionHistoryResponse:
    """GetSessionHistory: one owned, ordered page plus the session revision.

    Missing and forbidden conversations collapse to the same 404. Outcome,
    message count, revision, and duration are recorded — never the actor or
    any message content.
    """
    if auth.user_id is None:
        return _unauthorized()
    repo = _session_repo(request)
    started = time.monotonic()
    history = await get_session_history(
        SessionHistoryAdapter(repo),
        session_id=session_id,
        user_id=auth.user_id,
        limit=limit,
        offset=offset,
    )
    duration_ms = (time.monotonic() - started) * 1000
    if history is None:
        record_history_request(
            duration_ms=duration_ms,
            outcome="not_found",
            message_count=0,
            revision=0,
        )
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )
    record_history_request(
        duration_ms=duration_ms,
        outcome="ok",
        message_count=len(history.messages),
        revision=history.revision,
    )
    return history
