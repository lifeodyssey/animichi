"""HTTP method contract for Neon branch ownership claims."""

from __future__ import annotations

import json

import pytest

from agent.tests import neon_api
from agent.tests.neon_api import NeonApi


class FakeResponse:
    status = 200

    def read(self) -> bytes:
        return b"{}"


class FakeHttpsConnection:
    def __init__(self) -> None:
        self.request_args: tuple[str, str, str, dict[str, str]] | None = None

    def request(
        self, method: str, path: str, body: str, headers: dict[str, str]
    ) -> None:
        self.request_args = (method, path, body, headers)

    def getresponse(self) -> FakeResponse:
        return FakeResponse()

    def close(self) -> None:
        return None


def test_branch_rename_uses_patch_with_nested_branch_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeHttpsConnection()
    monkeypatch.setattr(
        neon_api.http.client,
        "HTTPSConnection",
        lambda host, timeout: connection,
    )
    api = NeonApi("secret", "project-test")
    assert api.update_branch_name("br-a", "wt-test-session-a") is True
    assert connection.request_args is not None
    method, path, body, headers = connection.request_args
    assert (method, path) == (
        "PATCH",
        "/api/v2/projects/project-test/branches/br-a",
    )
    assert json.loads(body) == {"branch": {"name": "wt-test-session-a"}}
    assert headers["Authorization"] == "Bearer secret"
