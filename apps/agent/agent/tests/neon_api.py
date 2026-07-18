"""Typed, secret-safe Neon Admin API helpers for database test branches."""

from __future__ import annotations

import http.client
import json
import time
import urllib.parse
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from agent.tests.db_config import endpoint_id_from_dsn

NEON_API_HOST = "console.neon.tech"
JSON_MIME = "application/json"
TEST_BASE_NAME = "test-base"
CLAIM_PREFIX = "wt-test-"
REQUEST_TIMEOUT_SECONDS = 20.0
POLL_TIMEOUT_SECONDS = 60.0
DELETE_TIMEOUT_SECONDS = 45.0
DELETE_ATTEMPTS = 3


@dataclass(frozen=True)
class Branch:
    id: str
    name: str
    project_id: str
    parent_id: str | None
    default: bool
    created_at: datetime | None = None


JsonRequester = Callable[[str, float], object | None]
Clock = Callable[[], float]
Sleeper = Callable[[float], None]


def _mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise RuntimeError(f"Neon API {label} had an unexpected shape")
    return value


def _text(payload: Mapping[str, object], key: str, label: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"Neon API {label} omitted {key}")
    return value


def parse_branch(value: object) -> Branch:
    payload = _mapping(value, "branch")
    parent = payload.get("parent_id")
    if parent is not None and not isinstance(parent, str):
        raise RuntimeError("Neon API branch had an invalid parent_id")
    created_at = _optional_datetime(payload.get("created_at"))
    return Branch(
        _text(payload, "id", "branch"),
        _text(payload, "name", "branch"),
        _text(payload, "project_id", "branch"),
        parent,
        payload.get("default") is True,
        created_at,
    )


def _optional_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise RuntimeError("Neon API branch had an invalid created_at")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_branches(value: object) -> tuple[Branch, ...]:
    raw = _mapping(value, "branch list").get("branches")
    if not isinstance(raw, list):
        raise RuntimeError("Neon API branch list omitted branches")
    return tuple(parse_branch(item) for item in raw)


def parse_branch_detail(value: object) -> Branch:
    return parse_branch(_mapping(value, "branch detail").get("branch"))


def _same_branch_identity(left: Branch, right: Branch) -> bool:
    left_identity = (left.id, left.name, left.project_id, left.parent_id, left.default)
    right_identity = (
        right.id,
        right.name,
        right.project_id,
        right.parent_id,
        right.default,
    )
    return left_identity == right_identity


def resolve_test_base(listing: object, detail: object, project_id: str) -> Branch:
    matches = [
        branch for branch in parse_branches(listing) if branch.name == TEST_BASE_NAME
    ]
    if len(matches) != 1:
        raise RuntimeError("expected exactly one branch named test-base")
    verified = parse_branch_detail(detail)
    if (
        not _same_branch_identity(verified, matches[0])
        or verified.project_id != project_id
    ):
        raise RuntimeError("test-base name-on-id verification failed")
    return verified


def resolve_ephemeral_branch(
    before: Sequence[Branch],
    after: Sequence[Branch],
    parent: Branch,
    excluded: frozenset[str] = frozenset(),
    created_after: datetime | None = None,
) -> Branch:
    before_ids = {branch.id for branch in before}
    matches = [
        branch
        for branch in after
        if branch.id not in before_ids
        and branch.id not in excluded
        and branch.parent_id == parent.id
        and not branch.name.startswith(CLAIM_PREFIX)
        and (
            created_after is None
            or (branch.created_at is not None and branch.created_at >= created_after)
        )
    ]
    if not matches:
        raise RuntimeError("no new branch parented to test-base was observable")
    if any(branch.project_id != parent.project_id for branch in matches):
        raise RuntimeError("ephemeral branch belongs to another Neon project")
    return min(matches, key=lambda branch: branch.id)


def assert_mutable_branch(branch: Branch) -> None:
    protected = branch.name in {"main", "staging", TEST_BASE_NAME}
    if branch.default or protected or branch.name.startswith("preview/"):
        raise RuntimeError(f"refusing mutation of protected Neon branch {branch.name}")


