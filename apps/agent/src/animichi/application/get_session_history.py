"""GetSessionHistory — Agent-owned session-transcript boundary (SESSION-1 #959).

The ``GET /v1/conversations/{id}/messages`` route publishes this use case as
the generated ``GetSessionHistoryResponse`` boundary model. The use case is
the ordering authority (stable ascending ``created_at``), the ownership check
(missing and forbidden collapse to the same ``None``), and the pagination
computation; ``SessionHistoryAdapter`` is the read-only port over the current
Session/Message stores (conversations + conversation_messages +
turn_reservations). No actor identifier and no message content is ever
recorded — the route owns the outcome/count/revision/duration telemetry.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

from animichi.interfaces.boundary.agent_models import (
    GetSessionHistoryResponse,
    GetSessionHistoryResponseMessages,
    GetSessionHistoryResponseMessagesResponse_data,
)


@dataclass(frozen=True)
class ConversationRow:
    """Ownership facts for one conversation, read-only (SESSION-1)."""

    user_id: str
    session_id: str


@dataclass(frozen=True)
class SessionRow:
    """One transcript row from the message store, read-only (SESSION-1)."""

    role: str
    content: str
    response_data: object
    created_at: str


class SessionHistoryAdapter(Protocol):
    """Read-only port over the current Session/Message stores."""

    async def get_conversation(self, session_id: str) -> ConversationRow | None: ...

    async def get_messages(
        self, session_id: str, *, limit: int, offset: int
    ) -> list[SessionRow]: ...

    async def current_revision(self, session_id: str) -> int: ...


def _order_key(row: SessionRow) -> str:
    return row.created_at


def _response_data(
    value: object,
) -> GetSessionHistoryResponseMessagesResponse_data | None:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return _response_data(parsed)
    if not isinstance(value, Mapping):
        return None
    intent = value.get("intent")
    success = value.get("success")
    return GetSessionHistoryResponseMessagesResponse_data(
        intent=intent if isinstance(intent, str) else None,
        success=success if isinstance(success, bool) else None,
    )


def _to_message(row: SessionRow) -> GetSessionHistoryResponseMessages:
    return GetSessionHistoryResponseMessages(
        role=row.role,
        content=row.content,
        response_data=_response_data(row.response_data),
        created_at=row.created_at,
    )


_NEXT_OFFSET_CAP = 1_000


async def get_session_history(
    adapter: SessionHistoryAdapter,
    *,
    session_id: str,
    user_id: str,
    limit: int,
    offset: int,
) -> GetSessionHistoryResponse | None:
    """Return one ordered, owned page of transcript, or ``None`` when the
    conversation is missing or belongs to another user (identical outcome)."""
    conversation = await adapter.get_conversation(session_id)
    if conversation is None or conversation.user_id != user_id:
        return None
    rows = await adapter.get_messages(session_id, limit=limit + 1, offset=offset)
    page = sorted(rows, key=_order_key)[:limit]
    revision = await adapter.current_revision(session_id)
    has_more = len(rows) > limit
    next_offset = offset + limit if has_more else None
    if next_offset is not None and next_offset > _NEXT_OFFSET_CAP:
        next_offset = None
    return GetSessionHistoryResponse(
        messages=[_to_message(row) for row in page],
        revision=revision,
        next_offset=next_offset,
    )
