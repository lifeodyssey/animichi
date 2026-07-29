"""Deterministic compaction-time verbatim entity retention (Task 5, OQ-8(c)).

`history_compaction.py`'s `CompactToolReturns` already has a precedent for
deterministically rescuing structured data before an old tool return gets
shrunk to a short summary — `_candidate_summary` pulls `resolve_anime`
candidate ids verbatim out of the raw JSON. This module extends that same
idea to a second, decoupled concern: when a compacted tool call carried a
literal user-supplied entity string (an anime title, a place name), that
exact string is retained here, in session state, so it survives even though
`SUMMARY_PROMPT` only *asks* the model to preserve it verbatim and nothing
previously verified that request.

This ledger is deliberately standalone from `agent.domain.fact_ledger`
(OQ-8 ruling) — different lifecycle, different consumer, no shared model.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field

MAX_RETAINED_ENTITIES = 8
_MAX_VALUE_BYTES = 96
_CONTROL_OR_NEWLINE = re.compile(r"[\x00-\x1f\x7f]")


class _RetentionModel(BaseModel):
    """Strict base: unknown fields are rejected, not silently stored."""

    model_config = ConfigDict(extra="forbid")


class RetainedEntity(_RetentionModel):
    """One verbatim entity string rescued from a compacted tool interaction."""

    tool_name: str
    value: str


def sanitize_entity(value: str) -> str:
    """Strip control characters/newlines so untrusted tool-call text replayed
    into the trusted prompt context cannot forge extra structured lines."""
    collapsed = _CONTROL_OR_NEWLINE.sub(" ", value)
    return " ".join(collapsed.split())


def truncate_entity(value: str, *, max_bytes: int = _MAX_VALUE_BYTES) -> str:
    """Sanitize, then truncate by encoded byte length (CJK-safe)."""
    sanitized = sanitize_entity(value)
    encoded = sanitized.encode("utf-8")
    if len(encoded) <= max_bytes:
        return sanitized
    return encoded[: max_bytes - 1].decode("utf-8", errors="ignore") + "…"


class RetainedEntityLedger(_RetentionModel):
    """Bounded, append-only list of compaction-retained entities."""

    entities: list[RetainedEntity] = Field(default_factory=list)

    def is_empty(self) -> bool:
        """Return whether no entity has ever been retained."""
        return not self.entities

    def record(self, tool_name: str, value: str) -> None:
        """Append a retained entity, evicting the oldest past the cap.

        A blank value after sanitization degrades to a no-op — this is the
        "no extractable key entity" path, not an error.
        """
        cleaned = truncate_entity(value)
        if not cleaned:
            return
        self.entities.append(RetainedEntity(tool_name=tool_name, value=cleaned))
        if len(self.entities) > MAX_RETAINED_ENTITIES:
            self.entities[:] = self.entities[-MAX_RETAINED_ENTITIES:]
