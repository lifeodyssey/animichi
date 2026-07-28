"""Deterministic session fact ledger: two typed fields, no LLM extraction.

OQ-3(c) ruling: the ledger carries only the two genuinely new facts beyond
`SessionState` — a user hard constraint (currently: route pacing) and
episode/scene references drawn from explicitly selected points. Both are
derived solely from `AgentResult.steps` by `record_turn_facts` (OQ-4); there
is no separate LLM extraction round. Each field's live value is surfaced by
a named prompt-injection consumption point in `agents/animichi_agent.py`, per
the hard consumption gate — a field with no consumer is dead scaffolding.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal, NewType, Protocol, TypeVar

from pydantic import BaseModel, ConfigDict, Field

MAX_RECORDS_PER_FIELD = 8
_MAX_VALUE_LEN = 200

FactId = NewType("FactId", str)
HardConstraintKind = Literal["pacing"]
SceneReferenceKind = Literal["episode_scene"]
_PACING_VALUES = frozenset({"chill", "normal", "packed"})


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

    kind: HardConstraintKind = "pacing"


class SceneReferenceRecord(_LedgerRecord):
    """One recorded episode/scene reference tied to a selected point."""

    kind: SceneReferenceKind = "episode_scene"
    point_id: str


_RecordT = TypeVar("_RecordT", bound=_LedgerRecord)


def _new_id() -> FactId:
    return FactId(uuid.uuid4().hex)


def _truncate(value: str) -> str:
    return value if len(value) <= _MAX_VALUE_LEN else value[: _MAX_VALUE_LEN - 1] + "…"


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

    def active_scene_references(
        self, limit: int = MAX_RECORDS_PER_FIELD
    ) -> list[SceneReferenceRecord]:
        """Return live scene references, oldest first, capped to ``limit``."""
        active = [r for r in self.scene_references if r.superseded_by is None]
        return active[-limit:]

    def append_hard_constraint(
        self, value: str, *, now: datetime
    ) -> HardConstraintRecord:
        """Append a hard-constraint correction, superseding the prior live one."""
        record = HardConstraintRecord(
            id=_new_id(), value=_truncate(value), recorded_at=now
        )
        _supersede(_last_active(self.hard_constraints), record.id)
        self.hard_constraints.append(record)
        _evict(self.hard_constraints)
        return record

    def append_scene_reference(
        self, *, point_id: str, value: str, now: datetime
    ) -> SceneReferenceRecord:
        """Append a scene reference, superseding a prior live one for the same point."""
        record = SceneReferenceRecord(
            id=_new_id(), point_id=point_id, value=_truncate(value), recorded_at=now
        )
        _supersede(_last_active_for_point(self.scene_references, point_id), record.id)
        self.scene_references.append(record)
        _evict(self.scene_references)
        return record

    def encoded_size_bytes(self) -> int:
        """Return the encoded JSON byte length, the size-budget AC's unit."""
        return len(self.model_dump_json().encode("utf-8"))


def _last_active(records: list[_RecordT]) -> _RecordT | None:
    for record in reversed(records):
        if record.superseded_by is None:
            return record
    return None


def _last_active_for_point(
    records: list[SceneReferenceRecord], point_id: str
) -> SceneReferenceRecord | None:
    for record in reversed(records):
        if record.point_id == point_id and record.superseded_by is None:
            return record
    return None


def _supersede(prior: _RecordT | None, new_id: FactId) -> None:
    if prior is not None:
        prior.superseded_by = new_id


def _evict(records: list[_RecordT]) -> None:
    while len(records) > MAX_RECORDS_PER_FIELD:
        idx = next(
            (i for i, r in enumerate(records) if r.superseded_by is not None), None
        )
        if idx is None:
            return
        records.pop(idx)


class _StepLike(Protocol):
    """Structural shape `record_turn_facts` needs from `agent_result.StepRecord`."""

    tool: str
    success: bool
    params: dict[str, object]
    data: dict[str, object] | None


def record_turn_facts(ledger: FactLedger, steps: Sequence[_StepLike]) -> None:
    """Deterministically append/supersede ledger facts from this turn's steps.

    Derives records solely from step tool name, params, and data; performs
    zero model calls. A run whose steps carry no ledger-relevant tool output
    records nothing.
    """
    now = datetime.now(UTC)
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
    pacing = step.params.get("pacing")
    if isinstance(pacing, str) and pacing in _PACING_VALUES:
        ledger.append_hard_constraint(pacing, now=now)


def _record_scene_refs(ledger: FactLedger, step: _StepLike, now: datetime) -> None:
    if step.data is None:
        return
    points = step.data.get("ordered_points")
    if not isinstance(points, list):
        return
    for point in points[:MAX_RECORDS_PER_FIELD]:
        _record_one_scene(ledger, point, now)


def _record_one_scene(ledger: FactLedger, point: object, now: datetime) -> None:
    if not isinstance(point, dict):
        return
    point_id, episode = point.get("id"), point.get("episode")
    if not isinstance(point_id, str) or not point_id or episode is None:
        return
    ledger.append_scene_reference(
        point_id=point_id, value=_scene_value(point, episode), now=now
    )


def _scene_value(point: dict[str, object], episode: object) -> str:
    name = point.get("name")
    name_part = name if isinstance(name, str) and name else "unnamed scene"
    seconds = point.get("time_seconds")
    time_part = f" @ {seconds}s" if isinstance(seconds, int) else ""
    return f"Episode {episode} — {name_part}{time_part}"
