"""Vercel AI SDK chat endpoint — streams via PydanticAI VercelAIAdapter."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated, Protocol, cast

import structlog
from fastapi import APIRouter, Depends, Request
from pydantic_ai.messages import ModelMessage
from pydantic_ai.run import AgentRunResult
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
from pydantic_ai.ui.vercel_ai.response_types import BaseChunk, DataChunk
from starlette.responses import Response

from backend.agents.pilgrimage_runner import pilgrimage_agent
from backend.agents.retriever import Retriever
from backend.agents.runtime_deps import RuntimeDeps
from backend.domain.ports import DatabasePort
from backend.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_runtime_api,
    _require_trusted_user,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1", tags=["chat"])


class _HasBody(Protocol):
    """Minimal protocol for objects that expose an async body() method."""

    async def body(self) -> bytes: ...


def _parse_body_fields(
    raw: bytes,
) -> tuple[str | None, str]:
    """Extract session_id and locale from raw body bytes."""
    parsed = json.loads(raw)
    session_id = parsed.get("session_id")
    locale = parsed.get("locale", "ja")
    if isinstance(session_id, str):
        session_id = session_id.strip() or None
    else:
        session_id = None
    if locale not in ("ja", "zh", "en"):
        locale = "ja"
    return session_id, locale


async def _parse_body(request: _HasBody) -> tuple[bytes, str | None, str]:
    """Read body once and extract session_id + locale."""
    raw = await request.body()
    session_id, locale = _parse_body_fields(raw)
    return raw, session_id, locale


async def _load_history(
    request: Request,
    session_id: str | None,
    user_id: str | None,
) -> list[ModelMessage]:
    """Load message history from existing session."""
    if session_id is None:
        return []
    runtime_api = _get_runtime_api(request)
    from backend.interfaces.schemas import PublicAPIRequest

    stub = PublicAPIRequest(text="", session_id=session_id)
    _, _, history = await runtime_api._load_session(session_id, user_id, stub)
    return history


def _build_deps(
    db: DatabasePort,
    locale: str,
    query: str,
) -> RuntimeDeps:
    """Build RuntimeDeps without on_step (adapter handles streaming)."""
    return RuntimeDeps(
        db=db,
        locale=locale,
        query=query,
        retriever=Retriever(db),
    )


def _extract_query(raw: bytes) -> str:
    """Extract the last user message text from Vercel body."""
    parsed = json.loads(raw)
    messages = parsed.get("messages", [])
    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        parts = msg.get("parts", [])
        for part in parts:
            if part.get("type") == "text":
                text = part.get("text", "")
                if isinstance(text, str) and text.strip():
                    return text.strip()
    return ""


@router.post("/chat")
async def handle_chat(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> Response:
    """Handle Vercel AI SDK chat requests via VercelAIAdapter."""
    raw, session_id, locale = await _parse_body(request)
    query = _extract_query(raw)
    history = await _load_history(request, session_id, auth.user_id)

    runtime_api = _get_runtime_api(request)
    db = cast(DatabasePort, runtime_api._db)
    deps = _build_deps(db, locale, query)

    adapter = VercelAIAdapter(
        agent=pilgrimage_agent,
        run_input=VercelAIAdapter.build_run_input(raw),
        accept=request.headers.get("accept"),
        sdk_version=6,
    )

    async def on_complete(
        result: AgentRunResult[object],
    ) -> AsyncIterator[BaseChunk]:
        metadata: dict[str, object] = {
            "intent": deps.tool_state.get("last_intent", "unknown"),
            "session_id": session_id,
        }
        yield DataChunk(type="data-session", data=metadata)

    return adapter.streaming_response(
        adapter.run_stream(
            deps=deps,
            message_history=history,
            on_complete=on_complete,
        ),
    )
