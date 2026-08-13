#!/usr/bin/env python3
"""Local review verdict artifact: model, digests, local gate (issue #1008).

Single source of the verdict-artifact invariants from ``docs/ops/review-gate.md``.
Pure stdlib. The CLI lives in ``review_verdict_cli.py``; the required PR gate in
``pr_review_check.py``. Both consume this module so shell and Python can never
disagree on what a verdict is. Schema validation lives in ``verdict_schema.py``
and imports the shared constants from here.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

SCHEMA_VERSION: Final[int] = 1
HEX_RE: Final[re.Pattern[str]] = re.compile(r"^[0-9a-f]+$")


def sha256_hex(text: str) -> str:
    """Content hash; also used for the non-cryptographic brief digest."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def brief_digest(text: str) -> str:
    """Digest of the reviewed brief (issue body / ticket scope)."""
    return sha256_hex(text.strip() + "\n")


def findings_snapshot(head_sha: str, findings: Sequence[str]) -> str:
    """Hash pinning an acknowledgement to a head SHA plus the findings set.

    A new commit (head SHA) or a later managed finding changes the value, so a
    previously bound acknowledgement becomes stale by construction (AC5).
    """
    payload = json.dumps([head_sha, sorted(findings)], sort_keys=True)
    return sha256_hex(payload)


@dataclass(frozen=True)
class Finding:
    file: str
    line: int
    severity: str
    message: str


@dataclass(frozen=True)
class AxisVerdict:
    status: str
    findings: tuple[Finding, ...] = ()


@dataclass(frozen=True)
class AcMapping:
    ac_id: str
    test_type: str
    test_path: str


@dataclass(frozen=True)
class GateRun:
    command: str
    exit_code: int
    evidence: str


@dataclass(frozen=True)
class MutationRun:
    probe: str
    mutation: str
    red: bool
    restore: bool
    green: bool


@dataclass(frozen=True)
class Verdict:
    schema_version: int
    base_sha: str
    head_sha: str
    brief_digest: str
    reviewer_identity: str
    reviewed_at: str
    standards: AxisVerdict
    spec: AxisVerdict
    ac_total: int
    ac_to_test: tuple[AcMapping, ...]
    gate_evidence: tuple[GateRun, ...]
    mutation_evidence: tuple[MutationRun, ...]


@dataclass(frozen=True)
class LocalGate:
    state: str
    standards: str
    spec: str
    reasons: tuple[str, ...] = ()


# Judge a verdict against the current base/head/brief (AC2).
def gate_local(
    verdict: Verdict, base_sha: str, head_sha: str, brief_text: str
) -> LocalGate:
    standards = verdict.standards.status
    spec = verdict.spec.status
    stale = _stale_reasons(verdict, base_sha, head_sha, brief_text)
    if stale:
        return LocalGate("stale", standards, spec, tuple(stale))
    rejected = _rejected_axes(standards, spec)
    if rejected:
        return LocalGate("reject", standards, spec, tuple(rejected))
    return _approve_or_unproven(verdict, standards, spec)


def _approve_or_unproven(verdict: Verdict, standards: str, spec: str) -> LocalGate:
    unproven = approval_evidence_reasons(verdict)
    if unproven:
        return LocalGate("reject", standards, spec, unproven)
    return LocalGate("approve", standards, spec, ())


# An approval must be proven by the recorded evidence, not merely typed: every
# gate run must exit 0 and every mutation run must demonstrate the full
# red → restore → green triple. A reject artifact may describe failed evidence;
# this is only consulted once both axes approve (issue #1008 review finding 2).
def approval_evidence_reasons(verdict: Verdict) -> tuple[str, ...]:
    return tuple(_gate_run_reasons(verdict) + _mutation_reasons(verdict))


def _gate_run_reasons(verdict: Verdict) -> list[str]:
    return [
        f"gate run exited {run.exit_code}; approval requires exit == 0: {run.command}"
        for run in verdict.gate_evidence
        if run.exit_code != 0
    ]


def _mutation_reasons(verdict: Verdict) -> list[str]:
    return [
        f"mutation probe did not prove red/restore/green: {probe.probe}"
        for probe in verdict.mutation_evidence
        if not (probe.red and probe.restore and probe.green)
    ]


def _stale_reasons(
    verdict: Verdict, base_sha: str, head_sha: str, brief_text: str
) -> list[str]:
    reasons: list[str] = []
    if verdict.base_sha != base_sha:
        reasons.append("verdict base_sha does not match the reviewed base")
    if verdict.head_sha != head_sha:
        reasons.append(
            "head_sha changed since review; a complete new review is required"
        )
    if verdict.brief_digest != brief_digest(brief_text):
        reasons.append("verdict brief_digest does not match the reviewed brief")
    return reasons


def _rejected_axes(standards: str, spec: str) -> list[str]:
    rejected = [
        axis
        for axis, status in (("standards", standards), ("spec", spec))
        if status == "reject"
    ]
    return [f"{axis} axis rejected" for axis in rejected]
