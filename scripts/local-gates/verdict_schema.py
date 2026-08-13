"""Schema validation for the review verdict artifact (issue #1008).

Mirrors ``review-schema.json`` strictly and recursively (finding 4): unknown
keys fail at every nesting level and ``reviewed_at`` must be full RFC-3339.
Evidence completeness (``ac_total`` vs. the AC mapping, the ``repair_evidence``
boundary) lives in ``verdict_evidence``; JSON schema cannot express nested
uniqueness, so ``ac_id`` uniqueness is enforced here (via verdict_evidence).
Every ``_check_*`` helper stays within the 1-10-50 limits and ``validate_verdict`` is re-exported by ``review_verdict``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime
from typing import Final, cast

from review_verdict import HEX_RE, SCHEMA_VERSION, approval_evidence_reasons
from verdict_evidence import check_evidence_completeness
from verdict_parse import parse_verdict
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

Checker = Callable[[object, str, list[str]], None]

ALLOWED_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "schema_version",
        "base_sha",
        "head_sha",
        "brief_digest",
        "reviewer",
        "reviewed_at",
        "axes",
        "ac_total",
        "ac_to_test",
        "gate_evidence",
        "mutation_evidence",
        "repair_evidence",
    }
)
REVIEWER_FIELDS: Final[frozenset[str]] = frozenset({"identity", "role"})
AXES_FIELDS: Final[frozenset[str]] = frozenset({"standards", "spec"})
AXIS_FIELDS: Final[frozenset[str]] = frozenset({"status", "findings"})
FINDING_FIELDS: Final[frozenset[str]] = frozenset(
    {"file", "line", "severity", "message"}
)
AC_FIELDS: Final[frozenset[str]] = frozenset({"ac_id", "test_type", "test_path"})
GATE_RUN_FIELDS: Final[frozenset[str]] = frozenset({"command", "exit", "evidence"})
MUTATION_RUN_FIELDS: Final[frozenset[str]] = frozenset(
    {"probe", "mutation", "red", "restore", "green"}
)

# Strict RFC-3339: date, T, HH:MM:SS seconds, optional fractions, timezone
# (Z or +-HH:MM). Date-only / timezone-less values never match (finding 4).
RFC3339_RE: Final[re.Pattern[str]] = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)


def _require_dict(value: object, path: str, errors: list[str]) -> ObjectLike | None:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object")
        return None
    return cast(ObjectLike, value)


def _check_unknown_fields(
    obj: ObjectLike, allowed: frozenset[str], path: str, errors: list[str]
) -> None:
    for name in sorted(set(obj) - allowed):
        errors.append(
            f"unknown field: {name}" if not path else f"unknown field: {path}.{name}"
        )


def _is_hex(value: object, length: int) -> bool:
    return isinstance(value, str) and len(value) == length and bool(HEX_RE.match(value))


def _check_hex_field(
    obj: VerdictObject, name: str, length: int, errors: list[str]
) -> None:
    if not _is_hex(obj.get(name), length):
        errors.append(f"{name} must be {length} lowercase hex characters")


def _check_required_str(obj: ObjectLike, name: str, errors: list[str]) -> None:
    if not isinstance(obj.get(name), str) or not obj.get(name):
        errors.append(f"{name} must be a non-empty string")


def _check_finding(finding: object, path: str, errors: list[str]) -> None:
    raw = _require_dict(finding, path, errors)
    if raw is None:
        return
    item = cast(FindingObject, raw)
    _check_unknown_fields(raw, FINDING_FIELDS, path, errors)
    _check_required_str(item, "file", errors)
    _check_required_str(item, "message", errors)
    _check_finding_details(item, path, errors)


def _check_finding_details(
    finding: FindingObject, path: str, errors: list[str]
) -> None:
    line = finding.get("line")
    if not isinstance(line, int) or isinstance(line, bool) or line < 1:
        errors.append(f"{path}.line must be an integer >= 1")
    if finding.get("severity") not in ("P0", "P1", "P2"):
        errors.append(f"{path}.severity must be P0, P1, or P2")


def _check_axis(axis: object, path: str, errors: list[str]) -> None:
    raw = _require_dict(axis, path, errors)
    if raw is None:
        return
    item = cast(AxisObject, raw)
    _check_unknown_fields(raw, AXIS_FIELDS, path, errors)
    _check_axis_status(item, path, errors)
    _check_axis_findings(item, path, errors)


def _check_axis_status(axis: AxisObject, path: str, errors: list[str]) -> None:
    if axis.get("status") not in ("approve", "reject"):
        errors.append(f"{path}.status must be approve or reject")


def _check_axis_findings(axis: AxisObject, path: str, errors: list[str]) -> None:
    findings = axis.get("findings")
    if not isinstance(findings, list):
        errors.append(f"{path}.findings must be a list")
        return
    for index, item in enumerate(findings):
        _check_finding(item, f"{path}.findings[{index}]", errors)


def _check_axes(obj: VerdictObject, errors: list[str]) -> None:
    axes = obj.get("axes")
    if not isinstance(axes, dict):
        errors.append("axes must be an object with standards and spec")
        return
    item = cast(AxesObject, axes)
    _check_unknown_fields(item, AXES_FIELDS, "axes", errors)
    _check_axes_present(item, errors)


def _check_axes_present(axes: AxesObject, errors: list[str]) -> None:
    _check_axis_present(axes, "standards", errors)
    _check_axis_present(axes, "spec", errors)


def _check_axis_present(axes: AxesObject, name: str, errors: list[str]) -> None:
    if name in axes:
        _check_axis(axes.get(name), f"axes.{name}", errors)
    else:
        errors.append(f"axes.{name} is required")


def _check_items(
    obj: VerdictObject,
    name: str,
    errors: list[str],
    check_one: Checker,
    min_items: int = 0,
) -> None:
    items = obj.get(name)
    if not isinstance(items, list):
        errors.append(f"{name} must be a list")
        return
    if len(items) < min_items:
        errors.append(f"{name} must not be empty")
    _check_each(items, name, check_one, errors)


def _check_each(
    items: list[object], name: str, check_one: Checker, errors: list[str]
) -> None:
    for index, item in enumerate(items):
        check_one(item, f"{name}[{index}]", errors)


def _check_ac_mapping(item: object, path: str, errors: list[str]) -> None:
    raw = _require_dict(item, path, errors)
    if raw is None:
        return
    entry = cast(AcMappingObject, raw)
    _check_unknown_fields(raw, AC_FIELDS, path, errors)
    _check_required_str(entry, "ac_id", errors)
    _check_required_str(entry, "test_path", errors)
    _check_test_type(entry, path, errors)


def _check_test_type(item: AcMappingObject, path: str, errors: list[str]) -> None:
    if item.get("test_type") not in ("unit", "integration", "eval", "browser", "api"):
        errors.append(
            f"{path}.test_type must be unit, integration, eval, browser, or api"
        )


def _check_gate_run(item: object, path: str, errors: list[str]) -> None:
    raw = _require_dict(item, path, errors)
    if raw is None:
        return
    run = cast(GateRunObject, raw)
    _check_unknown_fields(raw, GATE_RUN_FIELDS, path, errors)
    _check_required_str(run, "command", errors)
    _check_required_str(run, "evidence", errors)
    _check_exit_code(run, path, errors)


def _check_exit_code(item: GateRunObject, path: str, errors: list[str]) -> None:
    exit_code = item.get("exit")
    if not isinstance(exit_code, int) or isinstance(exit_code, bool):
        errors.append(f"{path}.exit must be an integer")


def _check_mutation_run(item: object, path: str, errors: list[str]) -> None:
    raw = _require_dict(item, path, errors)
    if raw is None:
        return
    run = cast(MutationRunObject, raw)
    _check_unknown_fields(raw, MUTATION_RUN_FIELDS, path, errors)
    _check_required_str(run, "probe", errors)
    _check_required_str(run, "mutation", errors)
    _check_bool_flags(run, path, errors)


def _check_bool_flags(item: MutationRunObject, path: str, errors: list[str]) -> None:
    for flag in ("red", "restore", "green"):
        _check_bool_flag(item, flag, path, errors)


def _check_bool_flag(
    item: MutationRunObject, flag: str, path: str, errors: list[str]
) -> None:
    if not isinstance(item.get(flag), bool):
        errors.append(f"{path}.{flag} must be a boolean")


def _check_reviewer(obj: VerdictObject, errors: list[str]) -> None:
    raw = _require_dict(obj.get("reviewer"), "reviewer", errors)
    if raw is None:
        return
    item = cast(ReviewerObject, raw)
    _check_unknown_fields(raw, REVIEWER_FIELDS, "reviewer", errors)
    _check_required_str(item, "identity", errors)
    if item.get("role") != "reviewer-seat":
        errors.append("reviewer.role must be reviewer-seat")


def _check_timestamp(obj: VerdictObject, errors: list[str]) -> None:
    value = obj.get("reviewed_at")
    if not isinstance(value, str) or not RFC3339_RE.match(value):
        errors.append(
            "reviewed_at must be an RFC-3339 timestamp with timezone and seconds"
        )
        return
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append(
            "reviewed_at must be an RFC-3339 timestamp with timezone and seconds"
        )


def _check_version(obj: VerdictObject, errors: list[str]) -> None:
    if obj.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION}")


def _check_pinned_fields(obj: VerdictObject, errors: list[str]) -> None:
    _check_hex_field(obj, "base_sha", 40, errors)
    _check_hex_field(obj, "head_sha", 40, errors)
    _check_hex_field(obj, "brief_digest", 64, errors)
    _check_version(obj, errors)


def _check_evidence_lists(obj: VerdictObject, errors: list[str]) -> None:
    _check_items(obj, "ac_to_test", errors, _check_ac_mapping, min_items=1)
    _check_items(obj, "gate_evidence", errors, _check_gate_run, min_items=1)
    _check_items(obj, "mutation_evidence", errors, _check_mutation_run, min_items=1)


# An approval-claimed verdict must prove its evidence: every recorded gate run
# exits 0 and every mutation run shows red/restore/green (issue #1008 review
# finding 2). The canonical proof lives in review_verdict so gate_local and
# this validator never disagree about what an approval requires.
def _check_approval_proof(obj: VerdictObject, errors: list[str]) -> None:
    if not _claims_approval(obj):
        return
    errors.extend(approval_evidence_reasons(parse_verdict(obj)))


def _claims_approval(obj: VerdictObject) -> bool:
    axes = obj.get("axes")
    if not isinstance(axes, dict):
        return False
    return _axis_approves(axes, "standards") and _axis_approves(axes, "spec")


def _axis_approves(axes: AxesObject, name: str) -> bool:
    value = axes.get(name)
    if not isinstance(value, dict):
        return False
    return value.get("status") == "approve"


# Return schema violations for a verdict object; empty means valid (AC1).
def validate_verdict(obj: object) -> list[str]:
    if not isinstance(obj, dict):
        return ["verdict must be a JSON object"]
    verdict = cast(VerdictObject, obj)
    return _with_approval_proof(verdict, _shape_errors(verdict))


def _shape_errors(verdict: VerdictObject) -> list[str]:
    errors: list[str] = []
    _check_unknown_fields(verdict, ALLOWED_FIELDS, "", errors)
    _check_pinned_fields(verdict, errors)
    _check_reviewer(verdict, errors)
    _check_timestamp(verdict, errors)
    _check_axes(verdict, errors)
    _check_evidence_lists(verdict, errors)
    check_evidence_completeness(verdict, errors)
    return errors


def _with_approval_proof(obj: VerdictObject, errors: list[str]) -> list[str]:
    if not errors:
        _check_approval_proof(obj, errors)
    return errors
