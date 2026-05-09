"""Vercel AI SDK chat endpoint — streams via PydanticAI VercelAIAdapter.

Uses the official dispatch_request pattern:
https://pydantic.dev/docs/ai/integrations/ui/vercel-ai/
"""

from __future__ import annotations

from typing import Annotated, cast

import structlog
from fastapi import APIRouter, Depends, Request
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
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


@router.post("/chat")
async def handle_chat(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> Response:
    """Handle Vercel AI SDK chat requests.

    Session ID and locale are passed via request headers (x-session-id,
    x-locale) so the body is reserved for the SDK's RequestData format.
    dispatch_request handles body parsing, agent execution, and streaming.
    """
    locale = request.headers.get("x-locale", "ja")
    if locale not in ("ja", "zh", "en"):
        locale = "ja"

    runtime_api = _get_runtime_api(request)
    db = cast(DatabasePort, runtime_api._db)

    deps = RuntimeDeps(
        db=db,
        locale=locale,
        query="",  # extracted from messages by the agent
        retriever=Retriever(db),
    )

    return await VercelAIAdapter.dispatch_request(
        request,
        agent=pilgrimage_agent,
        deps=deps,
        sdk_version=6,
    )
