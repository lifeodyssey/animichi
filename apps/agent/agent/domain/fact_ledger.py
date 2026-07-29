"""Deterministic session fact ledger: two typed fields, no LLM extraction.

OQ-3(c) ruling: the ledger carries only the two genuinely new facts beyond
`SessionState` — a user hard constraint (currently: route pacing) and
episode/scene references drawn from explicitly selected points. Both are
derived solely from `AgentResult.steps` by `record_turn_facts` (OQ-4); there
is no separate LLM extraction round. Each field's live value is surfaced by
a named prompt-injection consumption point in `agents/animichi_agent.py`, per
the hard consumption gate — a field with no consumer is dead scaffolding.

Scene references are **turn-scoped**: each `plan_selected` step replaces the
whole live scene-reference set with the current selection (unchecking a point
retires it, not just accumulates a new one), which is also what keeps the
ledger's growth bounded across many turns. The record cap and the encoded
byte budget are both enforced here, in the write path, not only asserted by
tests.

Anonymous-session purge note: route-bearing anonymous sessions are exempt
from the retention purge (#460) and can therefore live indefinitely; the
per-field record cap and byte budget below are what keep such a
long-lived session's ledger bounded regardless of session age.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Literal, NewType, Protocol, TypeVar, cast, get_args

from pydantic import BaseModel, ConfigDict, Field

MAX_RECORDS_PER_FIELD = 8
MAX_LEDGER_BYTES = 8 * 1024
_MAX_VALUE_BYTES = 96
_MAX_ID_BYTES = 96

FactId = NewType("FactId", str)
Pacing = Literal["chill", "normal", "packed"]
SceneReferenceKind = Literal["episode_scene"]

_CONTROL_OR_NEWLINE = re.compile(r"[\x00-\x1f\x7f]")


class _LedgerModel(BaseModel):
    """Strict base for ledger records: unknown fields are rejected, not stored."""

    model_config = ConfigDict(extra="forbid")


class _LedgerRecord(_LedgerModel):
    """Shared append/supersede record shape."""

    id: FactId
    value: str
    recorded_at: datetime
    superseded_by: FactId | None = None


class HardConstraintRecord(_LedgerRecord):
    """One recorded user hard constraint."""

    kind: Literal["pacing"] = "pacing"
    value: Pacing


class SceneReferenceRecord(_LedgerRecord):
    """One recorded episode/scene reference tied to a selected point."""

    kind: SceneReferenceKind = "episode_scene"
    point_id: str


_RecordT = TypeVar("_RecordT", bound=_LedgerRecord)


def _new_id() -> FactId:
    return FactId(uuid.uuid4().hex)


def _sanitize(value: str) -> str:
    """Strip control characters/newlines so untrusted point text replayed into
    the trusted prompt context cannot forge extra ledger-shaped lines."""
    collapsed = _CONTROL_OR_NEWLINE.sub(" ", value)
    return " ".join(collapsed.split())


def _truncate(value: str, *, max_bytes: int = _MAX_VALUE_BYTES) -> str:
    """Sanitize, then truncate by encoded byte length (CJK-safe, not char count)."""
    sanitized = _sanitize(value)
    encoded = sanitized.encode("utf-8")
    if len(encoded) <= max_bytes:
        return sanitized
    return encoded[: max_bytes - 1].decode("utf-8", errors="ignore") + "…"


class FactLedger(_LedgerModel):
    """Strict, bounded, append/supersede session fact ledger (two fields)."""

    hard_constraints: list[HardConstraintRecord] = Field(default_factory=list)
    scene_references: list[SceneReferenceRecord] = Field(default_factory=list)

    def is_empty(self) -> bool:
        """Return whether no fact has ever been recorded."""
        return not self.hard_constraints and not self.scene_references

    def active_hard_constraint(self) -> HardConstraintRecord | None:
        """Return the live (non-superseded) hard constraint, if any."""
        return _last_active(self.hard_constraints)

    def active_scene_references(self) -> list[SceneReferenceRecord]:
        """Return the live (non-superseded) scene references, oldest first."""
        return [r for r in self.scene_references if r.superseded_by is None]

    def append_hard_constraint(
        self, value: Pacing, *, now: datetime
    ) -> HardConstraintRecord:
        """Append a hard-constraint correction; a repeat of the live value is a no-op."""
        current = _last_active(self.hard_constraints)
        if current is not None and current.value == value:
            return current
        record = HardConstraintRecord(id=_new_id(), value=value, recorded_at=now)
        _supersede(current, record.id)
        self.hard_constraints.append(record)
        _bound(self, self.hard_constraints)
        return record

    def replace_scene_references(
        self, entries: Sequence[tuple[str, str]], *, now: datetime
    ) -> list[SceneReferenceRecord]:
        """Turn-scoped replace: supersede the whole live set, then record the
        current selection. A no-op if the proposed live set (point_id, value)
        is unchanged from the current one, avoiding needless churn/growth.
        """
        capped = [
            (_truncate(pid, max_bytes=_MAX_ID_BYTES), _truncate(value))
            for pid, value in list(entries)[:MAX_RECORDS_PER_FIELD]
        ]
        current = self.active_scene_references()
        if [(r.point_id, r.value) for r in current] == capped:
            return current
        for record in current:
            record.superseded_by = _TURN_SUPERSEDED
        return [self._append_scene(pid, value, now=now) for pid, value in capped]

    def _append_scene(
        self, point_id: str, value: str, *, now: datetime
    ) -> SceneReferenceRecord:
        record = SceneReferenceRecord(
            id=_new_id(),
            point_id=_truncate(point_id, max_bytes=_MAX_ID_BYTES),
            value=_truncate(value),
            recorded_at=now,
        )
        self.scene_references.append(record)
        _bound(self, self.scene_references)
        return record

    def encoded_size_bytes(self) -> int:
        """Return the encoded JSON byte length enforced by `_bound`."""
        return len(self.model_dump_json().encode("utf-8"))


# A whole-set turn replacement has no single "successor" id for every retired
# record — a batch of N old points can be replaced by a batch of M new ones
# with no 1:1 correspondence between any one retired record and any one new
# one. `_TURN_SUPERSEDED` is therefore an intentional, permanent tombstone
# value, not a placeholder: it is never rewritten to a real record id, and it
# only ever means "retired by a later turn's whole-set replace" rather than
# "specifically superseded by record X" (that stronger, id-linked chain is
# what `append_hard_constraint`'s `_supersede` still provides).
_TURN_SUPERSEDED = FactId("__turn_superseded__")


def _last_active(records: list[_RecordT]) -> _RecordT | None:
    for record in reversed(records):
        if record.superseded_by is None:
            return record
    return None


def _supersede(prior: _RecordT | None, new_id: FactId) -> None:
    if prior is not None:
        prior.superseded_by = new_id


def _bound(ledger: FactLedger, records: list[_RecordT]) -> None:
    """Enforce both caps in the write path: per-field count, then total bytes."""
    _evict_by_count(records)
    _evict_by_budget(ledger)


def _evict_by_count(records: list[_RecordT]) -> None:
    """Drop superseded records first; an unconditional trailing trim is the
    absolute backstop that makes unbounded growth structurally impossible,
    even if a future change ever breaks the superseded-first invariant."""
    while len(records) > MAX_RECORDS_PER_FIELD:
        idx = next(
            (i for i, r in enumerate(records) if r.superseded_by is not None), None
        )
        if idx is None:
            break
        records.pop(idx)
    if len(records) > MAX_RECORDS_PER_FIELD:
        records[:] = records[-MAX_RECORDS_PER_FIELD:]


def _evict_by_budget(ledger: FactLedger) -> None:
    while ledger.encoded_size_bytes() > MAX_LEDGER_BYTES:
        if not (
            _drop_oldest(ledger.hard_constraints)
            or _drop_oldest(ledger.scene_references)
        ):
            return


def _drop_oldest(records: list[_RecordT]) -> bool:
    if not records:
        return False
    idx = next((i for i, r in enumerate(records) if r.superseded_by is not None), 0)
    records.pop(idx)
    return True


class _StepLike(Protocol):
    """Structural shape `record_turn_facts` needs from `agent_result.StepRecord`."""

    tool: str
    success: bool
    params: dict[str, object]
    data: dict[str, object] | None


def record_turn_facts(
    ledger: FactLedger, steps: Sequence[_StepLike], *, now: datetime
) -> None:
    """Deterministically append/supersede ledger facts from this turn's steps.

    Derives records solely from step tool name, params, and data; performs
    zero model calls. ``now`` is caller-supplied (mock the clock) rather than
    read internally. A run whose steps carry no ledger-relevant tool output
    records nothing.
    """
    for step in steps:
        _record_step(ledger, step, now)


def _record_step(ledger: FactLedger, step: _StepLike, now: datetime) -> None:
    if not step.success:
        return
    if step.tool == "plan_route":
        _record_pacing(ledger, step, now)
    elif step.tool == "plan_selected":
        _record_scene_refs(ledger, step, now)


def _record_pacing(ledger: FactLedger, step: _StepLike, now: datetime) -> None:
    pacing = _as_pacing(step.params.get("pacing"))
    if pacing is not None:
        ledger.append_hard_constraint(pacing, now=now)


def _as_pacing(value: object) -> Pacing | None:
    """Narrow an untyped tool-call argument to the `Pacing` literal, if valid."""
    if isinstance(value, str) and value in get_args(Pacing):
        return cast(Pacing, value)
    return None


def _record_scene_refs(ledger: FactLedger, step: _StepLike, now: datetime) -> None:
    if step.data is None:
        return
    points = step.data.get("ordered_points")
    if not isinstance(points, list):
        return
    entries = [entry for point in points if (entry := _scene_entry(point)) is not None]
    ledger.replace_scene_references(entries, now=now)


def _scene_entry(point: object) -> tuple[str, str] | None:
    if not isinstance(point, dict):
        return None
    point_id, episode = point.get("id"), point.get("episode")
    if not isinstance(point_id, str) or not point_id:
        return None
    if not isinstance(episode, int) or episode < 0:
        return None  # catalog sentinel (-1) means "no episode", not a fact
    return point_id, _scene_value(point, episode)


def _scene_value(point: dict[str, object], episode: int) -> str:
    name = point.get("name")
    name_part = name if isinstance(name, str) and name else "unnamed scene"
    seconds = point.get("time_seconds")
    time_part = f" @ {seconds}s" if isinstance(seconds, int) and seconds >= 0 else ""
    return f"Episode {episode} — {name_part}{time_part}"
