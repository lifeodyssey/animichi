"""Evidence-completeness validation for the verdict artifact (issue #1008).

The Quality Ratchet requires every AC to map to a concrete test:
``ac_total`` must be the reviewed brief's declared total — a positive integer
with ``len(ac_to_test) == ac_total`` and unique, non-empty mapping ids. The
generic schema never hard-codes AC1..AC6; the count is whatever the brief
declares (finding 3).

``repair_evidence`` records what the AC6 flow actually did: the deterministic
local harness (``mode: local-deterministic-harness``, nothing else) or a real
OpenCode repair session (``mode: opencode`` with the actual command, session,
and log digest). An OpenCode run is never fabricated and no future exit is
hard-coded — opencode mode without its orchestrator fields fails closed
(finding 5).

Standalone module: re-defines the tiny shared shape helpers so it stays
import-safe without a schema round-trip (same convention as the review-gate
Ruby contract scripts).
"""

from __future__ import annotations

import re
from typing import Final, cast

from verdict_types import RepairEvidenceObject, VerdictObject

REPAIR_FIELDS: Final[frozenset[str]] = frozenset(
    {"mode", "command", "session", "log_digest"}
)
HEX_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9a-f]+$")


def check_evidence_completeness(obj: VerdictObject, errors: list[str]) -> None:
    _check_ac_total(obj, errors)
    _check_ac_count(obj, errors)
    _check_ac_unique(obj, errors)
    _check_repair_evidence(obj, errors)


def _check_ac_total(obj: VerdictObject, errors: list[str]) -> None:
    total = obj.get("ac_total")
    if not isinstance(total, int) or isinstance(total, bool) or total < 1:
        errors.append("ac_total must be a positive integer")


def _check_ac_count(obj: VerdictObject, errors: list[str]) -> None:
    mappings = obj.get("ac_to_test")
    if not isinstance(mappings, list):
        return
    total = obj.get("ac_total")
    if (
        isinstance(total, int)
        and not isinstance(total, bool)
        and len(mappings) != total
    ):
        errors.append(f"ac_to_test has {len(mappings)} entries but ac_total is {total}")


def _check_ac_unique(obj: VerdictObject, errors: list[str]) -> None:
    mappings = obj.get("ac_to_test")
    if not isinstance(mappings, list):
        return
    seen: set[str] = set()
    for index, item in enumerate(mappings):
        _flag_duplicate(item, index, seen, errors)


def _flag_duplicate(
    item: object, index: int, seen: set[str], errors: list[str]
) -> None:
    if not isinstance(item, dict):
        return
    ac_id = item.get("ac_id")
    if not isinstance(ac_id, str):
        return
    if ac_id in seen:
        errors.append(f"ac_to_test[{index}] duplicates ac_id {ac_id!r}")
    seen.add(ac_id)


def _check_repair_evidence(obj: VerdictObject, errors: list[str]) -> None:
    check_repair_evidence(obj.get("repair_evidence"), errors)


# Public contract for a repair_evidence record; shared by the verdict
# validator above and the orchestrator-facing repair-evidence recorder
# (scripts/local-gates/repair_evidence_record.py) so the producer can never
# emit a record the validator rejects (issue #1008 AC6, finding 5).
def check_repair_evidence(record: object, errors: list[str]) -> None:
    if record is None:
        return
    item = _require_dict(record, "repair_evidence", errors)
    if item is None:
        return
    _check_repair_fields(cast(RepairEvidenceObject, item), errors)


def _check_repair_fields(repair: RepairEvidenceObject, errors: list[str]) -> None:
    _check_unknown_fields(repair, REPAIR_FIELDS, "repair_evidence", errors)
    _check_repair_mode(repair, errors)


def _check_repair_mode(repair: RepairEvidenceObject, errors: list[str]) -> None:
    if repair.get("mode") == "opencode":
        _check_repair_orchestrator(repair, errors)
    elif repair.get("mode") == "local-deterministic-harness":
        _check_repair_local(repair, errors)
    else:
        errors.append(
            "repair_evidence.mode must be local-deterministic-harness or opencode"
        )


def _check_repair_orchestrator(repair: RepairEvidenceObject, errors: list[str]) -> None:
    _check_required_str(repair, "command", errors)
    _check_required_str(repair, "session", errors)
    if not _is_hex(repair.get("log_digest"), 64):
        errors.append("repair_evidence.log_digest must be 64 lowercase hex characters")


def _check_repair_local(repair: RepairEvidenceObject, errors: list[str]) -> None:
    for name in ("command", "session", "log_digest"):
        _reject_local_field(repair, name, errors)


def _reject_local_field(
    repair: RepairEvidenceObject, name: str, errors: list[str]
) -> None:
    if repair.get(name) is not None:
        errors.append(f"repair_evidence.{name} is only valid for opencode mode")


def _require_dict(
    value: object, path: str, errors: list[str]
) -> VerdictObject | RepairEvidenceObject | None:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object")
        return None
    return cast(RepairEvidenceObject, value)


def _check_unknown_fields(
    obj: RepairEvidenceObject, allowed: frozenset[str], path: str, errors: list[str]
) -> None:
    for name in sorted(set(obj) - allowed):
        errors.append(f"unknown field: {path}.{name}")


def _check_required_str(
    obj: RepairEvidenceObject, name: str, errors: list[str]
) -> None:
    if not isinstance(obj.get(name), str) or not obj.get(name):
        errors.append(f"repair_evidence.{name} must be a non-empty string")


def _is_hex(value: object, length: int) -> bool:
    return isinstance(value, str) and len(value) == length and bool(HEX_RE.match(value))
