"""Ownership, deletion, and deadline contracts for Neon test branches."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from agent.tests.neon_api import Branch, NeonApi

START = datetime(2026, 7, 18, tzinfo=UTC)


def _parent() -> Branch:
    return Branch("br-parent", "test-base", "project-test", "br-main", False)


def _candidate(branch_id: str) -> Branch:
    return Branch(branch_id, "pending", "project-test", "br-parent", False, START)


class ClaimApi(NeonApi):
    def __init__(
        self,
        candidates: tuple[Branch, ...],
        verification_names: dict[str, list[str]] | None = None,
    ) -> None:
        super().__init__("secret", "project-test")
        self.branches = {branch.id: branch for branch in candidates}
        self.verification_names = verification_names or {}
        self.claimed: list[str] = []

    def list_branches(self, timeout: float = 20.0) -> tuple[Branch, ...]:
        assert timeout > 0
        return tuple(self.branches.values())

    def update_branch_name(
        self, branch_id: str, name: str, timeout: float = 20.0
    ) -> bool:
        assert timeout > 0
        self.claimed.append(branch_id)
        self.branches[branch_id] = replace(self.branches[branch_id], name=name)
        return True

    def get_branch_or_none(
        self, branch_id: str, timeout: float = 20.0
    ) -> Branch | None:
        assert timeout > 0
        branch = self.branches.get(branch_id)
        names = self.verification_names.get(branch_id, [])
        if branch is None or not names:
            return branch
        renamed = replace(branch, name=names.pop(0))
        self.branches[branch_id] = renamed
        return renamed


def test_single_candidate_is_rename_claimed() -> None:
    api = ClaimApi((_candidate("br-a"),))
    claimed = api.wait_for_ephemeral(
        (), _parent(), "wt-test-session-a", START - timedelta(seconds=1)
    )
    assert claimed.id == "br-a"
    assert claimed.name == "wt-test-session-a"
    assert api.claimed == ["br-a"]


def test_overwrite_after_first_verification_is_detected_on_reverify() -> None:
    # A verifies its token, THEN a concurrent session overwrites the name:
    # the first read returns our token, the delayed re-verification exposes
    # the overwrite, and the claim moves on to the next candidate.
    api = ClaimApi(
        (_candidate("br-a"), _candidate("br-b")),
        {"br-a": ["wt-test-session-a", "wt-test-other-session"]},
    )
    claimed = api.wait_for_ephemeral(
        (), _parent(), "wt-test-session-a", START - timedelta(seconds=1)
    )
    assert claimed.id == "br-b"
    assert claimed.name == "wt-test-session-a"
    assert api.claimed == ["br-a", "br-b"]


def test_raced_candidate_is_rejected_then_next_is_claimed() -> None:
    api = ClaimApi(
        (_candidate("br-a"), _candidate("br-b")),
        {"br-a": ["wt-test-other-session"]},
    )
    claimed = api.wait_for_ephemeral(
        (), _parent(), "wt-test-session-a", START - timedelta(seconds=1)
    )
    assert claimed.id == "br-b"
    assert claimed.name == "wt-test-session-a"
    assert api.claimed == ["br-a", "br-b"]


def _branch_payload(name: str) -> object:
    return {
        "branch": {
            "id": "br-a",
            "name": name,
            "project_id": "project-test",
            "parent_id": "br-parent",
            "default": False,
        }
    }


def test_teardown_refuses_to_delete_branch_without_ownership_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def requester(path: str, timeout: float) -> object:
        assert path.endswith("/br-a") and timeout > 0
        return _branch_payload("wt-test-other-session")

    api = NeonApi("secret", "project-test", requester)
    monkeypatch.setattr(
        api, "delete_branch", lambda branch_id: pytest.fail(f"deleted {branch_id}")
    )
    with pytest.raises(RuntimeError, match="without session ownership token"):
        api.delete_claimed_branch("br-a", "wt-test-session-a")


def test_branch_present_with_matching_token_is_deleted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def requester(path: str, timeout: float) -> object:
        assert path.endswith("/br-a") and timeout > 0
        return _branch_payload("wt-test-session-a")

    deleted: list[str] = []
    api = NeonApi("secret", "project-test", requester)
    monkeypatch.setattr(api, "delete_branch", deleted.append)
    api.delete_claimed_branch("br-a", "wt-test-session-a")
    assert deleted == ["br-a"]


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, delay: float) -> None:
        self.sleeps.append(delay)
        self.now += delay


def test_delete_retries_423_then_accepts_204(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses = [423, 204]
    clock = FakeClock()
    api = NeonApi("secret", "project-test", clock=clock, sleeper=clock.sleep)

    def delete_once(branch_id: str, timeout: float) -> int:
        assert branch_id == "br-a" and 0 < timeout <= 20
        return statuses.pop(0)

    monkeypatch.setattr(api, "_delete_once", delete_once)
    api.delete_branch("br-a")
    assert statuses == []
    assert clock.sleeps == [1.0]


def test_claim_polling_uses_one_wall_clock_deadline() -> None:
    clock = FakeClock()
    timeouts: list[float] = []

    def requester(path: str, timeout: float) -> object:
        assert path.endswith("branches?limit=100")
        timeouts.append(timeout)
        clock.now += timeout
        return {"branches": []}

    api = NeonApi("secret", "project-test", requester, clock=clock, sleeper=clock.sleep)
    with pytest.raises(RuntimeError, match="within 60 seconds"):
        api.wait_for_ephemeral(
            (), _parent(), "wt-test-session-a", START - timedelta(seconds=1)
        )
    assert clock.now == 60
    assert timeouts == [20, 20, 16]
