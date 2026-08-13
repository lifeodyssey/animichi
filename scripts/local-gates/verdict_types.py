"""Raw JSON verdict shapes for the review gate (issue #1008).

TypedDicts for the *pre-validation* JSON verdict artifact so the schema and
parse modules model the contract precisely instead of an untyped dict. Every
type is ``total=False`` because these describe the unvalidated input;
``verdict_schema.validate_verdict`` rejects missing/unknown fields and the
parser only runs after validation.
"""

from __future__ import annotations

from typing import TypedDict


class FindingObject(TypedDict, total=False):
    file: str
    line: int
    severity: str
    message: str


class AxisObject(TypedDict, total=False):
    status: str
    findings: list[FindingObject]


class AxesObject(TypedDict, total=False):
    standards: AxisObject
    spec: AxisObject


class ReviewerObject(TypedDict, total=False):
    identity: str
    role: str


class AcMappingObject(TypedDict, total=False):
    ac_id: str
    test_type: str
    test_path: str


class GateRunObject(TypedDict, total=False):
    command: str
    exit: int
    evidence: str


class MutationRunObject(TypedDict, total=False):
    probe: str
    mutation: str
    red: bool
    restore: bool
    green: bool


class RepairEvidenceObject(TypedDict, total=False):
    mode: str
    command: str
    session: str
    log_digest: str


class VerdictObject(TypedDict, total=False):
    schema_version: int
    base_sha: str
    head_sha: str
    brief_digest: str
    reviewer: ReviewerObject
    reviewed_at: str
    axes: AxesObject
    ac_total: int
    ac_to_test: list[AcMappingObject]
    gate_evidence: list[GateRunObject]
    mutation_evidence: list[MutationRunObject]
    repair_evidence: RepairEvidenceObject


# Union of every unvalidated JSON object shape the schema/parse helpers walk.
ObjectLike = (
    VerdictObject
    | ReviewerObject
    | AxesObject
    | AxisObject
    | FindingObject
    | AcMappingObject
    | GateRunObject
    | MutationRunObject
    | RepairEvidenceObject
)
