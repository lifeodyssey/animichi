"""Conversation history routes."""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from animichi.application.get_session_history import (
    ConversationRow,
    SessionRow,
    get_session_history,
)
from animichi.infrastructure.observability.runtime import record_history_request
from animichi.infrastructure.supabase.client import SupabaseClient
from animichi.interfaces.boundary.agent_models import GetSessionHistoryResponse
from animichi.interfaces.routes._deps import (
    ConversationPatchRequest,
    TrustedAuthContext,
    _error_response,
    _get_db_from_request,
    _json_response,
    _require_supabase,
    _require_trusted_user,
)

router = APIRouter(prefix="/v1", tags=["conversations"])


def _unauthorized() -> JSONResponse:
    return _error_response("unauthorized", "Missing user identity.", status_code=401)


def _as_text(value: object) -> str:
    return str(value) if isinstance(value, str) else ""


class SupabaseSessionHistoryAdapter:
    """Concrete Session/Message adapter over the Supabase client (SESSION-1)."""

    def __init__(self, db: SupabaseClient) -> None:
        self._session = db.session
        self._messages = db.messages
        self._revision = db.turn_reservation

    async def get_conversation(self, session_id: str) -> ConversationRow | None:
        row = await self._session.get_conversation(session_id)
        if row is None:
            return None
        return ConversationRow(
            user_id=_as_text(row.get("user_id")),
            session_id=_as_text(row.get("session_id")),
        )

    async def get_messages(
        self, session_id: str, *, limit: int, offset: int
    ) -> list[SessionRow]:
        rows = await self._messages.get_messages(session_id, limit=limit, offset=offset)
        return [
            SessionRow(
                role=_as_text(row.get("role")),
                content=_as_text(row.get("content")),
                response_data=row.get("response_data"),
                created_at=_as_text(row.get("created_at")),
            )
            for row in rows
        ]

    async def current_revision(self, session_id: str) -> int:
        return await self._revision.current_revision(session_id)


@router.get("/conversations")
async def handle_get_conversations(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    if auth.user_id is None:
        return _unauthorized()
    db = _require_supabase(_get_db_from_request(request))
    conversations_obj: object = await db.session.get_conversations(auth.user_id)
    return _json_response(conversations_obj)


@router.patch("/conversations/{session_id}")
async def handle_patch_conversation(
    session_id: str,
    payload: ConversationPatchRequest,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    if auth.user_id is None:
        return _unauthorized()
    db = _require_supabase(_get_db_from_request(request))
    conversation_obj: object = await db.session.get_conversation(session_id)
    conversation = conversation_obj if isinstance(conversation_obj, dict) else None
    if conversation is None or conversation.get("user_id") != auth.user_id:
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )
    await db.session.update_conversation_title(
        session_id, payload.title, user_id=auth.user_id
    )
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
    db = _require_supabase(_get_db_from_request(request))
    started = time.monotonic()
    history = await get_session_history(
        SupabaseSessionHistoryAdapter(db),
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
