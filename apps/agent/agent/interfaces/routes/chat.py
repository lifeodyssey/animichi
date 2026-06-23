"""Vercel AI SDK chat endpoint — streams via PydanticAI VercelAIAdapter.

Uses the official dispatch_request pattern:
https://pydantic.dev/docs/ai/integrations/ui/vercel-ai/

Detects clarify context from message history to prevent re-clarification.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Annotated, cast

import structlog
from fastapi import APIRouter, Depends, Request
from pydantic_ai.run import AgentRunResult
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
from pydantic_ai.ui.vercel_ai.response_types import BaseChunk, DataChunk
from starlette.responses import Response

from agent.agents.pilgrimage_runner import pilgrimage_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.domain.ports import DatabasePort
from agent.interfaces.public_api import default_catalog_client
from agent.interfaces.routes._deps import (
    TrustedAuthContext,
    _get_catalog_client,
    _get_runtime_api,
    _require_trusted_user,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1", tags=["chat"])


def _find_last_assistant_message(messages: list[object]) -> dict[str, object] | None:
    """Scan reversed messages list, return the last assistant msg dict or None."""
    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        if msg.get("role") == "assistant":
            return msg
    return None


def _scan_parts_for_clarify(parts: list[object]) -> dict[str, object] | None:
    """Scan parts list for a clarify tool call, return tool_state dict or None."""
    for part in parts:
        if not isinstance(part, dict):
            continue
        part_type = part.get("type", "")
        tool_name = part.get("toolName", "")
        if tool_name != "clarify" and part_type != "tool-clarify":
            continue
        output = part.get("output") or part.get("result")
        if not isinstance(output, dict):
            return {"pending_clarify": True}
        candidates = output.get("candidates") or output.get("options")
        if isinstance(candidates, list):
            return {"pending_clarify": True, "resolve_candidates": candidates}
        return {"pending_clarify": True}
    return None


def _detect_clarify_context(body: bytes) -> dict[str, object]:
    """Scan Vercel SDK request body for pending clarify state.

    If the last assistant message contains a clarify tool call with
    candidates, the current user message is a clarify selection.
    Returns tool_state entries to pre-populate on deps.
    """
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return {}

    messages = data.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        return {}

    last_assistant = _find_last_assistant_message(messages)
    if last_assistant is None:
        return {}

    parts = last_assistant.get("parts") or last_assistant.get("content")
    if not isinstance(parts, list):
        return {}

    return _scan_parts_for_clarify(parts) or {}


def _make_on_complete(
    deps: RuntimeDeps,
) -> Callable[[AgentRunResult[object]], AsyncIterator[BaseChunk]]:
    """Create an on_complete callback that merges tool_state into the output.

    The LLM's output tool (search_response etc.) has intent + message but
    empty data rows. The actual rows live in deps.tool_state, populated by
    the search/route tool handlers. We merge them here so the frontend
    gets a single DataChunk with the complete response.
    """

    async def _on_complete(
        result: AgentRunResult[object],
    ) -> AsyncIterator[BaseChunk]:
        output = result.output
        if not hasattr(output, "model_dump"):
            return
        data = output.model_dump(mode="json")

        # Merge full tool_state data into the output's empty data section.
        # Wrap under "results" or "route" to match response_builder.py convention.
        intent = data.get("intent", "")
        tool_data = deps.tool_state.get(intent)
        if isinstance(tool_data, dict) and isinstance(data.get("data"), dict):
            if intent in ("plan_route", "plan_selected"):
                data["data"] = {"route": tool_data}
            else:
                data["data"] = {"results": tool_data}

        yield DataChunk(type="data-response", data=data)

    return _on_complete


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

    # Read body once — Starlette caches it so dispatch_request can re-read
    body = await request.body()

    # Detect clarify context from message history
    clarify_ctx = _detect_clarify_context(body)

    runtime_api = _get_runtime_api(request)
    db = cast(DatabasePort, runtime_api._db)

    deps = RuntimeDeps(
        db=db,
        locale=locale,
        query="",  # extracted from messages by the agent
        catalog=_get_catalog_client(request) or default_catalog_client(),
    )

    # Pre-populate tool_state with clarify context if detected
    if clarify_ctx:
        deps.tool_state.update(clarify_ctx)
        logger.info("chat_clarify_context_detected", clarify_ctx=clarify_ctx)

    return await VercelAIAdapter.dispatch_request(
        request,
        agent=pilgrimage_agent,
        deps=deps,
        sdk_version=6,
        on_complete=_make_on_complete(deps),
    )
