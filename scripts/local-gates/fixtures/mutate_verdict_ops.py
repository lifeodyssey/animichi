"""Mutation ops for the review-gate verdict fixtures (issue #1008).

Called by ``mutate_verdict.py`` with the mutation ``op`` from the red → restore
→ green probes; each op changes exactly one invariant, unknown ops exit 2.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict, cast


class ReviewerRaw(TypedDict, total=False):
    identity: str
    role: str
    extra: bool


class AxisRaw(TypedDict, total=False):
    status: str
    findings: list[object]
    extra: bool


class AxesRaw(TypedDict, total=False):
    standards: AxisRaw
    spec: AxisRaw
    extra: bool


class EntryRaw(TypedDict, total=False):
    ac_id: str
    test_type: str
    test_path: str
    command: str
    exit: int
    evidence: str
    probe: str
    mutation: str
    red: object
    restore: object
    green: object
    extra: bool


class VerdictRaw(TypedDict, total=False):
    schema_version: int
    base_sha: str
    head_sha: str
    brief_digest: str
    reviewer: ReviewerRaw
    reviewed_at: str
    axes: AxesRaw
    ac_total: int
    ac_to_test: list[object]
    gate_evidence: list[object]
    mutation_evidence: list[object]
    repair_evidence: object
    extra: bool


Mutation = Callable[[VerdictRaw], VerdictRaw]


def _drop_keys(data: VerdictRaw, keys: list[str]) -> VerdictRaw:
    for key in keys:
        data.pop(key, None)
    return data


def _empty_list(data: VerdictRaw, name: str) -> VerdictRaw:
    data[name] = []
    return data


def _set_value(data: VerdictRaw, name: str, value: object) -> VerdictRaw:
    data[name] = value
    return data


def _dup_ac(data: VerdictRaw) -> VerdictRaw:
    second = _items(data, "ac_to_test")[1]
    if not isinstance(second, dict):
        raise TypeError("ac_to_test entries must be objects")
    cast(EntryRaw, second)["ac_id"] = str(
        _first(_items(data, "ac_to_test")).get("ac_id", "")
    )
    return data


def _empty_all(data: VerdictRaw) -> VerdictRaw:
    for name in ("ac_to_test", "gate_evidence", "mutation_evidence"):
        _empty_list(data, name)
    return data


def _spec_partial(data: VerdictRaw) -> VerdictRaw:
    _axis(data, "spec")["status"] = "partial"
    return data


def _finding_line_zero(data: VerdictRaw) -> VerdictRaw:
    _axis(data, "spec")["findings"] = [
        {"file": "f", "line": 0, "severity": "P1", "message": "m"}
    ]
    return data


def _bad_test_type(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "ac_to_test"))["test_type"] = "smoke"
    return data


def _bad_mutation_flag(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "mutation_evidence"))["red"] = "yes"
    return data


def _bad_gate_exit(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "gate_evidence"))["exit"] = 1
    return data


def _bad_red(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "mutation_evidence"))["red"] = False
    return data


def _bad_restore(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "mutation_evidence"))["restore"] = False
    return data


def _bad_green(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "mutation_evidence"))["green"] = False
    return data


def _bad_role(data: VerdictRaw) -> VerdictRaw:
    _reviewer(data)["role"] = "executor"
    return data


def _unknown_field(data: VerdictRaw) -> VerdictRaw:
    return cast(VerdictRaw, {**data, "extra": True})


def _unknown_reviewer(data: VerdictRaw) -> VerdictRaw:
    _reviewer(data)["extra"] = True
    return data


def _unknown_axes(data: VerdictRaw) -> VerdictRaw:
    _axes(data)["extra"] = True
    return data


def _unknown_axis(data: VerdictRaw) -> VerdictRaw:
    _axis(data, "standards")["extra"] = True
    return data


def _unknown_finding(data: VerdictRaw) -> VerdictRaw:
    _axis(data, "standards")["findings"] = [
        {"file": "f", "line": 1, "severity": "P1", "message": "m", "extra": True}
    ]
    return data


def _unknown_ac(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "ac_to_test"))["extra"] = True
    return data


def _unknown_gate(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "gate_evidence"))["extra"] = True
    return data


def _unknown_mutation(data: VerdictRaw) -> VerdictRaw:
    _first(_items(data, "mutation_evidence"))["extra"] = True
    return data


def _bad_version(data: VerdictRaw) -> VerdictRaw:
    data["schema_version"] = 2
    return data


def _axes(data: VerdictRaw) -> AxesRaw:
    axes = data.get("axes")
    if not isinstance(axes, dict):
        raise TypeError("axes must be an object")
    return cast(AxesRaw, axes)


def _axis(data: VerdictRaw, name: str) -> AxisRaw:
    axis = _axes(data).get(name)
    if not isinstance(axis, dict):
        raise TypeError(f"{name} axis must be an object")
    return cast(AxisRaw, axis)


def _items(data: VerdictRaw, name: str) -> list[object]:
    items = data.get(name)
    if not isinstance(items, list):
        raise TypeError(f"{name} must be a list")
    return items


def _first(items: list[object]) -> EntryRaw:
    first = items[0]
    if not isinstance(first, dict):
        raise TypeError("entry must be an object")
    return cast(EntryRaw, first)


def _reviewer(data: VerdictRaw) -> ReviewerRaw:
    reviewer = data.get("reviewer")
    if not isinstance(reviewer, dict):
        raise TypeError("reviewer must be an object")
    return cast(ReviewerRaw, reviewer)


MUTATIONS: dict[str, Mutation] = {
    "drop-head": lambda d: _drop_keys(d, ["head_sha"]),
    "drop-ac-mapping": lambda d: _drop_keys(d, ["ac_to_test"]),
    "bad-version": _bad_version,
    "spec-partial": _spec_partial,
    "finding-line-zero": _finding_line_zero,
    "bad-test-type": _bad_test_type,
    "bad-mutation-flag": _bad_mutation_flag,
    "bad-gate-exit": _bad_gate_exit,
    "bad-red": _bad_red,
    "bad-restore": _bad_restore,
    "bad-green": _bad_green,
    "bad-role": _bad_role,
    "unknown-field": _unknown_field,
    "unknown-reviewer": _unknown_reviewer,
    "unknown-axes": _unknown_axes,
    "unknown-axis": _unknown_axis,
    "unknown-finding": _unknown_finding,
    "unknown-ac": _unknown_ac,
    "unknown-gate": _unknown_gate,
    "unknown-mutation": _unknown_mutation,
    "bad-reviewed-at": lambda d: _set_value(d, "reviewed_at", "not-a-timestamp"),
    "date-only-reviewed-at": lambda d: _set_value(d, "reviewed_at", "2026-08-13"),
    "no-tz-reviewed-at": lambda d: _set_value(d, "reviewed_at", "2026-08-13T12:00:00"),
    "no-seconds-reviewed-at": lambda d: _set_value(
        d, "reviewed_at", "2026-08-13T12:00+00:00"
    ),
    "empty-ac-to-test": lambda d: _empty_list(d, "ac_to_test"),
    "empty-gate-evidence": lambda d: _empty_list(d, "gate_evidence"),
    "empty-mutation-evidence": lambda d: _empty_list(d, "mutation_evidence"),
    "empty-all-evidence": _empty_all,
    "drop-ac-total": lambda d: _drop_keys(d, ["ac_total"]),
    "bad-ac-total": lambda d: _set_value(d, "ac_total", 0),
    "ac-count-mismatch": lambda d: _set_value(d, "ac_total", 5),
    "duplicate-ac-id": _dup_ac,
    "repair-opencode-fabricated": lambda d: _set_value(
        d, "repair_evidence", {"mode": "opencode"}
    ),
    "repair-bad-mode": lambda d: _set_value(d, "repair_evidence", {"mode": "extern"}),
    "repair-local-with-orchestrator": lambda d: _set_value(
        d,
        "repair_evidence",
        {"mode": "local-deterministic-harness", "command": "opencode run --session s"},
    ),
    "repair-opencode-complete": lambda d: _set_value(
        d,
        "repair_evidence",
        {
            "mode": "opencode",
            "command": "opencode run --brief TASK-BRIEF.md",
            "session": "sess-abc123",
            "log_digest": "3aab50ac2fa74c0cceccdca0226067152880096f2d6a925175863f6cb03436d1",
        },
    ),
}


def load(path: str) -> VerdictRaw:
    import json

    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise TypeError("verdict fixture must be a JSON object")
    return cast(VerdictRaw, data)


def save(path: str, data: VerdictRaw) -> None:
    import json

    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
