"""Data records and scalar coercion helpers for the Session repository (#994).

The value objects the session store returns (``SessionRecord``, ``MessageRow``,
``HistoryPage``) and the small column-to-wire coercion helpers live here,
split out of ``session.py`` (1-10-50).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from animichi.domain.repo_types import ResponseData, SessionMetadata, SessionStateData


def _as_text(value: object) -> str:
    return str(value) if isinstance(value, str) else ""


def _as_state(raw: object) -> SessionStateData | None:
    if isinstance(raw, str):
        parsed = json.loads(raw)
        return cast(SessionStateData, parsed) if isinstance(parsed, dict) else None
    if isinstance(raw, Mapping):
        return cast(SessionStateData, dict(raw))
    return None


def _as_metadata(raw: object) -> SessionMetadata | None:
    """Coerce the sessions.metadata envelope the same way as state."""
    if isinstance(raw, str):
        parsed = json.loads(raw)
        return cast(SessionMetadata, parsed) if isinstance(parsed, dict) else None
    if isinstance(raw, Mapping):
        return cast(SessionMetadata, dict(raw))
    return None


def _as_datetime(raw: object) -> str:
    """Serialize a stored timestamp to the wire form used by the legacy path."""
    if isinstance(raw, datetime):
        return raw.isoformat()
    return str(raw)


@dataclass(frozen=True)
class SessionRecord:
    session_id: str
    user_id: str
    title: str | None = None
    first_query: str | None = None
    state: SessionStateData | None = None
    metadata: SessionMetadata | None = None


@dataclass(frozen=True)
class MessageRow:
    role: str
    content: str
    response_data: ResponseData | None
    created_at: str


@dataclass(frozen=True)
class HistoryPage:
    user_id: str
    messages: list[MessageRow]
    revision: int


__all__ = ["HistoryPage", "MessageRow", "SessionRecord"]
