"""Typed, secret-safe Neon Admin API helpers for database test branches."""

from __future__ import annotations

import http.client
import json
import time
import urllib.parse
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from agent.tests.db_config import endpoint_id_from_dsn

TEST_BASE_NAME = "test-base"


@dataclass(frozen=True)
class Branch:
    id: str
    name: str
    project_id: str
    parent_id: str | None
    default: bool


JsonRequester = Callable[[str], object | None]


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
    return Branch(
        _text(payload, "id", "branch"),
        _text(payload, "name", "branch"),
        _text(payload, "project_id", "branch"),
        parent,
        payload.get("default") is True,
    )


def parse_branches(value: object) -> tuple[Branch, ...]:
    raw = _mapping(value, "branch list").get("branches")
    if not isinstance(raw, list):
        raise RuntimeError("Neon API branch list omitted branches")
    return tuple(parse_branch(item) for item in raw)


def parse_branch_detail(value: object) -> Branch:
    return parse_branch(_mapping(value, "branch detail").get("branch"))


def resolve_test_base(listing: object, detail: object, project_id: str) -> Branch:
    matches = [
        branch for branch in parse_branches(listing) if branch.name == TEST_BASE_NAME
    ]
    if len(matches) != 1:
        raise RuntimeError("expected exactly one branch named test-base")
    verified = parse_branch_detail(detail)
    if verified != matches[0] or verified.project_id != project_id:
        raise RuntimeError("test-base name-on-id verification failed")
    return verified


def resolve_ephemeral_branch(
    before: Sequence[Branch], after: Sequence[Branch], parent: Branch
) -> Branch:
    before_ids = {branch.id for branch in before}
    matches = [
        branch
        for branch in after
        if branch.id not in before_ids and branch.parent_id == parent.id
    ]
    if not matches:
        raise RuntimeError("no new branch parented to test-base was observable")
    if len(matches) > 1:
        raise RuntimeError("multiple new branches were parented to test-base")
    branch = matches[0]
    if branch.project_id != parent.project_id:
        raise RuntimeError("ephemeral branch belongs to another Neon project")
    return branch


def assert_mutable_branch(branch: Branch) -> None:
    protected = branch.name in {"main", "staging", TEST_BASE_NAME}
    if branch.default or protected or branch.name.startswith("preview/"):
        raise RuntimeError(f"refusing mutation of protected Neon branch {branch.name}")


class NeonApi:
    def __init__(
        self, api_key: str, project_id: str, requester: JsonRequester | None = None
    ) -> None:
        self._api_key = api_key
        self.project_id = project_id
        self._requester = requester or self._request

    def _request(self, path: str) -> object | None:
        connection = http.client.HTTPSConnection("console.neon.tech", timeout=20)
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
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

    def list_branches(self) -> tuple[Branch, ...]:
        payload = self._requester(f"projects/{self.project_id}/branches?limit=100")
        return parse_branches(payload)

    def get_branch(self, branch_id: str) -> Branch:
        payload = self._requester(f"projects/{self.project_id}/branches/{branch_id}")
        if payload is None:
            raise RuntimeError(f"Neon branch {branch_id} was not found")
        return parse_branch_detail(payload)

    def resolve_test_base(self) -> Branch:
        matches = [
            branch for branch in self.list_branches() if branch.name == TEST_BASE_NAME
        ]
        if len(matches) != 1:
            raise RuntimeError("expected exactly one branch named test-base")
        verified = self.get_branch(matches[0].id)
        if verified != matches[0] or verified.project_id != self.project_id:
            raise RuntimeError("test-base name-on-id verification failed")
        return verified

    def wait_for_ephemeral(self, before: Sequence[Branch], parent: Branch) -> Branch:
        for delay in (*([2.0] * 29), 0.0):
            try:
                return resolve_ephemeral_branch(before, self.list_branches(), parent)
            except RuntimeError as error:
                if "no new branch" not in str(error) or delay == 0:
                    raise
                time.sleep(delay)
        raise RuntimeError("ephemeral branch was not observable within 60 seconds")

    def connection_uri(self, branch_id: str) -> str:
        query = urllib.parse.urlencode(
            {
                "branch_id": branch_id,
                "database_name": "neondb",
                "role_name": "neondb_owner",
                "pooled": "false",
            }
        )
        payload = self._requester(f"projects/{self.project_id}/connection_uri?{query}")
        uri = _mapping(payload, "connection URI").get("uri")
        if not isinstance(uri, str) or not uri.startswith(
            ("postgres://", "postgresql://")
        ):
            raise RuntimeError("Neon API returned an invalid connection URI")
        return uri

    def assert_mutable_dsn(self, dsn: str) -> Branch:
        endpoint_id = endpoint_id_from_dsn(dsn)
        payload = self._requester(f"projects/{self.project_id}/endpoints/{endpoint_id}")
        endpoint = _mapping(payload, "endpoint detail").get("endpoint")
        endpoint_data = _mapping(endpoint, "endpoint")
        if _text(endpoint_data, "project_id", "endpoint") != self.project_id:
            raise RuntimeError("TEST_DATABASE_URL endpoint belongs to another project")
        branch_id = _text(endpoint_data, "branch_id", "endpoint")
        branch = self.get_branch(branch_id)
        assert_mutable_branch(branch)
        return branch

    def delete_branch(self, branch_id: str) -> None:
        """API fallback for kill/Ryuk orphaning (Phase-0 doc gap): force-delete."""
        connection = http.client.HTTPSConnection("console.neon.tech", timeout=20)
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }
        path = f"/api/v2/projects/{self.project_id}/branches/{branch_id}"
        try:
            connection.request("DELETE", path, headers=headers)
            response = connection.getresponse()
            response.read()
        finally:
            connection.close()
        if response.status not in (200, 404):
            raise RuntimeError(
                f"failed to delete ephemeral branch {branch_id}: HTTP {response.status}"
            )

    def wait_until_deleted(self, branch_id: str) -> None:
        path = f"projects/{self.project_id}/branches/{branch_id}"
        for delay in (*([2.0] * 29), 0.0):
            if self._requester(path) is None:
                return
            time.sleep(delay)
        raise RuntimeError(f"ephemeral branch {branch_id} survived container teardown")
