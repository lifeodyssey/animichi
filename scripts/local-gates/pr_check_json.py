"""JSON serialization for the required PR check verdict (issue #1008).

Small internal module for the gate's JSON payload shape so ``pr_review_check``
stays readable and within the repo file limit. The payload is modelled with
TypedDicts so every field is precise.
"""

from __future__ import annotations

import json
from typing import TypedDict

from pr_check_types import PrGate
from review_verdict import LocalGate


class ThreadsPayload(TypedDict):
    unresolved: int
    ok: bool


class FindingsPayload(TypedDict):
    managed: list[str]
    snapshot: str
    ack: str
    ok: bool


class ApprovalPayload(TypedDict):
    marker: str
    ok: bool


class VerdictPayload(TypedDict):
    state: str
    standards: str
    spec: str
    ok: bool


class GatePayload(TypedDict):
    approve: bool
    state: str
    head_sha: str
    threads: ThreadsPayload
    findings: FindingsPayload
    approval: ApprovalPayload
    verdict: VerdictPayload | None
    reason: str


def gate_to_json(gate: PrGate) -> str:
    return json.dumps(_gate_payload(gate), sort_keys=True)


def _gate_payload(gate: PrGate) -> GatePayload:
    return {
        "approve": gate.approve,
        "state": gate.state,
        "head_sha": gate.head_sha,
        "threads": _threads_payload(gate),
        "findings": _findings_payload(gate),
        "approval": _approval_payload(gate),
        "verdict": _verdict_payload(gate.local),
        "reason": gate.reason,
    }


def _approval_payload(gate: PrGate) -> ApprovalPayload:
    return {"marker": gate.marker, "ok": gate.marker in ("local", "bound")}


def _threads_payload(gate: PrGate) -> ThreadsPayload:
    return {"unresolved": gate.threads_unresolved, "ok": gate.threads_unresolved == 0}


def _findings_payload(gate: PrGate) -> FindingsPayload:
    return {
        "managed": list(gate.findings),
        "snapshot": gate.snapshot,
        "ack": gate.ack,
        "ok": gate.ack in ("clear", "bound"),
    }


def _verdict_payload(local: LocalGate | None) -> VerdictPayload | None:
    if local is None:
        return None
    return {
        "state": local.state,
        "standards": local.standards,
        "spec": local.spec,
        "ok": local.state == "approve",
    }
