"""Session persistence facade with one typed runtime-state carrier."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast

import structlog
from pydantic import ValidationError

from agent.agents.agent_result import AgentResult
from agent.agents.session_state import SessionState
from agent.interfaces.schemas import PublicAPIRequest

logger = structlog.get_logger(__name__)

MAX_INTERACTIONS = 20
MAX_ROUTE_HISTORY = 10


@dataclass(frozen=True)
class SessionUpdate:
    """Fields persisted for one completed request."""

    request: PublicAPIRequest
    response_intent: str
    response_status: str
    response_success: bool
    response_message: str = field(default="")
    context_delta: dict[str, object] | None = field(default=None)
    new_messages_serialized: list[object] = field(default_factory=list)


def normalize_session_state(state: dict[str, object] | None) -> dict[str, object]:
    """Return the storage envelope with stable collection fields."""
    normalized: dict[str, object] = {
        "interactions": [],
        "route_history": [],
        "last_intent": None,
        "last_status": None,
        "last_message": "",
        "summary": None,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if state is not None:
        normalized.update(state)
    normalized["interactions"] = _list(normalized.get("interactions"))
    normalized["route_history"] = _list(normalized.get("route_history"))
    normalized["summary"] = as_str_or_none(normalized.get("summary"))
    return normalized


def _list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def build_updated_session_state(
    previous_state: dict[str, object], update: SessionUpdate
) -> dict[str, object]:
    """Append history and overwrite the one envelope-level typed snapshot."""
    context_delta = dict(update.context_delta or {})
    runtime_state = context_delta.pop("session_state_v2", None)
    updated = _updated_envelope(previous_state, update, context_delta)
    if runtime_state is not None:
        updated["session_state_v2"] = runtime_state
    return updated


def _updated_envelope(
    previous_state: dict[str, object],
    update: SessionUpdate,
    context_delta: dict[str, object],
) -> dict[str, object]:
    interactions = _list(previous_state.get("interactions"))
    interactions.append(_interaction(update, context_delta))
    return {
        **previous_state,
        "interactions": interactions[-MAX_INTERACTIONS:],
        "last_intent": update.response_intent,
        "last_status": update.response_status,
        "last_message": update.response_message,
        "updated_at": datetime.now(UTC).isoformat(),
    }


def _interaction(
    update: SessionUpdate, context_delta: dict[str, object]
) -> dict[str, object]:
    return {
        "text": update.request.text,
        "intent": update.response_intent,
        "status": update.response_status,
        "success": update.response_success,
        "created_at": datetime.now(UTC).isoformat(),
        "context_delta": context_delta,
        "new_messages": update.new_messages_serialized,
    }


def build_message_history(session_state: dict[str, object]) -> list[object]:
    """Collect validated-at-read model messages in interaction order."""
    history: list[object] = []
    for interaction in _list(session_state.get("interactions")):
        if not isinstance(interaction, dict):
            continue
        history.extend(_list(interaction.get("new_messages")))
    return history


def build_session_summary(state: dict[str, object]) -> dict[str, object]:
    """Build the public, compact session summary."""
    return {
        "interaction_count": len(_list(state.get("interactions"))),
        "route_history_count": len(_list(state.get("route_history"))),
        "last_intent": state.get("last_intent"),
        "last_status": state.get("last_status"),
        "last_message": state.get("last_message", ""),
    }


def _parse_runtime_state(raw: object) -> SessionState | None:
    if not isinstance(raw, dict):
        return None
    try:
        return SessionState.model_validate(raw)
    except ValidationError:
        return _parse_forward_compatible(raw)


_FORWARD_COMPATIBLE_KEYS = frozenset({"fact_ledger", "compaction_retained_entities"})


def _parse_forward_compatible(raw: dict[str, object]) -> SessionState | None:
    """Rollback safety: a newer deploy's `fact_ledger` key must not sink an
    older deploy's whole typed session. Drop only that allowlisted key and
    retry once; any other validation failure is genuine corruption and stays
    rejected (never a blanket "strip anything unrecognized" shim).
    """
    droppable = set(raw) & _FORWARD_COMPATIBLE_KEYS
    if not droppable:
        logger.warning("invalid_session_state_v2")
        return None
    stripped = {key: value for key, value in raw.items() if key not in droppable}
    try:
        restored = SessionState.model_validate(stripped)
    except ValidationError:
        logger.warning("invalid_session_state_v2")
        return None
    logger.warning("fact_ledger_dropped", dropped_keys=sorted(droppable))
    return restored


def _latest_runtime_state(interactions: list[object]) -> SessionState | None:
    for interaction in reversed(interactions):
        if not isinstance(interaction, dict):
            continue
        delta = interaction.get("context_delta")
        if isinstance(delta, dict) and "session_state_v2" in delta:
            return _parse_runtime_state(delta.get("session_state_v2"))
    return None


def build_context_block(
    session_state: dict[str, object],
) -> dict[str, object] | None:
    """Restore the latest typed state; an explicit empty state is a clear."""
    runtime_state = (
        _parse_runtime_state(session_state.get("session_state_v2"))
        if "session_state_v2" in session_state
        else _latest_runtime_state(_list(session_state.get("interactions")))
    )
    summary = as_str_or_none(session_state.get("summary"))
    if runtime_state is None and summary is None:
        return None
    return {
        "summary": summary,
        "last_intent": session_state.get("last_intent"),
        "session_state_v2": _serialize_runtime_state(runtime_state or SessionState()),
    }


def _serialize_runtime_state(state: SessionState) -> dict[str, object]:
    """Dump the typed state; an ever-empty fact ledger or compaction-retention
    ledger adds no envelope key."""
    dumped = cast(dict[str, object], state.model_dump(mode="json"))
    if state.fact_ledger.is_empty():
        dumped.pop("fact_ledger", None)
    if state.compaction_retained_entities.is_empty():
        dumped.pop("compaction_retained_entities", None)
    return dumped


def extract_context_delta(result: AgentResult) -> dict[str, object]:
    """Query: serialize the complete typed state, including explicit empty

    clears. Pure — the fact-ledger recorder is a separate command the caller
    runs over `result.steps` before this (CQS; see `public_api.py`).
    """
    return {"session_state_v2": _serialize_runtime_state(result.session_state)}


def as_str_or_none(value: object) -> str | None:
    """Coerce to a stripped string, returning None for blanks."""
    text = "" if value is None else str(value).strip()
    return text or None