class NeonApi:
    def __init__(
        self,
        api_key: str,
        project_id: str,
        requester: JsonRequester | None = None,
        clock: Clock = time.monotonic,
        sleeper: Sleeper = time.sleep,
    ) -> None:
        self._api_key = api_key
        self.project_id = project_id
        self._requester = requester
        self._clock = clock
        self._sleep = sleeper

    def _request(self, path: str, timeout: float) -> object | None:
        connection = http.client.HTTPSConnection(NEON_API_HOST, timeout=timeout)
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": JSON_MIME,
        }
        try:
            connection.request("GET", f"/api/v2/{path}", headers=headers)
            response = connection.getresponse()
            body = response.read()
        finally:
            connection.close()
        if response.status == 404:
            return None
        if not 200 <= response.status < 300:
            raise RuntimeError(f"Neon API returned HTTP {response.status}")
        return cast(object, json.loads(body))

    def _get(
        self, path: str, timeout: float = REQUEST_TIMEOUT_SECONDS
    ) -> object | None:
        requester = self._requester or self._request
        return requester(path, timeout)

    def _remaining(self, deadline: float) -> float:
        remaining = deadline - self._clock()
        if remaining <= 0:
            raise TimeoutError("Neon API operation exceeded its wall-clock budget")
        return min(REQUEST_TIMEOUT_SECONDS, remaining)

    def _sleep_before(self, deadline: float, delay: float) -> None:
        remaining = deadline - self._clock()
        if remaining > 0:
            self._sleep(min(delay, remaining))

    def list_branches(
        self, timeout: float = REQUEST_TIMEOUT_SECONDS
    ) -> tuple[Branch, ...]:
        payload = self._get(f"projects/{self.project_id}/branches?limit=100", timeout)
        return parse_branches(payload)

    def get_branch_or_none(
        self, branch_id: str, timeout: float = REQUEST_TIMEOUT_SECONDS
    ) -> Branch | None:
        payload = self._get(f"projects/{self.project_id}/branches/{branch_id}", timeout)
        return parse_branch_detail(payload) if payload is not None else None

    def get_branch(
        self, branch_id: str, timeout: float = REQUEST_TIMEOUT_SECONDS
    ) -> Branch:
        branch = self.get_branch_or_none(branch_id, timeout)
        if branch is None:
            raise RuntimeError(f"Neon branch {branch_id} was not found")
        return branch

    def update_branch_name(
        self, branch_id: str, name: str, timeout: float = REQUEST_TIMEOUT_SECONDS
    ) -> bool:
        connection = http.client.HTTPSConnection(NEON_API_HOST, timeout=timeout)
        body = json.dumps({"branch": {"name": name}})
        headers = self._write_headers()
        path = f"/api/v2/projects/{self.project_id}/branches/{branch_id}"
        try:
            connection.request("PATCH", path, body=body, headers=headers)
            response = connection.getresponse()
            response.read()
        finally:
            connection.close()
        if response.status == 404:
            return False
        if not 200 <= response.status < 300:
            raise RuntimeError(
                f"Neon API branch rename returned HTTP {response.status}"
            )
        return True

    def _write_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": JSON_MIME,
            "Content-Type": JSON_MIME,
        }

    def _claim_candidate(
        self,
        before: Sequence[Branch],
        parent: Branch,
        claim_name: str,
        rejected: frozenset[str],
        deadline: float,
        created_after: datetime,
    ) -> Branch | None:
        after = self.list_branches(self._remaining(deadline))
        try:
            candidate = resolve_ephemeral_branch(
                before, after, parent, rejected, created_after
            )
        except RuntimeError as error:
            if "no new branch" in str(error):
                return None
            raise
        if not self.update_branch_name(
            candidate.id, claim_name, self._remaining(deadline)
        ):
            return candidate
        return self.get_branch_or_none(candidate.id, self._remaining(deadline))

    def wait_for_ephemeral(
        self,
        before: Sequence[Branch],
        parent: Branch,
        claim_name: str,
        created_after: datetime,
    ) -> Branch:
        deadline = self._clock() + POLL_TIMEOUT_SECONDS
        rejected: set[str] = set()
        while self._clock() < deadline:
            branch = self._claim_candidate(
                before,
                parent,
                claim_name,
                frozenset(rejected),
                deadline,
                created_after,
            )
            if branch is not None and branch.name == claim_name:
                return branch
            if branch is not None:
                rejected.add(branch.id)
            self._sleep_before(deadline, 2.0)
        raise RuntimeError("ephemeral branch was not claimable within 60 seconds")

    def resolve_test_base(self) -> Branch:
        matches = [
            branch for branch in self.list_branches() if branch.name == TEST_BASE_NAME
        ]
        if len(matches) != 1:
            raise RuntimeError("expected exactly one branch named test-base")
        verified = self.get_branch(matches[0].id)
        if (
            not _same_branch_identity(verified, matches[0])
            or verified.project_id != self.project_id
        ):
            raise RuntimeError("test-base name-on-id verification failed")
        return verified

    def connection_uri(
        self, branch_id: str, timeout: float = REQUEST_TIMEOUT_SECONDS
    ) -> str:
        query = urllib.parse.urlencode(
            {
                "branch_id": branch_id,
                "database_name": "neondb",
                "role_name": "neondb_owner",
                "pooled": "false",
            }
        )
        payload = self._get(
            f"projects/{self.project_id}/connection_uri?{query}", timeout
        )
        uri = _mapping(payload, "connection URI").get("uri")
        if not isinstance(uri, str) or not uri.startswith(
            ("postgres://", "postgresql://")
        ):
            raise RuntimeError("Neon API returned an invalid connection URI")
        return uri

    def assert_mutable_dsn(self, dsn: str) -> Branch:
        endpoint_id = endpoint_id_from_dsn(dsn)
        payload = self._get(f"projects/{self.project_id}/endpoints/{endpoint_id}")
        endpoint = _mapping(payload, "endpoint detail").get("endpoint")
        endpoint_data = _mapping(endpoint, "endpoint")
        if _text(endpoint_data, "project_id", "endpoint") != self.project_id:
            raise RuntimeError("TEST_DATABASE_URL endpoint belongs to another project")
        branch_id = _text(endpoint_data, "branch_id", "endpoint")
        branch = self.get_branch(branch_id)
        assert_mutable_branch(branch)
        return branch

    def _delete_once(self, branch_id: str, timeout: float) -> int:
        connection = http.client.HTTPSConnection(NEON_API_HOST, timeout=timeout)
        path = f"/api/v2/projects/{self.project_id}/branches/{branch_id}"
        try:
            connection.request("DELETE", path, headers=self._write_headers())
            response = connection.getresponse()
            response.read()
        finally:
            connection.close()
        return response.status

    def delete_branch(self, branch_id: str) -> None:
        """Delete a verified ephemeral branch, retrying Neon's lock response."""
        deadline = self._clock() + DELETE_TIMEOUT_SECONDS
        for attempt in range(DELETE_ATTEMPTS):
            status = self._delete_once(branch_id, self._remaining(deadline))
            if status in (200, 204, 404):
                return
            if status != 423 or attempt == DELETE_ATTEMPTS - 1:
                raise RuntimeError(
                    f"failed to delete ephemeral branch {branch_id}: HTTP {status}"
                )
            self._sleep_before(deadline, float(2**attempt))

    def delete_claimed_branch(self, branch_id: str, claim_name: str) -> None:
        branch = self.get_branch_or_none(branch_id)
        if branch is None:
            return
        if branch.name != claim_name:
            raise RuntimeError(
                f"refusing to delete branch {branch_id} without session ownership token"
            )
        self.delete_branch(branch_id)

    def wait_until_deleted(self, branch_id: str) -> None:
        deadline = self._clock() + POLL_TIMEOUT_SECONDS
        while self._clock() < deadline:
            if self.get_branch_or_none(branch_id, self._remaining(deadline)) is None:
                return
            self._sleep_before(deadline, 2.0)
        raise RuntimeError(f"ephemeral branch {branch_id} survived container teardown")
