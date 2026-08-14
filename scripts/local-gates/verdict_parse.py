"""JSON → typed Verdict bridge for the local review gate (issue #1008).

Parsing is called only after ``validate_verdict`` has accepted the object, so
the accessors below are strict (they raise on shape violations rather than
guessing). Kept separate from ``review_verdict`` so the model module stays a
readable declaration of the verdict contract.
"""

from __future__ import annotations

from typing import cast

from review_verdict import (
    AcMapping,
    AxisVerdict,
    Finding,
    GateRun,
    MutationRun,
    Verdict,
)
from verdict_types import (
    AcMappingObject,
    AxesObject,
    AxisObject,
    FindingObject,
    GateRunObject,
    MutationRunObject,
    ObjectLike,
    ReviewerObject,
    VerdictObject,
)


def _str_field(obj: ObjectLike, name: str) -> str:
    value = obj.get(name)
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value


def _int_field(obj: ObjectLike, name: str) -> int:
    value = obj.get(name)
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError(f"{name} must be an integer")
    return value


def _list_field(obj: ObjectLike, name: str) -> list[object]:
    value = obj.get(name)
    if not isinstance(value, list):
        raise TypeError(f"{name} must be a list")
    return value


def _finding(value: object) -> Finding | None:
    fields = _finding_fields(value)
    if fields is None:
        return None
    file_value, line_value, severity, message_value = fields
    return Finding(file_value, line_value, severity, message_value)


def _finding_fields(value: object) -> tuple[str, int, str, str] | None:
    if not isinstance(value, dict):
        return None
    item = cast(FindingObject, value)
    file_value = item.get("file")
    line_value = item.get("line")
    message_value = item.get("message")
    if (
        isinstance(file_value, str)
        and isinstance(line_value, int)
        and isinstance(message_value, str)
    ):
        return file_value, line_value, str(item.get("severity", "")), message_value
    return None


def _axis(value: object) -> AxisVerdict | None:
    if not isinstance(value, dict):
        return None
    item = cast(AxisObject, value)
    findings = tuple(
        entry
        for entry in (_finding(v) for v in item.get("findings", []))
        if entry is not None
    )
    return AxisVerdict(str(item.get("status", "")), findings)


def _ac_mapping(value: object) -> AcMapping:
    if not isinstance(value, dict):
        raise TypeError("ac_to_test entries must be objects")
    item = cast(AcMappingObject, value)
    return AcMapping(
        _str_field(item, "ac_id"),
        _str_field(item, "test_type"),
        _str_field(item, "test_path"),
    )


def _gate_run(value: object) -> GateRun:
    if not isinstance(value, dict):
        raise TypeError("gate_evidence entries must be objects")
    item = cast(GateRunObject, value)
    return GateRun(
        _str_field(item, "command"),
        _int_field(item, "exit"),
        _str_field(item, "evidence"),
    )


def _mutation_run(value: object) -> MutationRun:
    if not isinstance(value, dict):
        raise TypeError("mutation_evidence entries must be objects")
    item = cast(MutationRunObject, value)
    return MutationRun(
        _str_field(item, "probe"),
        _str_field(item, "mutation"),
        bool(item.get("red", False)),
        bool(item.get("restore", False)),
        bool(item.get("green", False)),
    )


def parse_verdict(raw: object) -> Verdict:
    """Build a typed Verdict from a validated object (call after validate_verdict)."""
    if not isinstance(raw, dict):
        raise TypeError("verdict must be a JSON object")
    verdict = cast(VerdictObject, raw)
    return _build_verdict(verdict, _reviewer_identity(verdict), _axes(verdict))


def _build_verdict(
    raw: VerdictObject, reviewer: str, axes: tuple[AxisVerdict, AxisVerdict]
) -> Verdict:
    return Verdict(
        schema_version=_int_field(raw, "schema_version"),
        base_sha=_str_field(raw, "base_sha"),
        head_sha=_str_field(raw, "head_sha"),
        brief_digest=_str_field(raw, "brief_digest"),
        reviewer_identity=reviewer,
        reviewed_at=_str_field(raw, "reviewed_at"),
        standards=axes[0],
        spec=axes[1],
        ac_total=_int_field(raw, "ac_total"),
        ac_to_test=_parse_mappings(raw),
        gate_evidence=_parse_gate_runs(raw),
        mutation_evidence=_parse_mutations(raw),
    )


def _reviewer_identity(raw: VerdictObject) -> str:
    reviewer = raw.get("reviewer")
    if not isinstance(reviewer, dict):
        raise TypeError("reviewer must be an object")
    return _str_field(cast(ReviewerObject, reviewer), "identity")


def _axes(raw: VerdictObject) -> tuple[AxisVerdict, AxisVerdict]:
    axes = raw.get("axes")
    if not isinstance(axes, dict):
        raise TypeError("axes must be an object")
    item = cast(AxesObject, axes)
    standards = _axis(item.get("standards"))
    spec = _axis(item.get("spec"))
    return standards or AxisVerdict("", ()), spec or AxisVerdict("", ())


def _parse_mappings(raw: VerdictObject) -> tuple[AcMapping, ...]:
    return tuple(_ac_mapping(v) for v in _list_field(raw, "ac_to_test"))


def _parse_gate_runs(raw: VerdictObject) -> tuple[GateRun, ...]:
    return tuple(_gate_run(v) for v in _list_field(raw, "gate_evidence"))


def _parse_mutations(raw: VerdictObject) -> tuple[MutationRun, ...]:
    return tuple(_mutation_run(v) for v in _list_field(raw, "mutation_evidence"))
