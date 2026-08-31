"""Typed records used by the local pull-request blocker diagnosis."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PullRequest:
    number: int
    base_ref: str
    base_sha: str
    head_sha: str
    merge_state: str


ACTIONS_INTEGRATION_ID = 15368


@dataclass(frozen=True)
class RequiredCheck:
    name: str
    integration_id: int | None
    # "check" matches classic statuses (required-by-PR) and same-integration
    # check runs; "code_scanning" matches ONLY the tool's check run from the
    # GitHub Actions integration (issue #1214: a same-named classic status
    # must never satisfy a code-scanning requirement).
    kind: str = "check"

    def matches(self, observed: Observation) -> bool:
        if self.name != observed.name:
            return False
        if self.kind == "code_scanning":
            return (
                observed.source == "check-run"
                and observed.integration_id == ACTIONS_INTEGRATION_ID
            )
        if self.integration_id is None:
            return True
        if observed.source == "status":
            return observed.required_by_pr is True
        return self.integration_id == observed.integration_id


@dataclass(frozen=True)
class Observation:
    name: str
    status: str
    conclusion: str
    source: str
    observed_at: str
    identifier: int
    integration_id: int | None
    required_by_pr: bool | None = None

    @classmethod
    def missing(cls, required: RequiredCheck) -> Observation:
        return cls(
            required.name, "missing", "missing", "none", "", 0, required.integration_id
        )


@dataclass(frozen=True)
class Diagnosis:
    pull_request: PullRequest
    blockers: tuple[Observation, ...]
    behind_by: int
    unresolved_threads: int

    @property
    def blocked(self) -> bool:
        state_blocked = self.pull_request.merge_state != "CLEAN"
        return bool(
            state_blocked or self.blockers or self.behind_by or self.unresolved_threads
        )
