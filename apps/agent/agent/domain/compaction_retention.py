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

Eviction is **oldest-wins**, not FIFO: the whole point of this ledger is to
rescue entities that are about to fall out of the raw sliding window (the
*deepest*, oldest history), so once the ledger is full, a newer distinct
entity is dropped rather than evicting an older one — a near-tail entity
that gets dropped here is still covered verbatim by the sliding window
itself for a while yet, but a turn-0 entity evicted here is lost for good.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from agent.domain.text_sanitize import truncate_text

MAX_RETAINED_ENTITIES = 8
MAX_RETAINED_BYTES = 8 * 1024
_MAX_VALUE_BYTES = 96


class _RetentionModel(BaseModel):
    """Strict base: unknown fields are rejected, not silently stored."""

    model_config = ConfigDict(extra="forbid")


class RetainedEntity(_RetentionModel):
    """One verbatim entity string rescued from a compacted tool interaction."""

    tool_name: str
    value: str


class RetainedEntityLedger(_RetentionModel):
    """Bounded, deduplicating, oldest-wins list of compaction-retained entities.

    Deduplication matters because compaction is not a one-shot event: the
    real persistence path (`session_facade.build_message_history`) replays
    every past interaction's raw messages on every turn — old interactions
    are never rewritten to a compacted form in storage — so the *same* old
    tool call gets recompacted, and would otherwise get re-recorded, on
    every subsequent turn (and can fire multiple times within one turn's
    tool loop, once per compacted tool return). Without dedup, one
    repeatedly-replayed entity would crowd out every other distinct entity.
    """

    entities: list[RetainedEntity] = Field(default_factory=list)

    def is_empty(self) -> bool:
        """Return whether no entity has ever been retained."""
        return not self.entities

    def record(self, tool_name: str, value: str) -> None:
        """Record a retained entity.

        A repeat of the same (tool_name, value) moves to the tail instead of
        duplicating. A genuinely new entity is dropped, not appended, once
        the ledger is already at the count or byte cap (oldest-wins). A
        blank value after sanitization is a no-op — the "no extractable key
        entity" path, not an error.
        """
        clean_tool = truncate_text(tool_name, max_bytes=_MAX_VALUE_BYTES)
        clean_value = truncate_text(value, max_bytes=_MAX_VALUE_BYTES)
        if not clean_value:
            return
        self._replace(clean_tool, clean_value)

    def _replace(self, tool_name: str, value: str) -> None:
        before = len(self.entities)
        self.entities = [
            entity
            for entity in self.entities
            if (entity.tool_name, entity.value) != (tool_name, value)
        ]
        is_new_entity = len(self.entities) == before
        if is_new_entity and self._at_capacity():
            return
        self.entities.append(RetainedEntity(tool_name=tool_name, value=value))

    def _at_capacity(self) -> bool:
        return (
            len(self.entities) >= MAX_RETAINED_ENTITIES
            or self.encoded_size_bytes() >= MAX_RETAINED_BYTES
        )

    def enforce_bounds(self) -> None:
        """Re-apply the count/byte caps, keeping the oldest entries.

        Called on every restore (`SessionState`'s restored-registry
        validator), not only from `record()`'s own write path — a persisted
        envelope produced by a future/rolled-back deploy, or corrupted at
        rest, must not bypass the cap just because it hydrated directly via
        `model_validate` instead of going through `record()`.
        """
        if len(self.entities) > MAX_RETAINED_ENTITIES:
            self.entities[:] = self.entities[:MAX_RETAINED_ENTITIES]
        while self.entities and self.encoded_size_bytes() > MAX_RETAINED_BYTES:
            self.entities.pop()

    def encoded_size_bytes(self) -> int:
        """Return the encoded JSON byte length enforced by `enforce_bounds`."""
        return len(self.model_dump_json().encode("utf-8"))
